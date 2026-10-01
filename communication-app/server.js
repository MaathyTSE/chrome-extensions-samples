// Chat, forum and video-call signalling server.
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_HISTORY = 100;
const MAX_CALL_PEERS = 6; // WebRTC mesh: every peer connects to every other

// ---------- Persistence (forum + chat history) ----------
let db = { threads: [], chat: {} };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} catch {
  // First run: start empty.
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db), () => {});
  }, 200);
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const cleanRoom = (v) => clean(v, 32).replace(/[^\w-]/g, '') || 'general';

// ---------- HTTP: static files + forum REST API ----------
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/threads', (req, res) => {
  res.json(
    db.threads
      .map((t) => ({ id: t.id, title: t.title, author: t.author, time: t.time, replies: t.posts.length - 1, last: t.posts[t.posts.length - 1].time }))
      .sort((a, b) => b.last - a.last)
  );
});

app.get('/api/threads/:id', (req, res) => {
  const t = db.threads.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

app.post('/api/threads', (req, res) => {
  const title = clean(req.body.title, 120);
  const body = clean(req.body.body, 5000);
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });
  const author = clean(req.body.author, 24) || 'Anonymous';
  const time = Date.now();
  const thread = { id: crypto.randomUUID(), title, author, time, posts: [{ id: crypto.randomUUID(), author, body, time }] };
  db.threads.push(thread);
  save();
  broadcast({ type: 'forum-update' });
  res.status(201).json(thread);
});

app.post('/api/threads/:id/posts', (req, res) => {
  const t = db.threads.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const body = clean(req.body.body, 5000);
  if (!body) return res.status(400).json({ error: 'Body is required' });
  const post = { id: crypto.randomUUID(), author: clean(req.body.author, 24) || 'Anonymous', body, time: Date.now() };
  t.posts.push(post);
  save();
  broadcast({ type: 'forum-update', threadId: t.id });
  res.status(201).json(post);
});

const server = http.createServer(app);

// ---------- WebSocket: chat rooms + call signalling ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const clients = new Set();
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
function broadcast(msg, filter = () => true) {
  for (const c of clients) if (filter(c)) send(c, msg);
}
const roomMembers = (kind, room) => [...clients].filter((c) => c[kind] === room);
function sendPresence(room) {
  const users = roomMembers('chatRoom', room).map((c) => ({ id: c.id, name: c.name }));
  broadcast({ type: 'presence', room, users }, (c) => c.chatRoom === room);
}

function leaveChat(ws) {
  const room = ws.chatRoom;
  ws.chatRoom = null;
  if (room) sendPresence(room);
}
function leaveCall(ws) {
  const room = ws.callRoom;
  ws.callRoom = null;
  if (room) broadcast({ type: 'peer-left', id: ws.id }, (c) => c.callRoom === room);
}

wss.on('connection', (ws) => {
  ws.id = crypto.randomUUID();
  ws.name = 'Anonymous';
  ws.chatRoom = null;
  ws.callRoom = null;
  ws.lastMsg = 0;
  clients.add(ws);
  send(ws, { type: 'welcome', id: ws.id });

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.type) {
      case 'name':
        ws.name = clean(m.name, 24) || 'Anonymous';
        if (ws.chatRoom) sendPresence(ws.chatRoom);
        break;
      case 'join-chat': {
        leaveChat(ws);
        ws.chatRoom = cleanRoom(m.room);
        send(ws, { type: 'history', room: ws.chatRoom, messages: db.chat[ws.chatRoom] || [] });
        sendPresence(ws.chatRoom);
        break;
      }
      case 'chat': {
        const text = clean(m.text, 2000);
        const now = Date.now();
        if (!ws.chatRoom || !text || now - ws.lastMsg < 250) return; // basic rate limit
        ws.lastMsg = now;
        const msg = { id: crypto.randomUUID(), senderId: ws.id, name: ws.name, text, time: now };
        const list = (db.chat[ws.chatRoom] ||= []);
        list.push(msg);
        if (list.length > MAX_HISTORY) list.shift();
        save();
        broadcast({ type: 'chat', room: ws.chatRoom, message: msg }, (c) => c.chatRoom === ws.chatRoom);
        break;
      }
      case 'join-call': {
        leaveCall(ws);
        const room = cleanRoom(m.room);
        const peers = roomMembers('callRoom', room);
        if (peers.length >= MAX_CALL_PEERS) return send(ws, { type: 'call-full' });
        ws.callRoom = room;
        // The newcomer creates offers to everyone already in the room.
        send(ws, { type: 'peers', peers: peers.map((c) => ({ id: c.id, name: c.name })) });
        break;
      }
      case 'signal': {
        // Relay SDP/ICE only between members of the same call room.
        const target = [...clients].find((c) => c.id === m.to && c.callRoom && c.callRoom === ws.callRoom);
        if (target) send(target, { type: 'signal', from: ws.id, name: ws.name, data: m.data });
        break;
      }
      case 'leave-call':
        leaveCall(ws);
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    leaveChat(ws);
    leaveCall(ws);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Communication app on http://localhost:${PORT}`));
}
module.exports = { server };

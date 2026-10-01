const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let myId, ws;
let name = localStorage.getItem('name') || '';
$('name').value = name;
$('name').addEventListener('change', () => {
  name = $('name').value.trim();
  localStorage.setItem('name', name);
  wsSend({ type: 'name', name });
});
const author = () => name || 'Anonymous';

// ---------- Tabs ----------
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach((n) => n.classList.remove('active'));
    b.classList.add('active');
    $(b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'forum') loadThreads();
  })
);

// ---------- WebSocket ----------
const wsSend = (m) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    $('status').textContent = 'online';
    if (name) wsSend({ type: 'name', name });
    wsSend({ type: 'join-chat', room });
    if (callRoom) joinCall(callRoom); // rejoin after reconnect
  };
  ws.onclose = () => {
    $('status').textContent = 'reconnecting…';
    setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    ({ welcome: (x) => (myId = x.id), history, chat: onChat, presence, 'forum-update': onForumUpdate,
       peers: onPeers, signal: onSignal, 'peer-left': (x) => closePeer(x.id),
       'call-full': () => { alert('That call is full.'); hangup(); } })[m.type]?.(m);
  };
}

// ---------- Chat ----------
let room = 'general';
const knownRooms = new Set(['general', 'random', 'help']);
function renderRooms() {
  $('rooms').replaceChildren(...[...knownRooms].map((r) =>
    el('li', { textContent: '# ' + r, className: r === room ? 'active' : '', onclick: () => switchRoom(r) })));
}
function switchRoom(r) {
  room = r;
  knownRooms.add(r);
  $('messages').replaceChildren();
  renderRooms();
  wsSend({ type: 'join-chat', room });
}
$('room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const r = $('room-new').value.trim().replace(/[^\w-]/g, '');
  $('room-new').value = '';
  if (r) switchRoom(r);
});
function addMessage(msg) {
  const li = el('li', { className: msg.senderId === myId ? 'mine' : '' },
    el('span', { className: 'meta', textContent: `${msg.name} · ${fmt(msg.time)}` }),
    el('span', { textContent: msg.text }));
  $('messages').append(li);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function history(m) { if (m.room === room) { $('messages').replaceChildren(); m.messages.forEach(addMessage); } }
function onChat(m) { if (m.room === room) addMessage(m.message); }
function presence(m) {
  if (m.room === room) $('users').replaceChildren(...m.users.map((u) => el('li', { textContent: u.name })));
}
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  wsSend({ type: 'chat', text: $('chat-text').value });
  $('chat-text').value = '';
});
renderRooms();

// ---------- Forum ----------
let openThread = null;
async function api(path, body) {
  const res = await fetch('/api' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, author: author() }) } : undefined);
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
async function loadThreads() {
  const threads = await api('/threads');
  $('threads').replaceChildren(...threads.map((t) =>
    el('li', { onclick: () => showThread(t.id) },
      el('strong', { textContent: t.title }),
      el('span', { className: 'meta', textContent: `${t.author} · ${t.replies} replies · last activity ${new Date(t.last).toLocaleString()}` }))));
}
async function showThread(id) {
  const t = await api('/threads/' + id);
  openThread = id;
  $('thread-list-view').hidden = true;
  $('thread-view').hidden = false;
  $('thread-heading').textContent = t.title;
  $('posts').replaceChildren(...t.posts.map((p) =>
    el('li', {}, el('span', { className: 'meta', textContent: `${p.author} · ${new Date(p.time).toLocaleString()}` }), el('span', { textContent: p.body }))));
}
$('back').addEventListener('click', () => {
  openThread = null;
  $('thread-view').hidden = true;
  $('thread-list-view').hidden = false;
  loadThreads();
});
$('thread-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const t = await api('/threads', { title: $('thread-title').value, body: $('thread-body').value });
    e.target.reset();
    showThread(t.id);
  } catch (err) { alert(err.message); }
});
$('reply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/threads/${openThread}/posts`, { body: $('reply-body').value });
    e.target.reset();
    showThread(openThread);
  } catch (err) { alert(err.message); }
});
function onForumUpdate(m) {
  if (openThread && m.threadId === openThread) showThread(openThread);
  else if (!openThread && $('forum').classList.contains('active')) loadThreads();
}

// ---------- Video call (WebRTC mesh, signalling over the WebSocket) ----------
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let callRoom = null;
let localStream = null;
const peers = new Map(); // id -> RTCPeerConnection

function tile(id, label, stream, muted) {
  let t = document.querySelector(`[data-peer="${id}"]`);
  if (!t) {
    t = el('div', { className: 'tile' }, el('video', { autoplay: true, playsInline: true }), el('span'));
    t.dataset.peer = id;
    $('tiles').append(t);
  }
  const v = t.querySelector('video');
  v.muted = muted;
  if (v.srcObject !== stream) v.srcObject = stream;
  t.querySelector('span').textContent = label;
}

async function joinCall(r) {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      alert('Camera/microphone unavailable: ' + err.message);
      return;
    }
    tile('me', 'You', localStream, true);
  }
  callRoom = r;
  wsSend({ type: 'join-call', room: r });
  for (const id of ['join', 'call-room']) $(id).hidden = true;
  for (const id of ['hangup', 'mute', 'cam']) $(id).hidden = false;
}
function hangup() {
  wsSend({ type: 'leave-call' });
  callRoom = null;
  [...peers.keys()].forEach(closePeer);
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  $('tiles').replaceChildren();
  for (const id of ['join', 'call-room']) $(id).hidden = false;
  for (const id of ['hangup', 'mute', 'cam']) $(id).hidden = true;
}
function closePeer(id) {
  peers.get(id)?.close();
  peers.delete(id);
  document.querySelector(`[data-peer="${id}"]`)?.remove();
}
function createPeer(id, label) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers.set(id, pc);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => e.candidate && wsSend({ type: 'signal', to: id, data: { candidate: e.candidate } });
  pc.ontrack = (e) => tile(id, label, e.streams[0], false);
  pc.onconnectionstatechange = () => ['failed', 'closed'].includes(pc.connectionState) && closePeer(id);
  return pc;
}
// Newcomer offers to everyone already present.
async function onPeers(m) {
  for (const p of m.peers) {
    const pc = createPeer(p.id, p.name);
    await pc.setLocalDescription(await pc.createOffer());
    wsSend({ type: 'signal', to: p.id, data: { description: pc.localDescription } });
  }
}
async function onSignal(m) {
  if (!localStream) return;
  const { description, candidate } = m.data;
  const pc = peers.get(m.from) || createPeer(m.from, m.name);
  if (description) {
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer());
      wsSend({ type: 'signal', to: m.from, data: { description: pc.localDescription } });
    }
  } else if (candidate) {
    try { await pc.addIceCandidate(candidate); } catch { /* candidate for a closed connection */ }
  }
}
$('call-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinCall($('call-room').value.trim().replace(/[^\w-]/g, '') || 'lobby');
});
$('hangup').addEventListener('click', hangup);
$('mute').addEventListener('click', () => {
  const t = localStream.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('mute').textContent = t.enabled ? 'Mute' : 'Unmute';
});
$('cam').addEventListener('click', () => {
  const t = localStream.getVideoTracks()[0];
  t.enabled = !t.enabled;
  $('cam').textContent = t.enabled ? 'Camera off' : 'Camera on';
});

connect();

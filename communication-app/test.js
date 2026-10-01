// Smoke test: chat, forum and call signalling against a live server.
const assert = require('assert');
const os = require('os');
const path = require('path');
process.env.DATA_FILE = path.join(os.tmpdir(), `comm-test-${process.pid}.json`);
const WebSocket = require('ws');
const { server } = require('./server');

const open = (port) => new Promise((res) => {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  ws.inbox = [];
  ws.on('message', (d) => ws.inbox.push(JSON.parse(d)));
  ws.on('open', () => res(ws));
});
const until = async (ws, pred) => {
  for (let i = 0; i < 100; i++) {
    const m = ws.inbox.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};

server.listen(0, async () => {
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  try {
    const a = await open(port), b = await open(port);
    const idA = (await until(a, (m) => m.type === 'welcome')).id;
    a.send(JSON.stringify({ type: 'name', name: 'Ann' }));
    b.send(JSON.stringify({ type: 'name', name: 'Bob' }));

    // Chat
    for (const w of [a, b]) w.send(JSON.stringify({ type: 'join-chat', room: 'general' }));
    await until(a, (m) => m.type === 'presence' && m.users.length === 2); // both joined
    a.send(JSON.stringify({ type: 'chat', text: 'hello' }));
    const got = await until(b, (m) => m.type === 'chat');
    assert.strictEqual(got.message.text, 'hello');
    assert.strictEqual(got.message.name, 'Ann');

    // Forum
    const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.strictEqual((await post('/api/threads', { title: '' })).status, 400);
    const t = await (await post('/api/threads', { title: 'Hi', body: 'First', author: 'Ann' })).json();
    assert.strictEqual((await post(`/api/threads/${t.id}/posts`, { body: 'Reply' })).status, 201);
    const full = await (await fetch(`${base}/api/threads/${t.id}`)).json();
    assert.strictEqual(full.posts.length, 2);
    assert.strictEqual((await fetch(`${base}/api/threads/nope`)).status, 404);
    await until(b, (m) => m.type === 'forum-update');

    // Call signalling
    a.send(JSON.stringify({ type: 'join-call', room: 'r' }));
    await until(a, (m) => m.type === 'peers');
    b.send(JSON.stringify({ type: 'join-call', room: 'r' }));
    const peers = await until(b, (m) => m.type === 'peers');
    assert.deepStrictEqual(peers.peers.map((p) => p.id), [idA]);
    b.send(JSON.stringify({ type: 'signal', to: idA, data: { description: { type: 'offer', sdp: 'x' } } }));
    assert.strictEqual((await until(a, (m) => m.type === 'signal')).data.description.type, 'offer');
    b.close();
    await until(a, (m) => m.type === 'peer-left');

    console.log('all tests passed');
    process.exitCode = 0;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  server.close();
  process.exit();
});

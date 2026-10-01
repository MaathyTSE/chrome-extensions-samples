const MAX_MESSAGES = 200;
const messagesEl = document.getElementById('messages');
const nameEl = document.getElementById('name');
const serverEl = document.getElementById('server');
const statusEl = document.getElementById('status');
const formEl = document.getElementById('form');
const textEl = document.getElementById('text');

let socket;
let me = { id: crypto.randomUUID(), name: '' };

function render(messages) {
  messagesEl.replaceChildren(
    ...messages.map((m) => {
      const li = document.createElement('li');
      if (m.senderId === me.id) li.className = 'mine';
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${m.name} · ${new Date(m.time).toLocaleTimeString()}`;
      const body = document.createElement('span');
      body.textContent = m.text; // textContent: never render messages as HTML
      li.append(meta, body);
      return li;
    })
  );
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function addMessage(message) {
  const { messages = [] } = await chrome.storage.local.get('messages');
  if (messages.some((m) => m.id === message.id)) return; // de-duplicate
  messages.push(message);
  await chrome.storage.local.set({ messages: messages.slice(-MAX_MESSAGES) });
}

function setStatus(text, online) {
  statusEl.textContent = text;
  statusEl.classList.toggle('online', online);
}

function connect(url) {
  socket?.close();
  socket = undefined;
  if (!url) return setStatus('local', false);
  try {
    socket = new WebSocket(url);
  } catch {
    return setStatus('bad URL', false);
  }
  setStatus('connecting…', false);
  socket.onopen = () => setStatus('online', true);
  socket.onclose = () => setStatus('offline', false);
  socket.onmessage = async (event) => {
    try {
      const m = JSON.parse(event.data);
      if (typeof m.id === 'string' && typeof m.text === 'string') {
        await addMessage({
          id: m.id,
          senderId: String(m.senderId),
          name: String(m.name).slice(0, 24),
          text: m.text.slice(0, 2000),
          time: Number(m.time) || Date.now()
        });
      }
    } catch {
      // Ignore malformed frames.
    }
  };
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = {
    id: crypto.randomUUID(),
    senderId: me.id,
    name: nameEl.value.trim() || 'Anonymous',
    text: textEl.value.trim(),
    time: Date.now()
  };
  if (!message.text) return;
  textEl.value = '';
  await addMessage(message);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
});

nameEl.addEventListener('change', () =>
  chrome.storage.local.set({ name: nameEl.value.trim() })
);
serverEl.addEventListener('change', () => {
  chrome.storage.local.set({ server: serverEl.value.trim() });
  connect(serverEl.value.trim());
});

// Live updates: fires for sends from this panel and from other windows.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.messages) render(changes.messages.newValue || []);
});

(async () => {
  const stored = await chrome.storage.local.get(['messages', 'name', 'server']);
  nameEl.value = stored.name || '';
  serverEl.value = stored.server || '';
  render(stored.messages || []);
  connect(serverEl.value);
})();

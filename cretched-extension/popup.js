// Cretched's extension popup:
//   - Connects to the relay as role=sender.
//   - Accepts a drag-dropped image file and forwards its bytes.
//   - Persists server/room/token via chrome.storage so Cretched only types once.
//   - Auto-connects on popup open because browser extension popups are short-lived.

const $ = (id) => document.getElementById(id);
const serverInput = $('server');
const roomInput = $('room');
const tokenInput = $('token');
const connectBtn = $('connect');
const drop = $('drop');
const preview = $('preview');
const statusEl = $('status');

const KEYS = ['server', 'room', 'token'];

let ws;
let connectPromise;

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

function saveSettings() {
  chrome.storage.local.set({
    server: serverInput.value,
    room: roomInput.value,
    token: tokenInput.value,
  });
}

for (const input of [serverInput, roomInput, tokenInput]) {
  input.addEventListener('input', saveSettings);
  input.addEventListener('change', saveSettings);
}

function buildRelayUrl() {
  return `${serverInput.value}?room=${encodeURIComponent(roomInput.value)}`
       + `&role=sender&token=${encodeURIComponent(tokenInput.value)}`;
}

function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function connectToRelay({ force = false } = {}) {
  saveSettings();

  if (isConnected() && !force) {
    return Promise.resolve(ws);
  }

  if (connectPromise && !force) {
    return connectPromise;
  }

  if (ws) {
    try { ws.close(); } catch (_) {}
  }

  const socket = new WebSocket(buildRelayUrl());
  ws = socket;
  ws.binaryType = 'arraybuffer';
  setStatus('connecting...');

  connectPromise = new Promise((resolve, reject) => {
    socket.onopen = () => {
      connectPromise = null;
      setStatus('connected', 'ok');
      resolve(socket);
    };

    socket.onclose = (event) => {
      if (ws === socket) {
        ws = null;
      }
      connectPromise = null;
      setStatus('disconnected' + (event.reason ? `: ${event.reason}` : ''), 'err');
      reject(new Error(event.reason || 'disconnected'));
    };

    socket.onerror = () => {
      connectPromise = null;
      setStatus('connection error', 'err');
      reject(new Error('connection error'));
    };
  });

  return connectPromise;
}

chrome.storage.local.get(KEYS, (values) => {
  if (values.server) serverInput.value = values.server;
  if (values.room) roomInput.value = values.room;
  if (values.token) tokenInput.value = values.token;

  if (values.server && values.room && values.token) {
    connectToRelay().catch(() => {});
  }
});

connectBtn.addEventListener('click', () => {
  connectToRelay({ force: true }).catch(() => {});
});

drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('hover');
});

drop.addEventListener('dragleave', () => {
  drop.classList.remove('hover');
});

drop.addEventListener('drop', async (event) => {
  event.preventDefault();
  drop.classList.remove('hover');

  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) {
    setStatus('no file', 'err');
    return;
  }

  try {
    await connectToRelay();
  } catch (_) {
    setStatus('not connected - check relay settings', 'err');
    return;
  }

  const buffer = await file.arrayBuffer();
  ws.send(buffer);
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  setStatus(`sent ${file.name} (${Math.round(buffer.byteLength / 1024)} KB)`, 'ok');
});

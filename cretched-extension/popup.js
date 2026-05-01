// Cretched's extension popup:
//   - Connects to the relay as role=sender.
//   - Accepts a drag-dropped image file and forwards its bytes.
//   - Persists server/room/token via chrome.storage so Cretched only types once.

const $ = (id) => document.getElementById(id);
const serverInput = $('server');
const roomInput   = $('room');
const tokenInput  = $('token');
const connectBtn  = $('connect');
const drop        = $('drop');
const preview     = $('preview');
const statusEl    = $('status');

const KEYS = ['server', 'room', 'token'];

// Restore saved settings.
chrome.storage.local.get(KEYS, (v) => {
  if (v.server) serverInput.value = v.server;
  if (v.room)   roomInput.value   = v.room;
  if (v.token)  tokenInput.value  = v.token;
});
function saveSettings() {
  chrome.storage.local.set({
    server: serverInput.value,
    room:   roomInput.value,
    token:  tokenInput.value,
  });
}

let ws;
function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
}

connectBtn.addEventListener('click', () => {
  saveSettings();
  if (ws) try { ws.close(); } catch (_) {}
  const url = `${serverInput.value}?room=${encodeURIComponent(roomInput.value)}`
            + `&role=sender&token=${encodeURIComponent(tokenInput.value)}`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  setStatus('connecting…');
  ws.onopen  = () => setStatus('connected', 'ok');
  ws.onclose = (e) => setStatus('disconnected' + (e.reason ? `: ${e.reason}` : ''), 'err');
  ws.onerror = () => setStatus('connection error', 'err');
});

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('hover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) { setStatus('no file', 'err'); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus('not connected — click Connect first', 'err');
    return;
  }
  const buf = await file.arrayBuffer();
  ws.send(buf);
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  setStatus(`sent ${file.name} (${Math.round(buf.byteLength / 1024)} KB)`, 'ok');
});

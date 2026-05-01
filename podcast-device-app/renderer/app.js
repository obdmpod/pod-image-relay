// Renderer logic:
//   1. Renders the tab strip and delegates tab actions to main via IPC.
//   2. Keeps the active tab's WebContentsView positioned over Column A.
//   3. Handles draggable splitters (Col B width, GIF area height).
//   4. Applies user-chosen colors and border thickness.
//   5. Opens a WebSocket to the relay server and swaps the GIF when
//      Cretched's extension pushes bytes down the same room.

// ---------- DOM handles ----------
const columnA = document.getElementById('column-a');
const columnB = document.getElementById('column-b');
const gifArea = document.getElementById('gif-area');
const gifImg = document.getElementById('gif-img');
const gifShowcaseBtn = document.getElementById('gif-showcase');
const splitterH = document.getElementById('splitter-h');
const splitterV = document.getElementById('splitter-v');
const urlBar = document.getElementById('url-bar');
const goBtn = document.getElementById('go');
const backBtn = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn = document.getElementById('reload');
const serverInput = document.getElementById('server');
const roomInput = document.getElementById('room');
const tokenInput = document.getElementById('token');
const connectBtn = document.getElementById('connect');
const statusEl = document.getElementById('status');
const summaryStatusEl = document.getElementById('summary-status');
const relayControls = document.getElementById('relay-controls');
const relaySummary = document.getElementById('relay-summary');
const toggleRelayBtn = document.getElementById('toggle-relay');
const showRelayBtn = document.getElementById('show-relay');
const colBColor = document.getElementById('col-b-color');
const gifColor = document.getElementById('gif-color');
const gifBorder = document.getElementById('gif-border');
const tabsEl = document.getElementById('tabs');
const newTabBtn = document.getElementById('new-tab');
const appEl = document.querySelector('.app');

// ---------- Tab state (mirror of main) ----------
const tabState = new Map(); // id -> { title, url, loading, canGoBack, canGoForward }
let activeId = null;
let isGifShowcased = false;
let isFullscreen = false;
let chromeRevealTimer = null;

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const [id, tab] of tabState) {
    const el = document.createElement('div');
    el.className = 'tab' + (id === activeId ? ' active' : '') + (tab.loading ? ' loading' : '');
    el.title = tab.url || tab.title || '';
    el.innerHTML = [
      '<span class="spinner"></span>',
      '<span class="title"></span>',
      '<span class="close" title="Close">&times;</span>',
    ].join('');
    el.querySelector('.title').textContent = tab.title || 'New tab';
    el.addEventListener('mousedown', (event) => {
      if (event.target.classList.contains('close')) {
        event.stopPropagation();
        window.podcast.tabs.close(id);
        return;
      }

      window.podcast.tabs.activate(id);
    });
    tabsEl.appendChild(el);
  }
}

function refreshNavButtons() {
  const tab = tabState.get(activeId);
  backBtn.disabled = !tab || !tab.canGoBack;
  forwardBtn.disabled = !tab || !tab.canGoForward;
}

function refreshUrlBar() {
  if (document.activeElement === urlBar) {
    return;
  }

  const tab = tabState.get(activeId);
  urlBar.value = tab ? (tab.url || '') : '';
}

window.podcast.onTabCreated(({ id, url, title }) => {
  tabState.set(id, { title: title || 'New tab', url: url || '', loading: false });
  renderTabs();
});

window.podcast.onTabUpdated((delta) => {
  const tab = tabState.get(delta.id);
  if (!tab) {
    return;
  }

  Object.assign(tab, delta);
  renderTabs();
  if (delta.id === activeId) {
    refreshNavButtons();
    refreshUrlBar();
  }
});

window.podcast.onTabActivated(({ id }) => {
  activeId = id;
  renderTabs();
  refreshNavButtons();
  refreshUrlBar();
  pushBounds();
});

window.podcast.onTabClosed(({ id }) => {
  tabState.delete(id);
  if (activeId === id) {
    activeId = null;
  }
  renderTabs();
  refreshNavButtons();
  refreshUrlBar();
});

// ---------- Tab controls ----------
newTabBtn.addEventListener('click', () => window.podcast.tabs.open('https://example.com'));
backBtn.addEventListener('click', () => window.podcast.tabs.back(activeId));
forwardBtn.addEventListener('click', () => window.podcast.tabs.forward(activeId));
reloadBtn.addEventListener('click', () => window.podcast.tabs.reload(activeId));

// ---------- URL bar ----------
function submitUrl() {
  if (!activeId) {
    window.podcast.tabs.open(urlBar.value);
    return;
  }

  window.podcast.tabs.navigate(activeId, urlBar.value);
}

goBtn.addEventListener('click', submitUrl);
urlBar.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    submitUrl();
  }
});

// ---------- Keep embedded browser aligned with Column A ----------
function pushBounds() {
  if (isGifShowcased) {
    window.podcast.setMainBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }

  const rect = columnA.getBoundingClientRect();
  window.podcast.setMainBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
}

function setFullscreenChromeVisible(isVisible) {
  appEl.classList.toggle('chrome-visible', isVisible);
}

function setFullscreenMode(nextIsFullscreen) {
  isFullscreen = nextIsFullscreen;
  appEl.classList.toggle('fullscreen-ui', nextIsFullscreen);
  setFullscreenChromeVisible(false);

  if (isGifShowcased) {
    updateGifShowcaseBounds();
  }

  requestAnimationFrame(pushBounds);
}

function updateGifShowcaseBounds() {
  const rect = columnA.getBoundingClientRect();
  document.documentElement.style.setProperty('--gif-showcase-left', `${rect.left}px`);
  document.documentElement.style.setProperty('--gif-showcase-top', `${rect.top}px`);
  document.documentElement.style.setProperty('--gif-showcase-width', `${rect.width}px`);
  document.documentElement.style.setProperty('--gif-showcase-height', `${rect.height}px`);
}

function setGifShowcase(isShowcased) {
  isGifShowcased = isShowcased;
  gifArea.classList.toggle('showcased', isShowcased);
  gifShowcaseBtn.textContent = isShowcased ? '-' : '+';
  gifShowcaseBtn.title = isShowcased ? 'Return to lower-right area' : 'Show in main area';

  if (isShowcased) {
    updateGifShowcaseBounds();
  }

  pushBounds();
}

window.addEventListener('resize', () => {
  if (isGifShowcased) {
    updateGifShowcaseBounds();
  }
  pushBounds();
});
document.addEventListener('mousemove', (event) => {
  if (!isFullscreen) {
    return;
  }

  const shouldRevealChrome = event.clientY <= 10;
  if (shouldRevealChrome) {
    setFullscreenChromeVisible(true);
    clearTimeout(chromeRevealTimer);
    return;
  }

  if (event.clientY > 92 && appEl.classList.contains('chrome-visible')) {
    clearTimeout(chromeRevealTimer);
    chromeRevealTimer = setTimeout(() => setFullscreenChromeVisible(false), 450);
  }
});
window.podcast.onFullscreenChanged(({ isFullScreen }) => {
  setFullscreenMode(isFullScreen);
});
requestAnimationFrame(() => requestAnimationFrame(pushBounds));

// ---------- Splitters ----------
let dragH = false;
let dragV = false;

splitterH.addEventListener('mousedown', (event) => {
  dragH = true;
  event.preventDefault();
});

splitterV.addEventListener('mousedown', (event) => {
  dragV = true;
  event.preventDefault();
});

document.addEventListener('mousemove', (event) => {
  if (dragH) {
    const newWidth = window.innerWidth - event.clientX - 3;
    columnB.style.width = Math.max(200, Math.min(newWidth, window.innerWidth - 300)) + 'px';
    if (isGifShowcased) {
      updateGifShowcaseBounds();
    }
    pushBounds();
  }

  if (dragV) {
    const columnBRect = columnB.getBoundingClientRect();
    const newHeight = columnBRect.bottom - event.clientY - 3;
    gifArea.style.height = Math.max(80, Math.min(newHeight, columnBRect.height - 80)) + 'px';
  }
});

gifShowcaseBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  setGifShowcase(!isGifShowcased);
});

gifImg.addEventListener('click', () => {
  if (gifImg.classList.contains('visible') || isGifShowcased) {
    setGifShowcase(!isGifShowcased);
  }
});

gifArea.addEventListener('click', (event) => {
  if (isGifShowcased && event.target !== gifShowcaseBtn && event.target !== gifImg) {
    setGifShowcase(false);
  }
});

document.addEventListener('mouseup', () => {
  dragH = false;
  dragV = false;
});

// ---------- Style controls ----------
colBColor.addEventListener('input', (event) => {
  document.getElementById('column-b-content').style.background = event.target.value;
});

gifColor.addEventListener('input', (event) => {
  gifArea.style.background = event.target.value;
});

gifBorder.addEventListener('input', (event) => {
  gifArea.style.borderWidth = Math.max(0, parseInt(event.target.value, 10) || 0) + 'px';
});

// ---------- Relay connection ----------
let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let shouldReconnect = false;
let currentBlobUrl = null;

function setStatus(text, ok) {
  statusEl.textContent = text;
  summaryStatusEl.textContent = text;
  statusEl.classList.toggle('connected', !!ok);
  summaryStatusEl.classList.toggle('connected', !!ok);
}

function setRelayDetailsVisible(isVisible) {
  relayControls.classList.toggle('hidden', !isVisible);
  relaySummary.classList.toggle('hidden', isVisible);
}

async function restoreConfig() {
  try {
    const config = await window.podcast.config.load();
    const relay = config.relay || {};

    serverInput.value = relay.server || serverInput.value;
    roomInput.value = relay.room || roomInput.value;
    tokenInput.value = relay.token || '';

    if (relay.server || relay.room || relay.hasEncryptedToken) {
      setRelayDetailsVisible(false);
    }
  } catch (_) {}
}

function saveRelayConfig() {
  return window.podcast.config.save({
    relay: {
      server: serverInput.value,
      room: roomInput.value,
      token: tokenInput.value,
    },
  });
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function revokeCurrentBlobUrl() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}

function buildRelayUrl() {
  const relayUrl = new URL(serverInput.value);
  relayUrl.searchParams.set('room', roomInput.value);
  relayUrl.searchParams.set('role', 'receiver');

  const token = tokenInput.value.trim();
  if (token) {
    relayUrl.searchParams.set('token', token);
  }

  return relayUrl.toString();
}

function scheduleReconnect() {
  clearReconnectTimer();
  if (!shouldReconnect) {
    return;
  }

  const delayMs = Math.min(30_000, 1_000 * (2 ** reconnectAttempt));
  reconnectAttempt += 1;
  setStatus(`disconnected, retrying in ${Math.round(delayMs / 1000)}s`, false);
  reconnectTimer = setTimeout(connectToRelay, delayMs);
}

function connectToRelay() {
  clearReconnectTimer();

  if (ws) {
    try {
      ws.close();
    } catch (_) {}
  }

  let relayUrl;
  try {
    relayUrl = buildRelayUrl();
  } catch (_) {
    setStatus('invalid relay url', false);
    return;
  }

  ws = new WebSocket(relayUrl);
  ws.binaryType = 'arraybuffer';
  setStatus('connecting...', false);

  ws.onopen = () => {
    reconnectAttempt = 0;
    setStatus('connected', true);
  };

  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    setStatus('connection error', false);
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'gif-url' && message.url) {
          showGif(message.url);
        }
      } catch (_) {}
      return;
    }

    const blob = new Blob([event.data]);
    const objectUrl = URL.createObjectURL(blob);
    showGif(objectUrl, { revokePrevious: true });
  };
}

connectBtn.addEventListener('click', () => {
  shouldReconnect = true;
  reconnectAttempt = 0;
  saveRelayConfig().catch(() => {});
  connectToRelay();
});

toggleRelayBtn.addEventListener('click', () => {
  setRelayDetailsVisible(false);
});

showRelayBtn.addEventListener('click', () => {
  setRelayDetailsVisible(true);
});

function showGif(src, { revokePrevious = false } = {}) {
  if (revokePrevious) {
    revokeCurrentBlobUrl();
    currentBlobUrl = src;
  } else {
    revokeCurrentBlobUrl();
  }

  gifImg.onload = () => gifArea.classList.add('has-image');
  gifImg.classList.add('visible');
  gifImg.src = src;
}

window.addEventListener('beforeunload', () => {
  shouldReconnect = false;
  clearReconnectTimer();
  revokeCurrentBlobUrl();
  if (ws) {
    try {
      ws.close();
    } catch (_) {}
  }
});

restoreConfig();

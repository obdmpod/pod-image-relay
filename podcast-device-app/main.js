// Electron main process (multi-tab edition).
//
// Instead of one embedded browser for Column A, we keep a Map of tabs:
//   tabId -> { view: WebContentsView, title, url, canGoBack, canGoForward }
//
// Only the *active* tab's view is attached to the window at any moment;
// switching tabs is a remove + add. Each view emits navigation events
// (title, url, loading state) which we forward to the renderer so the tab
// strip and URL bar can stay in sync.

const { app, BrowserWindow, WebContentsView, ipcMain, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { setupContentBlocking } = require('./lib/content-blocking');
const { coerceUrl } = require('./lib/coerce-url');

let mainWindow;
const tabs = new Map();       // tabId -> { view, title, url }
let activeTabId = null;
let lastBounds = { x: 0, y: 84, width: 1200, height: 800 };
const CONFIG_FILE = 'settings.json';
const MIN_ZOOM_FACTOR = 0.25;
const MAX_ZOOM_FACTOR = 3;
const ZOOM_STEP = 0.1;
const DEFAULT_CONFIG = {
  relay: {
    server: 'ws://localhost:8080',
    room: 'mike-cretched-1',
    token: '',
  },
  appearance: {
    columnBColor: '#151922',
    gifColor: '#0F2530',
    gifBorder: 2,
  },
};

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setFullscreenUi(isFullScreen) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setMenuBarVisibility(!isFullScreen);
  send('fullscreen-changed', { isFullScreen });
}

function getNavigationState(wc) {
  const history = wc.navigationHistory;

  return {
    canGoBack: typeof history?.canGoBack === 'function' ? history.canGoBack() : wc.canGoBack(),
    canGoForward: typeof history?.canGoForward === 'function' ? history.canGoForward() : wc.canGoForward(),
  };
}

function goBack(wc) {
  const history = wc.navigationHistory;
  if (typeof history?.goBack === 'function') {
    history.goBack();
    return;
  }

  if (wc.canGoBack()) {
    wc.goBack();
  }
}

function goForward(wc) {
  const history = wc.navigationHistory;
  if (typeof history?.goForward === 'function') {
    history.goForward();
    return;
  }

  if (wc.canGoForward()) {
    wc.goForward();
  }
}

function getActiveWebContents() {
  if (!activeTabId || !tabs.has(activeTabId)) {
    return null;
  }

  return tabs.get(activeTabId).view.webContents;
}

function setWebContentsZoom(wc, nextZoomFactor) {
  if (!wc || wc.isDestroyed()) {
    return;
  }

  const boundedZoom = Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, nextZoomFactor));
  wc.setZoomFactor(Number(boundedZoom.toFixed(2)));
}

function adjustWebContentsZoom(wc, direction) {
  if (!wc || wc.isDestroyed()) {
    return;
  }

  setWebContentsZoom(wc, wc.getZoomFactor() + (direction * ZOOM_STEP));
}

function handleZoomShortcut(input, fallbackWebContents) {
  if (!input || input.type !== 'keyDown' || !(input.control || input.meta)) {
    return false;
  }

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '');
  const target = fallbackWebContents || getActiveWebContents();

  if (key === '+' || key === '=' || code === 'NumpadAdd') {
    adjustWebContentsZoom(target, 1);
    return true;
  }

  if (key === '-' || key === '_' || code === 'NumpadSubtract') {
    adjustWebContentsZoom(target, -1);
    return true;
  }

  if (key === '0' || code === 'Numpad0' || code === 'Digit0') {
    setWebContentsZoom(target, 1);
    return true;
  }

  return false;
}

function handleBrowserUiShortcut(input) {
  if (!input || input.type !== 'keyDown') {
    return false;
  }

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '');
  const wantsUrlBar = ((input.control || input.meta) && key === 'l') || code === 'F6';

  if (wantsUrlBar) {
    send('focus-url-bar');
    return true;
  }

  return false;
}

function registerBrowserShortcuts(wc) {
  wc.on('before-input-event', (event, input) => {
    if (handleBrowserUiShortcut(input)) {
      event.preventDefault();
      return;
    }

    if (handleZoomShortcut(input, wc)) {
      event.preventDefault();
    }
  });
}

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function decryptToken(encryptedToken) {
  if (!encryptedToken || !safeStorage.isEncryptionAvailable()) {
    return '';
  }

  try {
    return safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'));
  } catch (_) {
    return '';
  }
}

function normalizedColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function normalizedBorder(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(40, Math.max(0, Math.round(parsed)));
}

function loadAppConfig() {
  const stored = readConfigFile();
  const relay = stored.relay || {};
  const appearance = stored.appearance || {};

  return {
    relay: {
      server: relay.server || DEFAULT_CONFIG.relay.server,
      room: relay.room || DEFAULT_CONFIG.relay.room,
      token: decryptToken(relay.encryptedToken),
      hasEncryptedToken: Boolean(relay.encryptedToken),
      tokenStoredSecurely: Boolean(relay.encryptedToken && safeStorage.isEncryptionAvailable()),
    },
    appearance: {
      columnBColor: normalizedColor(appearance.columnBColor, DEFAULT_CONFIG.appearance.columnBColor),
      gifColor: normalizedColor(appearance.gifColor, DEFAULT_CONFIG.appearance.gifColor),
      gifBorder: normalizedBorder(appearance.gifBorder, DEFAULT_CONFIG.appearance.gifBorder),
    },
  };
}

function saveAppConfig(nextConfig = {}) {
  const current = readConfigFile();
  const currentRelay = current.relay || {};
  const nextRelay = nextConfig.relay || {};
  const relay = { ...currentRelay };

  if (Object.prototype.hasOwnProperty.call(nextRelay, 'server')) {
    relay.server = String(nextRelay.server || '').trim() || DEFAULT_CONFIG.relay.server;
  }

  if (Object.prototype.hasOwnProperty.call(nextRelay, 'room')) {
    relay.room = String(nextRelay.room || '').trim() || DEFAULT_CONFIG.relay.room;
  }

  if (typeof nextRelay.token === 'string') {
    const token = nextRelay.token.trim();
    if (token && safeStorage.isEncryptionAvailable()) {
      relay.encryptedToken = safeStorage.encryptString(token).toString('base64');
    } else if (!token) {
      delete relay.encryptedToken;
    }
  }

  const currentAppearance = current.appearance || {};
  const nextAppearance = nextConfig.appearance || {};
  const appearance = {
    ...currentAppearance,
  };

  if (Object.prototype.hasOwnProperty.call(nextAppearance, 'columnBColor')) {
    appearance.columnBColor = normalizedColor(nextAppearance.columnBColor, DEFAULT_CONFIG.appearance.columnBColor);
  }

  if (Object.prototype.hasOwnProperty.call(nextAppearance, 'gifColor')) {
    appearance.gifColor = normalizedColor(nextAppearance.gifColor, DEFAULT_CONFIG.appearance.gifColor);
  }

  if (Object.prototype.hasOwnProperty.call(nextAppearance, 'gifBorder')) {
    appearance.gifBorder = normalizedBorder(nextAppearance.gifBorder, DEFAULT_CONFIG.appearance.gifBorder);
  }

  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), CONFIG_FILE), JSON.stringify({ ...current, relay, appearance }, null, 2));
  return loadAppConfig();
}

function createTab(initialUrl = 'https://example.com') {
  const id = randomUUID();
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const wc = view.webContents;
  registerBrowserShortcuts(wc);

  // Keep the renderer's tab strip + URL bar in sync with real navigation.
  wc.on('page-title-updated', (_e, title) => {
    const t = tabs.get(id); if (!t) return;
    t.title = title;
    send('tab-updated', { id, title });
  });
  const emitUrl = () => {
    const t = tabs.get(id); if (!t) return;
    t.url = wc.getURL();
    const navigationState = getNavigationState(wc);
    send('tab-updated', {
      id,
      url: t.url,
      ...navigationState,
    });
  };
  wc.on('did-navigate', emitUrl);
  wc.on('did-navigate-in-page', emitUrl);
  wc.on('did-start-loading', () => send('tab-updated', { id, loading: true }));
  wc.on('did-stop-loading',  () => send('tab-updated', { id, loading: false }));

  // target="_blank" / window.open → spawn a new tab instead of a popup.
  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });

  tabs.set(id, { view, title: 'New tab', url: initialUrl });
  wc.loadURL(coerceUrl(initialUrl));

  send('tab-created', { id, url: initialUrl, title: 'New tab' });
  activateTab(id);
  return id;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  if (activeTabId && tabs.has(activeTabId) && activeTabId !== id) {
    try { mainWindow.contentView.removeChildView(tabs.get(activeTabId).view); } catch (_) {}
  }
  activeTabId = id;
  const { view } = tabs.get(id);
  mainWindow.contentView.addChildView(view);
  view.setBounds(lastBounds);
  send('tab-activated', { id });
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  try { mainWindow.contentView.removeChildView(tab.view); } catch (_) {}
  try { tab.view.webContents.close(); } catch (_) {
    try { tab.view.webContents.destroy(); } catch (__) {}
  }
  tabs.delete(id);
  send('tab-closed', { id });
  if (activeTabId === id) {
    const next = [...tabs.keys()].pop() || null;
    activeTabId = null;
    if (next) activateTab(next);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (handleZoomShortcut(input)) {
      event.preventDefault();
    }
  });
  mainWindow.on('enter-full-screen', () => setFullscreenUi(true));
  mainWindow.on('leave-full-screen', () => setFullscreenUi(false));

  // Open one starter tab once the UI is ready.
  mainWindow.webContents.once('did-finish-load', () => {
    send('fullscreen-changed', { isFullScreen: mainWindow.isFullScreen() });
    createTab('https://example.com');
  });
}

// ---------- IPC ----------
ipcMain.handle('tab-new',      (_e, url)  => createTab(url || 'about:blank'));
ipcMain.handle('tab-close',    (_e, id)   => closeTab(id));
ipcMain.handle('tab-activate', (_e, id)   => activateTab(id));
ipcMain.handle('tab-navigate', (_e, { id, url }) => {
  const tab = tabs.get(id || activeTabId); if (!tab) return;
  tab.view.webContents.loadURL(coerceUrl(url));
});
ipcMain.handle('tab-back', (_e, id) => {
  const tab = tabs.get(id || activeTabId); if (!tab) return;
  goBack(tab.view.webContents);
});
ipcMain.handle('tab-forward', (_e, id) => {
  const tab = tabs.get(id || activeTabId); if (!tab) return;
  goForward(tab.view.webContents);
});
ipcMain.handle('tab-reload', (_e, id) => {
  const tab = tabs.get(id || activeTabId); if (!tab) return;
  tab.view.webContents.reload();
});
ipcMain.handle('config-load', () => loadAppConfig());
ipcMain.handle('config-save', (_e, config) => saveAppConfig(config));

// Position the active tab's view to match Column A's rectangle.
ipcMain.handle('set-bounds', (_e, bounds) => {
  lastBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width:  Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
  if (activeTabId && tabs.has(activeTabId)) {
    tabs.get(activeTabId).view.setBounds(lastBounds);
  }
});

app.whenReady().then(() => {
  setupContentBlocking(session.defaultSession);
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

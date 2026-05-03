// Bridge between the renderer (HTML UI) and the main process (window + tabs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('podcast', {
  // Position the active tab's embedded browser over Column A.
  setMainBounds: (bounds) => ipcRenderer.invoke('set-bounds', bounds),

  config: {
    load: () => ipcRenderer.invoke('config-load'),
    save: (config) => ipcRenderer.invoke('config-save', config),
  },

  // Tab management
  tabs: {
    open:     (url)          => ipcRenderer.invoke('tab-new', url),
    close:    (id)           => ipcRenderer.invoke('tab-close', id),
    activate: (id)           => ipcRenderer.invoke('tab-activate', id),
    navigate: (id, url)      => ipcRenderer.invoke('tab-navigate', { id, url }),
    back:     (id)           => ipcRenderer.invoke('tab-back', id),
    forward:  (id)           => ipcRenderer.invoke('tab-forward', id),
    reload:   (id)           => ipcRenderer.invoke('tab-reload', id),
  },

  // Subscribe to tab events from the main process.
  onTabCreated:   (cb) => ipcRenderer.on('tab-created',   (_e, d) => cb(d)),
  onTabUpdated:   (cb) => ipcRenderer.on('tab-updated',   (_e, d) => cb(d)),
  onTabActivated: (cb) => ipcRenderer.on('tab-activated', (_e, d) => cb(d)),
  onTabClosed:    (cb) => ipcRenderer.on('tab-closed',    (_e, d) => cb(d)),
  onFullscreenChanged: (cb) => ipcRenderer.on('fullscreen-changed', (_e, d) => cb(d)),
  onFocusUrlBar: (cb) => ipcRenderer.on('focus-url-bar', () => cb()),
});

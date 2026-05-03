const MENU_ID = 'send-to-podcast-device';
const KEYS = ['server', 'room', 'token'];

function relayUrl(settings) {
  return `${settings.server}?room=${encodeURIComponent(settings.room)}`
       + `&role=sender&token=${encodeURIComponent(settings.token)}`;
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

function getSettings() {
  return chrome.storage.local.get(KEYS);
}

function sendGifUrlToRelay(url) {
  return getSettings().then((settings) => new Promise((resolve, reject) => {
    if (!settings.server || !settings.room || !settings.token) {
      reject(new Error('Open the extension popup and save relay settings first.'));
      return;
    }

    const ws = new WebSocket(relayUrl(settings));
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'gif-url', url }));
      ws.close(1000, 'sent');
      resolve();
    };
    ws.onerror = () => reject(new Error('Relay connection failed.'));
    ws.onclose = (event) => {
      if (event.code !== 1000 && event.reason) {
        reject(new Error(event.reason));
      }
    };
  }));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Send image/GIF to Podcast Device',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) {
    return;
  }

  sendGifUrlToRelay(info.srcUrl)
    .then(() => setBadge('Sent', '#2e7d32'))
    .catch(() => setBadge('Err', '#c62828'));
});

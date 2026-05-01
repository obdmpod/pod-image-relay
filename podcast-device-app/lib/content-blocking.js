const BLOCKED_HOST_SUFFIXES = [
  '2mdn.net',
  'adnxs.com',
  'adsafeprotected.com',
  'adsrvr.org',
  'adservice.google.com',
  'amazon-adsystem.com',
  'analytics.google.com',
  'casalemedia.com',
  'connect.facebook.net',
  'criteo.com',
  'criteo.net',
  'doubleclick.net',
  'facebook.net',
  'google-analytics.com',
  'googleadservices.com',
  'googlesyndication.com',
  'googletagmanager.com',
  'googletagservices.com',
  'imasdk.googleapis.com',
  'moatads.com',
  'openx.net',
  'outbrain.com',
  'pubmatic.com',
  'rubiconproject.com',
  'scorecardresearch.com',
  'taboola.com',
  'yieldmo.com',
];

const BLOCKED_URL_PATTERNS = [
  /(^|[/?&_.-])adserver([/?&_.-]|$)/i,
  /(^|[/?&_.-])ads?([/?&_.-]|$)/i,
  /(^|[/?&_.-])advertis/i,
  /(^|[/?&_.-])analytics([/?&_.-]|$)/i,
  /(^|[/?&_.-])banner([/?&_.-]|$)/i,
  /(^|[/?&_.-])beacon([/?&_.-]|$)/i,
  /(^|[/?&_.-])pixel([/?&_.-]|$)/i,
  /(^|[/?&_.-])tracker?([/?&_.-]|$)/i,
  /\/pagead\//i,
  /\/prebid(?:\.|\/)/i,
];

function normalizeHostname(hostname) {
  return String(hostname || '').replace(/\.$/, '').toLowerCase();
}

function hostnameMatchesSuffix(hostname, suffix) {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedSuffix = normalizeHostname(suffix);
  return normalizedHostname === normalizedSuffix || normalizedHostname.endsWith(`.${normalizedSuffix}`);
}

function shouldBlockRequest(details = {}) {
  if (details.resourceType === 'mainFrame') {
    return false;
  }

  let url;
  try {
    url = new URL(details.url);
  } catch (_) {
    return false;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return false;
  }

  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostnameMatchesSuffix(url.hostname, suffix))) {
    return true;
  }

  return BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(url.href));
}

function setupContentBlocking(session) {
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      callback({ cancel: shouldBlockRequest(details) });
    }
  );
}

module.exports = {
  BLOCKED_HOST_SUFFIXES,
  hostnameMatchesSuffix,
  setupContentBlocking,
  shouldBlockRequest,
};

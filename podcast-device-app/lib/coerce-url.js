function coerceUrl(input) {
  const value = String(input || '').trim();

  if (!value) {
    return 'about:blank';
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) || value.startsWith('about:')) {
    return value;
  }

  if (/^[^\s]+\.[^\s]+$/.test(value)) {
    return `https://${value}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

module.exports = { coerceUrl };

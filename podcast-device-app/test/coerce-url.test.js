const test = require('node:test');
const assert = require('node:assert/strict');

const { coerceUrl } = require('../lib/coerce-url');

test('returns about:blank for empty input', () => {
  assert.equal(coerceUrl(''), 'about:blank');
  assert.equal(coerceUrl('   '), 'about:blank');
});

test('preserves explicit urls', () => {
  assert.equal(coerceUrl('https://example.com'), 'https://example.com');
  assert.equal(coerceUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(coerceUrl('about:blank'), 'about:blank');
});

test('adds https to bare hostnames', () => {
  assert.equal(coerceUrl('example.com'), 'https://example.com');
  assert.equal(coerceUrl('sub.domain.dev/path'), 'https://sub.domain.dev/path');
});

test('turns search text into a google query', () => {
  assert.equal(
    coerceUrl('podcast device build plan'),
    'https://www.google.com/search?q=podcast%20device%20build%20plan'
  );
});

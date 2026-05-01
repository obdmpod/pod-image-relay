const test = require('node:test');
const assert = require('node:assert/strict');

const { hostnameMatchesSuffix, shouldBlockRequest } = require('../lib/content-blocking');

test('matches exact and nested blocked hostnames', () => {
  assert.equal(hostnameMatchesSuffix('doubleclick.net', 'doubleclick.net'), true);
  assert.equal(hostnameMatchesSuffix('securepubads.doubleclick.net', 'doubleclick.net'), true);
  assert.equal(hostnameMatchesSuffix('notdoubleclick.net', 'doubleclick.net'), false);
});

test('does not block main frame navigation', () => {
  assert.equal(
    shouldBlockRequest({ url: 'https://doubleclick.net/', resourceType: 'mainFrame' }),
    false
  );
});

test('blocks common ad and tracker subrequests', () => {
  assert.equal(
    shouldBlockRequest({ url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', resourceType: 'script' }),
    true
  );
  assert.equal(
    shouldBlockRequest({ url: 'https://example.com/static/pagead/banner.js', resourceType: 'script' }),
    true
  );
});

test('allows normal first-party content', () => {
  assert.equal(
    shouldBlockRequest({ url: 'https://example.com/assets/app.js', resourceType: 'script' }),
    false
  );
});

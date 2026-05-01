const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.resolve(__dirname, '..');

test('manifest points at the popup and requests storage permission', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual(manifest.permissions, ['storage']);
});

test('popup contains the expected controls for relay connection and drag-drop', () => {
  const popupHtml = fs.readFileSync(path.join(extensionDir, 'popup.html'), 'utf8');

  for (const id of ['server', 'room', 'token', 'connect', 'drop', 'preview', 'status']) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }
});

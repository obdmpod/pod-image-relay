const test = require('node:test');
const assert = require('node:assert/strict');

const { createRelayServer } = require('../server');

function waitForMessage(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
    };

    const onMessage = (event) => {
      cleanup();
      resolve(event.data);
    };

    const onError = (event) => {
      cleanup();
      reject(event.error || new Error('socket error'));
    };

    socket.addEventListener('message', onMessage, { once: true });
    socket.addEventListener('error', onError, { once: true });
  });
}

function waitForClose(socket) {
  return new Promise((resolve) => {
    socket.addEventListener('close', resolve, { once: true });
  });
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', (event) => {
      reject(event.error || new Error('socket error'));
    }, { once: true });
  });
  return socket;
}

async function withRelay(run, overrides = {}) {
  const relay = createRelayServer({
    HOST: '127.0.0.1',
    PORT: '0',
    TOKEN: 'test-token',
    MAX_MSGS_PER_MIN: '30',
    ...overrides,
  });

  await relay.start();
  try {
    const port = relay.server.address().port;
    await run({ relay, port });
  } finally {
    await relay.stop();
  }
}

test('health endpoint returns ok', async () => {
  await withRelay(async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body, 'podcast relay: ok\n');
  });
});

test('sender messages are forwarded to matching receivers', async () => {
  await withRelay(async ({ port }) => {
    const receiver = await openSocket(
      `ws://127.0.0.1:${port}/?room=studio&role=receiver&token=test-token`
    );
    const sender = await openSocket(
      `ws://127.0.0.1:${port}/?room=studio&role=sender&token=test-token`
    );

    const messagePromise = waitForMessage(receiver);
    sender.send('hello mike');
    const message = await messagePromise;

    assert.equal(message, 'hello mike');

    sender.close();
    receiver.close();
  });
});

test('wrong token closes the socket with code 4001', async () => {
  await withRelay(async ({ port }) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/?room=studio&role=receiver&token=wrong-token`
    );

    const closeEvent = await waitForClose(socket);
    assert.equal(closeEvent.code, 4001);
  });
});

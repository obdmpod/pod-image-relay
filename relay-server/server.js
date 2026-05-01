const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

function parseConfig(env = process.env) {
  const readNumber = (key, fallback) => {
    if (env[key] === undefined || env[key] === '') {
      return fallback;
    }

    const parsed = Number(env[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    host: env.HOST || '127.0.0.1',
    port: readNumber('PORT', 8080),
    sharedToken: env.TOKEN || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    maxPayloadBytes: readNumber('MAX_PAYLOAD_BYTES', 8 * 1024 * 1024),
    maxMsgsPerMin: readNumber('MAX_MSGS_PER_MIN', 30),
    maxConnsPerIp: readNumber('MAX_CONNS_PER_IP', 5),
    pingIntervalMs: readNumber('PING_INTERVAL_MS', 30000),
  };
}

function log(message, extra = {}) {
  const parts = [`[${new Date().toISOString()}]`, message];
  for (const [key, value] of Object.entries(extra)) {
    parts.push(`${key}=${value}`);
  }
  console.log(parts.join(' '));
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function createRelayServer(env = process.env) {
  const config = parseConfig(env);
  const rooms = new Map();
  const ipCounts = new Map();

  function getRoom(id) {
    if (!rooms.has(id)) {
      rooms.set(id, { receivers: new Set(), senders: new Set() });
    }

    return rooms.get(id);
  }

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('podcast relay: ok\n');
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: config.maxPayloadBytes,
    verifyClient: ({ req, origin }, callback) => {
      const ip = clientIp(req);

      if (config.allowedOrigins.length > 0) {
        const checkedOrigin = origin || 'null';
        if (!config.allowedOrigins.includes(checkedOrigin)) {
          log('reject origin', { ip, origin: checkedOrigin });
          callback(false, 403, 'bad origin');
          return;
        }
      }

      const connections = ipCounts.get(ip) || 0;
      if (connections >= config.maxConnsPerIp) {
        log('reject ip-cap', { ip, n: connections });
        callback(false, 429, 'too many connections');
        return;
      }

      callback(true);
    },
  });

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    const requestUrl = new URL(req.url, 'http://localhost');
    const roomId = (requestUrl.searchParams.get('room') || '').slice(0, 64) || 'default';
    const role = requestUrl.searchParams.get('role') === 'sender' ? 'sender' : 'receiver';
    const token = requestUrl.searchParams.get('token') || '';

    if (config.sharedToken && !constantTimeEqual(token, config.sharedToken)) {
      log('reject token', { ip, room: roomId });
      ws.close(4001, 'bad token');
      return;
    }

    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);

    const room = getRoom(roomId);
    (role === 'sender' ? room.senders : room.receivers).add(ws);
    log('+connect', { role, ip, room: roomId, s: room.senders.size, r: room.receivers.size });

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const recentSends = [];

    ws.on('message', (data, isBinary) => {
      if (role !== 'sender') {
        return;
      }

      const now = Date.now();
      while (recentSends.length && recentSends[0] < now - 60_000) {
        recentSends.shift();
      }

      if (recentSends.length >= config.maxMsgsPerMin) {
        log('rate-limit', { ip, room: roomId });
        ws.close(1008, 'rate limit');
        return;
      }

      recentSends.push(now);

      for (const receiver of room.receivers) {
        if (receiver.readyState === receiver.OPEN) {
          receiver.send(data, { binary: isBinary });
        }
      }
    });

    ws.on('close', () => {
      room.senders.delete(ws);
      room.receivers.delete(ws);
      if (room.senders.size === 0 && room.receivers.size === 0) {
        rooms.delete(roomId);
      }

      const nextCount = (ipCounts.get(ip) || 1) - 1;
      if (nextCount <= 0) {
        ipCounts.delete(ip);
      } else {
        ipCounts.set(ip, nextCount);
      }

      log('-disconnect', { role, ip, room: roomId });
    });

    ws.on('error', (error) => {
      log('ws-error', { ip, msg: error.message });
    });
  });

  let heartbeat = null;

  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });

    heartbeat = setInterval(() => {
      for (const client of wss.clients) {
        if (client.isAlive === false) {
          try {
            client.terminate();
          } catch (_) {}
          continue;
        }

        client.isAlive = false;
        try {
          client.ping();
        } catch (_) {}
      }
    }, config.pingIntervalMs);

    log('listening', {
      bind: `${config.host}:${server.address().port}`,
      token: config.sharedToken ? 'set' : 'NONE',
      origins: config.allowedOrigins.length ? config.allowedOrigins.join('|') : 'ANY',
      maxPayload: config.maxPayloadBytes,
      rate: `${config.maxMsgsPerMin}/min`,
      ipCap: config.maxConnsPerIp,
    });
  }

  async function stop() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    await new Promise((resolve) => {
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  }

  return { config, server, wss, rooms, ipCounts, start, stop };
}

async function main() {
  const relay = createRelayServer(process.env);

  const shutdown = (signal) => {
    log('shutdown', { sig: signal });
    relay.stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await relay.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  clientIp,
  constantTimeEqual,
  createRelayServer,
  parseConfig,
};

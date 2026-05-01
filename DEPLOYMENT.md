# Deploying the relay server on Digital Ocean

This guide walks through standing up the Podcast Device relay on a Digital
Ocean droplet in a way that is safe to leave running 24/7. It assumes you
have: a Digital Ocean account, a domain name you can point at the droplet
(recommended for TLS), and `ssh` installed locally.

The target end-state:

- One small Ubuntu 24.04 droplet running the Node relay under `systemd`.
- Caddy in front of Node, terminating TLS with a free Let's Encrypt cert
  and providing `wss://podcast.example.com` to clients.
- UFW firewall restricting inbound traffic to SSH, HTTP, and HTTPS.
- Fail2ban blocking SSH brute-force attempts.
- Unattended security upgrades installed.
- A non-root `deploy` user; root SSH login disabled; password auth off.
- Shared tokens, origin allowlist, per-IP rate limiting, and WebSocket
  ping/pong enforced by the app layer.

Expected monthly cost: the smallest droplet ($4–$6 USD / month) is plenty
for a two-person podcast device. Bandwidth is negligible unless Cretched is
pushing enormous GIFs.

---

## Alternative: deploy the relay on Railway

If you want a managed platform instead of maintaining a VPS, Railway is a
good fit for this relay. The service is small, long-running, stateless,
and only needs a public HTTPS endpoint with WebSocket support, environment
variables, and a predictable restart policy.

What Railway replaces from the Digital Ocean path:

- no droplet creation
- no SSH hardening
- no UFW / fail2ban
- no `systemd`
- no Caddy config for TLS termination

### Railway quick path

1. Create a new Railway project.
2. Add a service from this repo and point it at the `relay-server/`
   subdirectory.
3. Let Railway install dependencies with `npm install`.
4. Set the start command to:

```bash
npm start
```

5. Add these environment variables in the Railway dashboard:

```bash
HOST=0.0.0.0
TOKEN=CHANGE_ME_TO_A_LONG_RANDOM_STRING
ALLOWED_ORIGINS=https://podcast.example.com,chrome-extension://YOUR_EXTENSION_ID,null
MAX_PAYLOAD_BYTES=8388608
MAX_MSGS_PER_MIN=30
MAX_CONNS_PER_IP=5
PING_INTERVAL_MS=30000
```

Notes:

- Do **not** hard-code `PORT` on Railway. Railway injects `PORT` for the
  running container, and the relay already honors `process.env.PORT`.
- `HOST` should be `0.0.0.0` on Railway so the platform router can reach
  the process.
- Keep `TOKEN` long and random (`openssl rand -hex 32` is fine locally).
- Include `null` in `ALLOWED_ORIGINS` if Mike's Electron app is still
  connecting from a `file://` origin during local testing.
- Add Cretched's real extension origin once the extension ID is stable.

### Public URL and domains

After the first deploy, Railway will assign a public domain for the
service. You can use that immediately for testing, or attach your own
domain (for example `podcast.example.com`) in the Railway networking
settings.

For clients, use:

- Relay server: `wss://YOUR_RAILWAY_DOMAIN`
- Room code: any shared room value, e.g. `mike-cretched-1`
- Token: the same value you set in Railway

### Deploy flow

If the repo is connected to GitHub, each push can trigger a fresh Railway
deployment automatically. For this relay, that is usually enough:

1. push code
2. wait for Railway to build and restart the service
3. verify the health endpoint with:

```bash
curl -I https://YOUR_RAILWAY_DOMAIN/
```

You should get an HTTP 200 response from the relay's `/` handler.

### Railway-specific security notes

- Railway terminates TLS for you, so clients should always use `wss://`.
- App-layer controls still matter. Keep `TOKEN`, `ALLOWED_ORIGINS`,
  payload caps, per-IP limits, and ping/pong enabled exactly as in the
  hardened relay design.
- Because Railway is the public edge, `HOST=127.0.0.1` is wrong there.
  Use `0.0.0.0` only on Railway; keep `127.0.0.1` for self-hosted VPS
  deployments behind Caddy.

If you choose Railway, you can skip Sections 1 through 6 below and jump
straight to **7. Point the clients at the relay**.

---

## 1. Create the droplet

In the Digital Ocean console: **Create → Droplets**.

- **Image**: Ubuntu 24.04 (LTS) x64.
- **Droplet type**: Basic.
- **CPU options**: Regular with SSD, the 1 GB / 1 CPU / $6 tier is fine.
  The $4 one also works for a single podcast; upgrade later if needed.
- **Datacenter**: pick the region closest to whichever side of the stream
  is more latency-sensitive — usually Mike.
- **Authentication**: SSH key (NOT password). Upload your public key if
  it's not already in your account.
- **Hostname**: `podcast-relay` (shows up in logs).
- **Firewall**: you can create a DO Cloud Firewall allowing tcp/22, tcp/80,
  tcp/443 and attach it here; we'll also enable UFW inside the host for
  defense in depth.

Once the droplet is created, note its public IPv4 address.

Point a DNS `A` record at that IP — e.g. `podcast.example.com → 203.0.113.42`.
Wait a minute or two for DNS to propagate.

---

## 2. First-time SSH and basic hardening

From your laptop:

```bash
ssh root@203.0.113.42
```

Once in, do this immediately:

```bash
# Create a non-root user with sudo
adduser deploy                            # set a strong password, answer defaults
usermod -aG sudo deploy

# Copy your SSH key over so you can log in as deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Update the base system
apt update && apt -y upgrade

# Core tools
apt -y install ufw fail2ban unattended-upgrades curl git
```

### Lock down SSH

Edit `/etc/ssh/sshd_config` (or drop a file in `/etc/ssh/sshd_config.d/`):

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Restart: `systemctl reload ssh`.

From a **new terminal** (leave the root session open until you confirm):

```bash
ssh deploy@203.0.113.42        # must succeed
```

Only after that succeeds, close the root session.

### Enable the firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp           # Caddy uses this to solve HTTP-01 challenges
sudo ufw allow 443/tcp          # wss:// traffic
sudo ufw enable
sudo ufw status verbose
```

Node itself listens on `127.0.0.1:8080`, never on a public interface, so
the firewall doesn't need to open 8080.

### Unattended security upgrades

```bash
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Accept defaults — the droplet now pulls security patches nightly.

### Fail2ban

Ships with sensible SSH defaults. Just make sure it's running:

```bash
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

---

## 3. Install Node.js

Use NodeSource, not the distro package (ancient):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
node --version   # should print v20.x
```

---

## 4. Deploy the relay code

As `deploy`:

```bash
sudo mkdir -p /opt/podcast-relay
sudo chown deploy:deploy /opt/podcast-relay
cd /opt/podcast-relay

# Either git clone the repo, or scp from your laptop:
# scp -r ./relay-server deploy@203.0.113.42:/opt/podcast-relay/
# Assume files now live at /opt/podcast-relay/

npm install --omit=dev
```

Create `/opt/podcast-relay/.env` (owner `deploy`, mode `600`):

```bash
cat > /opt/podcast-relay/.env <<'EOF'
PORT=8080
HOST=127.0.0.1
TOKEN=CHANGE_ME_TO_A_LONG_RANDOM_STRING
ALLOWED_ORIGINS=https://podcast.example.com,chrome-extension://YOUR_EXTENSION_ID
MAX_PAYLOAD_BYTES=8388608
MAX_MSGS_PER_MIN=30
EOF
chmod 600 /opt/podcast-relay/.env
```

Generate the token with `openssl rand -hex 32`. Put the same token in
Cretched's extension popup and Mike's Podcast Device.

Test it runs:

```bash
set -a; source .env; set +a
node server.js   # should log "listening on 127.0.0.1:8080"
```

Ctrl-C out, then move to systemd.

---

## 5. Run the relay under systemd

Copy the unit from `deploy/podcast-relay.service` (provided) into place:

```bash
sudo cp /opt/podcast-relay/deploy/podcast-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now podcast-relay
sudo systemctl status podcast-relay
journalctl -u podcast-relay -f     # live log tail
```

The unit (a) runs as the `deploy` user, (b) reads `/opt/podcast-relay/.env`,
(c) restarts on crash with a short backoff, and (d) applies several systemd
hardening directives (`NoNewPrivileges`, `PrivateTmp`, read-only root,
etc.) so a compromised process can do as little as possible.

---

## 6. TLS and the reverse proxy (Caddy)

Caddy is simpler than nginx for this: one file, automatic Let's Encrypt.

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

sudo cp /opt/podcast-relay/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

(Edit `/etc/caddy/Caddyfile` to replace `podcast.example.com` with your
real domain before reloading.)

Verify:

```bash
curl -I https://podcast.example.com/         # should return 200, podcast relay: ok
```

Caddy will now serve `wss://podcast.example.com/` with a valid TLS cert
and proxy WebSocket traffic to `127.0.0.1:8080`.

---

## 7. Point the clients at the relay

**Mike's Podcast Device** — in the top bar, set:

- Relay server: `wss://podcast.example.com`
- Room code: a shared value, e.g. `mike-cretched-1`
- Token: the value of `TOKEN` from `.env`

**Cretched's browser extension** — same three values in the popup.

Click Connect on both. Drag a GIF. It should appear on Mike's screen.

---

## 8. Ongoing operations

**Updating the code**:

```bash
cd /opt/podcast-relay
git pull                         # or scp the files over
npm install --omit=dev
sudo systemctl restart podcast-relay
```

**Rotating the token** (do this if you suspect leakage, or on a schedule):

1. Edit `/opt/podcast-relay/.env`, change `TOKEN`.
2. `sudo systemctl restart podcast-relay`.
3. Update the token in both clients.

Old sockets are dropped on restart; clients will need to Reconnect.

**Log review**: `journalctl -u podcast-relay --since "1 hour ago"`. The
server prints connect/disconnect events with the room name and client IP.
Unexpected IPs or failed-token messages are your signal to rotate.

**Backups**: nothing to back up on the relay — it's stateless. The only
persistent bits are `.env` (keep a copy in your password manager) and the
systemd unit / Caddyfile (source-controlled with the rest of the project).

---

## Security considerations

### Transport

- **Always use `wss://`**, never `ws://`, in production. The Caddy config
  forces HTTPS. Plain `ws://` leaks the shared token, the room name, and
  every byte of every GIF, in cleartext, to anyone on the wire.
- **Bind Node to `127.0.0.1`, not `0.0.0.0`**. The systemd unit sets
  `HOST=127.0.0.1` so the only way in is through Caddy. This prevents
  accidental bypass of the TLS layer.

### Authentication and authorization

- **Shared token** (`?token=...`) is the minimum bar. Make it long and
  random (`openssl rand -hex 32`). Treat leakage as a real incident and
  rotate immediately.
- **Room code** isolates podcasts but is not a secret by itself. Knowing
  the room lets you join if you also have the token; pick non-obvious
  room codes anyway (not `mike-cretched-1` in production).
- **Origin allowlist**: the hardened server rejects WebSocket upgrades
  whose `Origin` header isn't in `ALLOWED_ORIGINS`. For the Podcast
  Device (Electron) you set this via `webPreferences.additionalArguments`
  or let Electron's default (`file://`) through by adding `null` to the
  allowlist. For Cretched's extension, include `chrome-extension://<id>`.
- **Consider per-room tokens** if you ever host more than one podcast on
  the same box: a short `rooms.json` map of `{ roomId: token }` is ~10
  lines more code and prevents one leaked token from unlocking all rooms.

### Abuse prevention

- **Max payload size** (`MAX_PAYLOAD_BYTES`) caps a single message.
  Default 8 MB. `ws` enforces this at the protocol level, so oversize
  frames are dropped before they reach application code.
- **Rate limiting** (`MAX_MSGS_PER_MIN`) caps how many messages a single
  sender socket can broadcast per minute. Prevents a compromised or
  malicious sender from flooding the receiver.
- **Connection count per IP**: the hardened server caps simultaneous
  connections per remote IP. Adjust `MAX_CONNS_PER_IP` if you have NAT'd
  users behind a shared address.
- **Ping/pong keepalive**: the server pings every 30 s and terminates
  sockets that fail to pong. Stops zombie connections from accumulating
  and consuming file descriptors.

### System hardening

- **Non-root user**: relay runs as `deploy`, not root.
- **systemd sandboxing**: `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome=true`, `PrivateTmp=true`, `RestrictAddressFamilies=
  AF_INET AF_INET6`, `MemoryDenyWriteExecute`, `LockPersonality` —
  all applied in the unit file.
- **Automatic security patches**: `unattended-upgrades` keeps the OS
  current.
- **SSH key only**: password auth disabled, root login disabled.
- **Firewall**: UFW plus (optionally) a Digital Ocean Cloud Firewall.
- **Fail2ban**: rate-limits SSH brute force.

### Privacy considerations

- GIFs transit the relay's memory but are **not persisted**. If your
  threat model requires "server never sees the content," switch to a
  WebRTC data channel between Cretched and Mike with the relay only serving
  as a signaling channel. That's a bigger refactor — most podcast setups
  don't need it.
- The relay logs IPs on connect/disconnect. If that's sensitive, adjust
  the log lines in `server.js` to omit them or replace with a hash.

### Things this guide explicitly does NOT give you

- DDoS protection at the network layer. If someone points real traffic at
  your droplet, put Cloudflare in front (Cloudflare does terminate
  WebSockets on paid plans; the free plan has time limits).
- Secrets management. `.env` on disk is adequate for a hobby setup; for
  anything beyond, use DO's App Platform secrets, HashiCorp Vault, or
  `systemd-creds`.
- Monitoring / alerting. Add something like UptimeRobot pinging `/` if
  you want to be woken up when the relay dies.

---

## Example: rotating keys, end to end

Say Cretched accidentally committed the token to GitHub. Recovery:

```bash
# On the droplet:
NEW=$(openssl rand -hex 32)
sudo sed -i "s/^TOKEN=.*/TOKEN=$NEW/" /opt/podcast-relay/.env
sudo systemctl restart podcast-relay
echo "new token: $NEW"
```

Send the new token to Mike and Cretched out-of-band (Signal, 1Password share,
etc.). They paste it into their clients and click Connect. Done — the old
token is dead, and no bytes can flow through the relay without the new one.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Client shows `connection error` immediately | DNS not pointing at droplet, or Caddy not running | `dig podcast.example.com`, `systemctl status caddy` |
| Client connects then closes with code 4001 | Wrong token | Verify `.env` value matches clients |
| Client connects then closes with code 4003 | Origin not allowlisted | Add the client's origin to `ALLOWED_ORIGINS` |
| GIF never arrives on Mike's side | Mike connected as sender, not receiver | Check role in both clients; relay only forwards sender → receiver |
| `journalctl` shows repeated restarts | Port already in use, or bad `.env` | `ss -tlnp | grep 8080`, verify env values |
| TLS cert failed to issue | Port 80 blocked, or DNS not propagated | Make sure UFW allows 80, retry `systemctl reload caddy` |

See also: `deploy/Caddyfile`, `deploy/podcast-relay.service`,
`deploy/.env.example`, `deploy/ufw-setup.sh`.

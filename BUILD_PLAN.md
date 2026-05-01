# Podcast Device — Build Plan

This document is the authoritative handoff for implementing the **Podcast
Device** project. It is written for an engineering agent (Claude Code) that
has not seen the prior design conversation. Read it top to bottom before
touching code.

Everything described here is already scaffolded in this repo as a rough
sketch. The goal of the build is to turn those sketches into a polished,
production-ready application, a hardened relay service, and a published
browser extension — delivered in small, independently verifiable
milestones.

---

## 1. What we are building and why

### What
A three-pane desktop application called the **Podcast Device**, designed
for a solo host ("Mike") who wants a single, dedicated window on-screen
during a podcast. The window contains:

- **Column A (left, large):** a full Chromium browser surface with
  multi-tab support. Mike drives it like a normal browser, navigating
  between show notes, streaming services, chat, reference pages, etc.
- **Column B (upper right):** a free-form panel he controls. It renders
  whatever HTML / widgets we put there (stats, notes, overlay controls).
- **GIF Area (lower right):** an image panel that can be updated
  remotely, in real time, by a trusted collaborator ("Cretched") who is on a
  different network.

Cretched runs a small companion app — shipped as a browser extension — where
he drags a GIF or still image onto a drop zone. That image appears
near-instantly on Mike's screen.

All three regions are resizable. Column B's background color, the GIF
area's background color, and the GIF area's border thickness are
adjustable at runtime.

### Why this shape
- **Why Electron, not a browser extension, for the Podcast Device.** The
  main reason is `WebContentsView`: Electron's embedded-browser surface
  that behaves like a real Chromium tab, with none of the `X-Frame-Options`
  / `frame-ancestors` restrictions that stop most sites (YouTube, Google,
  banks, most streaming sites) from loading inside an `<iframe>`. A pure
  Chrome extension cannot reliably embed arbitrary third-party sites.
- **Why a WebSocket relay, not WebRTC, for Cretched → Mike.** WebRTC is the
  "right" zero-server option but adds a signaling-server requirement
  anyway, plus NAT traversal complexity (STUN/TURN). For a two-person
  podcast where a few-hundred-millisecond latency is fine, a single
  relay box is simpler, more debuggable, and good enough.
- **Why a browser extension for Cretched, not a second Electron app.** Lower
  friction for Cretched: no install, no updates, native drag-and-drop, and
  the extension can be revoked instantly. If Cretched's needs grow (preview
  queue, scheduled drops, tighter integration) we can add a second
  Electron app later without changing the protocol.

---

## 2. Architecture

```
                                 Cretched's browser
                                 ┌──────────────────────────┐
                                 │  Extension popup         │
                                 │  - drag-and-drop zone    │
                                 │  - WebSocket (sender)    │
                                 └──────────┬───────────────┘
                                            │  wss://
                                            ▼
                                 ┌──────────────────────────┐
Internet / DO droplet            │  Caddy (TLS terminate)   │
                                 │       │                  │
                                 │       ▼                  │
                                 │  Node relay (ws)         │
                                 │  room[X].senders → rx    │
                                 └──────────┬───────────────┘
                                            │  wss://
                                            ▼
Mike's PC (Electron)             ┌──────────────────────────┐
                                 │  Renderer process        │
                                 │  ┌────────┬───────────┐  │
                                 │  │ Col A  │ Col B     │  │
                                 │  │ (WCV)  │───────────│  │
                                 │  │        │ GIF area  │  │
                                 │  └────────┴───────────┘  │
                                 │       ▲                  │
                                 │       │ IPC              │
                                 │  Main process            │
                                 │  - Map<tabId, WCV>       │
                                 │  - WebSocket (receiver)  │
                                 └──────────────────────────┘
```

Three independent deliverables, each in its own top-level folder:

- `podcast-device-app/` — Electron desktop app (runs on Mike's PC).
- `relay-server/` — Node WebSocket relay (runs on the Digital Ocean droplet).
- `cretched-extension/` — Manifest V3 browser extension (distributed to Cretched).

Plus shared deployment artifacts in `deploy/` and documentation at the
root.

---

## 3. Tech stack and versions

| Component | Choice | Version | Rationale |
|---|---|---|---|
| Desktop runtime | Electron | ^30.0.0 | `WebContentsView` API is stable; ships modern Chromium. |
| Language (everywhere) | JavaScript (ES2022) | — | Minimize cross-process friction. TypeScript is optional stretch. |
| Packaging | electron-builder | latest | Standard choice; produces .exe/.dmg/.AppImage. |
| Relay transport | `ws` npm package | ^8.17.0 | De facto Node WebSocket library; proven. |
| Relay process mgmt | systemd | OS | Simpler than PM2 for a single-service box. |
| TLS / reverse proxy | Caddy | ^2.8 | Auto-Let's Encrypt; one-line WebSocket proxy. |
| OS | Ubuntu 24.04 LTS | — | Long support window; matches DO default image. |
| Extension manifest | MV3 | — | Required for new Chrome extensions. |
| Testing | `node:test` + Playwright | — | Zero-dep unit tests; Playwright for Electron E2E. |

No TypeScript yet. No build step on the renderer (vanilla HTML/CSS/JS).
These constraints are deliberate to keep the sketch readable; a future
milestone can migrate.

---

## 4. Directory layout (target, end-of-build)

```
podcast-device/
├── BUILD_PLAN.md                 ← this file
├── README.md                     ← overview + quickstart
├── DEPLOYMENT.md                 ← Digital Ocean setup guide
├── LICENSE
├── .gitignore
│
├── podcast-device-app/
│   ├── package.json
│   ├── main.js                   ← Electron main process
│   ├── preload.js                ← context-bridge IPC surface
│   ├── renderer/
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── app.js
│   ├── test/
│   │   └── app.e2e.js            ← Playwright-for-Electron tests
│   └── build/
│       └── icons/
│
├── relay-server/
│   ├── package.json
│   ├── server.js                 ← hardened WebSocket relay
│   ├── test/
│   │   └── server.test.js        ← unit + integration tests
│   └── .nvmrc
│
├── cretched-extension/
│   ├── manifest.json             ← MV3
│   ├── popup.html
│   ├── popup.js
│   ├── icons/                    ← 16/32/48/128 px
│   └── README.md
│
└── deploy/
    ├── Caddyfile
    ├── podcast-relay.service     ← systemd unit with sandboxing
    ├── .env.example
    └── ufw-setup.sh
```

---

## 5. Milestones

Each milestone has: **goal**, **why it comes at this point**, **work
items**, and **acceptance criteria**. Ship each milestone as one pull
request. Do not combine milestones.

### Milestone 0 — Repo scaffold

**Goal.** Establish the three sub-projects with working `npm install`
and `npm run <start|test>` scripts that do nothing yet.

**Why first.** Everything below assumes this exists. We want green CI
before we start shipping behavior.

**Work items.**
1. Initialize `podcast-device-app/package.json`, install Electron 30,
   add a `start` script that opens a blank window.
2. Initialize `relay-server/package.json`, install `ws`, add a `start`
   script that logs "hello".
3. Initialize `cretched-extension/manifest.json` (MV3) with a stub popup.
4. Add a root `.gitignore` (node_modules, dist, .env, *.log).
5. Add a GitHub Actions workflow that runs `npm test` in each project.

**Acceptance criteria.**
- `cd podcast-device-app && npm install && npm start` opens a blank
  Electron window.
- `cd relay-server && npm install && npm start` logs "hello" and exits.
- Loading `cretched-extension/` as an unpacked extension in Chrome shows a
  stub popup.
- CI is green.

---

### Milestone 1 — Static three-pane layout (no browser, no network)

**Goal.** The Electron window renders the Podcast Device's layout with
resizable splitters and color controls. Column A is an empty yellow box.

**Why next.** Prove the renderer layout works before we complicate it
with an embedded browser. Much easier to debug CSS without a full
Chromium view on top.

**Work items.**
1. Implement `renderer/index.html`, `styles.css` matching the layout in
   the existing sketch: top bar, main row with Column A / splitter /
   Column B (which contains Column B content, a horizontal splitter,
   and the GIF area).
2. Implement drag-to-resize for both splitters in `app.js`.
3. Wire color pickers and border-width input to their targets.
4. Ensure `min-width`/`min-height` constraints prevent collapsing.

**Acceptance criteria.**
- The app opens at 1600x900 with the layout from the sketch.
- Dragging the vertical splitter resizes Column B's width.
- Dragging the horizontal splitter resizes the GIF area's height.
- Color pickers change the targeted region's background.
- The border-width input updates the GIF area's border.
- Window resize keeps everything proportional and clipped correctly.

---

### Milestone 2 — Embedded browser (single tab)

**Goal.** Column A renders an actual website. A URL bar lets Mike
navigate to arbitrary URLs.

**Why next.** This is the single hardest piece to get right and
everything else depends on it. Getting one tab working cleanly de-risks
the multi-tab refactor in M3.

**Work items.**
1. In `main.js`, create a `WebContentsView` and attach it with
   `mainWindow.contentView.addChildView(view)`.
2. Add a `set-bounds` IPC handler that receives `{x,y,w,h}` from the
   renderer and repositions the view.
3. In the renderer, push bounds whenever the window resizes or Column A
   changes size (on splitter drag).
4. Add a URL bar with a Go button; wire it to a `navigate` IPC handler
   that calls `webContents.loadURL(...)`.
5. Implement `coerceUrl(s)`: if it looks like a URL, prepend `https://`;
   if it looks like a search term, use `https://www.google.com/search?q=`.
6. Add Back / Forward / Reload buttons.

**Acceptance criteria.**
- Navigating to `youtube.com` plays a video in Column A.
- Navigating to `example.com` then back works via Back button.
- Resizing the window and dragging splitters keeps the embedded page
  sized correctly without flicker or overflow.
- A site that normally refuses to be iframed (e.g. `github.com`) loads
  successfully — proving we are NOT using an iframe.

---

### Milestone 3 — Multi-tab Column A

**Goal.** Column A supports multiple tabs with a Chrome-like tab strip.

**Why next.** Podcasters typically need three or four pages open
simultaneously; switching via Back/Forward is too slow.

**Work items.**
1. Refactor `main.js` from a single `webView` to a `Map<tabId,
   {view, title, url}>` plus an `activeTabId`.
2. Implement `createTab(url)`, `activateTab(id)`, `closeTab(id)`. Only
   the active tab's view is attached to the window.
3. Wire navigation events (`page-title-updated`, `did-navigate`,
   `did-start-loading`, `did-stop-loading`) to send `tab-updated` to
   the renderer so the strip stays in sync.
4. Handle `setWindowOpenHandler`: open `target="_blank"` links as new
   tabs, not OS windows.
5. Render a horizontal tab strip in the renderer. Clicking activates;
   clicking × closes; `+` opens a new tab.
6. URL bar always reflects the active tab's URL (but don't stomp the
   user's input while they're typing).
7. Back/Forward reflect active tab's history via
   `wc.navigationHistory.canGoBack()` / `canGoForward()`.

**Acceptance criteria.**
- You can open 5 tabs, switch between them, and each remembers its
  state (scroll, video, login).
- Closing the active tab focuses the previous tab.
- Closing the last tab leaves the app in a sensible state (Column A
  yellow, URL bar empty, Back/Forward disabled).
- Middle-click or Ctrl-click on a link opens a new tab rather than
  replacing the current one.

---

### Milestone 4 — Dev relay server

**Goal.** A local relay server that Cretched and Mike can connect to for
end-to-end testing.

**Why next.** We need something to integrate against for M5 and M6. This
is the unhardened development version; M8 hardens it for production.

**Work items.**
1. Implement `server.js`: HTTP server (returns `"podcast relay: ok"` on
   GET `/`), upgraded to WebSocket via `ws`.
2. Parse `?room=`, `?role=sender|receiver`, `?token=` query params.
3. Maintain `rooms: Map<string, {senders: Set, receivers: Set}>`.
4. Forward messages from senders to all receivers in the same room.
5. Basic token check (plain string equality is fine for now).
6. Log connect/disconnect with room and role.

**Acceptance criteria.**
- `npm start` launches the server on `127.0.0.1:8080`.
- Two `wscat` sessions with matching `room` and opposite `role` can pass
  binary messages sender → receiver.
- Messages from receivers are silently dropped.
- Wrong token closes the socket with code 4001.

---

### Milestone 5 — Cretched's extension (sender)

**Goal.** Cretched installs the extension, enters relay URL + room + token,
drags a GIF, and it goes over the wire.

**Why next.** The extension is the simplest of the three clients;
finishing it unblocks M6 integration testing.

**Work items.**
1. MV3 `manifest.json` with `action.default_popup`.
2. `popup.html`: server URL input, room input, token input, Connect
   button, drop zone, status line, preview `<img>`.
3. `popup.js`: connect as `role=sender`; on drop, `file.arrayBuffer()`
   then `ws.send(buf)`; show a preview; log status.
4. Persist the three inputs in `chrome.storage.local` so Cretched doesn't
   retype them.
5. Icon assets at 16/32/48/128 px.

**Acceptance criteria.**
- Loading unpacked in Chrome shows the toolbar icon and opens the popup.
- Clicking Connect against the dev relay turns the status line green.
- Dragging a GIF onto the drop zone shows a preview AND sends bytes to
  the relay (verify via server logs).
- Closing and reopening the popup restores the previous values.

---

### Milestone 6 — End-to-end integration

**Goal.** Cretched's drop reaches Mike's GIF area with acceptable latency.

**Why next.** This is the primary feature. Until it works, nothing else
matters.

**Work items.**
1. In the Podcast Device renderer, add relay URL / room / token inputs
   and a Connect button.
2. Connect as `role=receiver` with `binaryType = 'arraybuffer'`.
3. On `message`: if binary, create a `Blob` and `URL.createObjectURL`,
   set as `<img>` src. If text, parse JSON; support `{type:'gif-url',
   url: '...'}`.
4. Clean up previous blob URLs with `URL.revokeObjectURL` when a new
   image arrives, to avoid a memory leak over a long session.
5. Status indicator: disconnected / connecting / connected / error.
6. Reconnect-on-close with exponential backoff (1s, 2s, 4s, up to 30s).

**Acceptance criteria.**
- Mike and Cretched both connect to the local relay with matching room.
- Cretched drops a GIF; it appears in Mike's GIF area within 500ms on LAN.
- Cretched drops 10 GIFs in a row; Mike sees the latest one, no leaks (check
  with Chrome DevTools memory profiler — heap should not grow
  unbounded).
- Killing the relay shows a clean "disconnected" state on both clients
  and each reconnects when the relay returns.

---

### Milestone 7 — Customization + persistence

**Goal.** Runtime-adjustable visuals that survive app restart.

**Work items.**
1. Persist via `electron-store` (or a small JSON file in `app.getPath('userData')`):
   - Column B width (splitter position).
   - GIF area height (splitter position).
   - Column B background color.
   - GIF area background color.
   - GIF area border width.
   - Relay URL, room, token (token stored via OS keychain — use
     `keytar` or Electron's `safeStorage`, **not** plaintext).
   - Tab list (URLs only) for session restore.
2. Reset-to-defaults menu item.

**Acceptance criteria.**
- Quit + relaunch restores all visuals and reopens the previous tabs.
- Token is not readable in plaintext on disk.
- A brand-new install opens with sensible defaults.

---

### Milestone 8 — Harden the relay

**Goal.** The relay is safe to expose to the public internet.

**Why this late.** Premature hardening makes development painful. By
M8 the contract is stable and we know exactly what to protect.

**Work items.**
1. Read all config from env (`HOST`, `PORT`, `TOKEN`, `ALLOWED_ORIGINS`,
   `MAX_PAYLOAD_BYTES`, `MAX_MSGS_PER_MIN`, `MAX_CONNS_PER_IP`,
   `PING_INTERVAL_MS`).
2. Bind to `127.0.0.1` by default; never `0.0.0.0`.
3. `verifyClient` handler: reject upgrade if origin not in
   `ALLOWED_ORIGINS` (when set) or IP over cap.
4. Constant-time token comparison (`crypto.timingSafeEqual`).
5. Per-IP connection counter; decrement on close.
6. Per-sender sliding-window rate limiter (messages / min).
7. 30-second ping; terminate sockets that miss a pong.
8. Graceful shutdown on SIGTERM / SIGINT.
9. Structured log lines: timestamp, event, role, room, IP, counters.
10. Unit tests for each gate (bad origin rejected, bad token rejected,
    rate limit trips, ping terminates zombies).

**Acceptance criteria.**
- Running against a `verifyClient` fuzzer does not crash or leak memory.
- A sender that sends 31 messages in 60 seconds is dropped with code
  1008.
- A client that connects then disappears without closing is cleaned up
  within 2×`PING_INTERVAL_MS`.
- `curl -i -H 'Origin: https://evil.com' --http1.1 --upgrade` returns
  403.

---

### Milestone 9 — Digital Ocean deployment

**Goal.** The relay runs on a $6 droplet at `wss://podcast.<domain>/`
with valid TLS, systemd management, and defense-in-depth.

**Work items.** Follow `DEPLOYMENT.md` end to end:
1. Create Ubuntu 24.04 droplet, hardened SSH, non-root `deploy` user.
2. UFW open for 22/80/443 only.
3. Install Node 20 via NodeSource.
4. Copy relay into `/opt/podcast-relay`, install prod deps.
5. Populate `.env` with generated token, allowlisted origins.
6. Install systemd unit (`deploy/podcast-relay.service`) with
   sandboxing directives.
7. Install Caddy, use `deploy/Caddyfile` with your domain.
8. Verify `curl -I https://podcast.<domain>/` returns 200.
9. Enable `unattended-upgrades` and `fail2ban`.

**Acceptance criteria.**
- Both clients connect via `wss://` with valid TLS.
- `systemctl restart podcast-relay` recovers in < 3s.
- `ss -tlnp` shows node bound to 127.0.0.1 only.
- `journalctl -u podcast-relay` shows structured connect/disconnect
  lines; nothing sensitive is logged.

---

### Milestone 10 — Polish + packaging

**Goal.** Ship installable builds to Mike and a publishable extension to
Cretched.

**Work items.**
1. Add `electron-builder` config; produce signed .exe (Windows) /
   notarized .dmg (macOS) / AppImage (Linux).
2. Auto-update via `electron-updater` pointing at a GitHub release
   channel. Optional.
3. Extension icons, store screenshots, store listing text.
4. Publish extension to the Chrome Web Store as unlisted; share link
   with Cretched.
5. Crash reporting via Sentry (Electron SDK) — opt-in.
6. Basic analytics opt-in (count of GIFs received per session). Never
   upload GIF contents.

**Acceptance criteria.**
- A fresh Windows VM can install the .exe, connect, and receive a GIF
  with no developer tools.
- The extension store listing passes Google review.
- Uninstall removes all traces.

---

## 6. Testing strategy

### Unit
- `relay-server/test/server.test.js`: spin up the server on a random
  port, drive it with `ws` clients, assert auth, origin, rate, ping.
- `podcast-device-app/test/coerceUrl.test.js`: pure-function URL
  coercion. No Electron required.

### Integration
- `podcast-device-app/test/app.e2e.js`: Playwright-for-Electron. Opens
  the app, opens a tab, drags a synthetic file into a mock drop zone
  (extension side-channel), asserts the `<img>` src updates.

### Manual smoke test (pre-release)
Run the script at `scripts/smoke.md`:
1. Start relay locally with `TOKEN= npm start` (no token, dev only).
2. Open Podcast Device, connect.
3. Load extension, connect.
4. Drag three different GIFs. Verify they appear in order.
5. Kill relay; verify both clients show "disconnected"; restart relay;
   verify both reconnect.
6. Navigate Column A through 5 tabs; resize splitters; check no layout
   glitches.

### Load
Not required for v1. Two clients per room is the expected load.

---

## 7. Out of scope for v1

Do not build these unless explicitly asked. Document them as "future":

- Audio routing through Web Audio / VST hosting (we discussed this as a
  future feature — separate spec).
- Multiple simultaneous senders or moderator roles.
- Server-side persistence of sent media.
- End-to-end encryption (bytes transit the relay's memory in cleartext
  relative to the server operator; acceptable for v1).
- Mobile sender app.
- Per-room tokens (a shared token is sufficient for one podcast).
- Cloud signaling for WebRTC (we chose relay over WebRTC deliberately).

---

## 8. Key design decisions (for future-you)

| Decision | Alternative considered | Why we chose this |
|---|---|---|
| Electron with `WebContentsView` | Chrome extension with iframes | Iframes can't embed most modern sites due to `frame-ancestors` / `X-Frame-Options`. |
| WebSocket relay | WebRTC data channel | Relay is simpler to debug, works across all NATs, still only needs one tiny server. |
| MV3 extension for Cretched | Second Electron app | Lower install friction for Cretched; we can always add an Electron sender later. |
| Caddy in front of Node | nginx + certbot | Caddy's Caddyfile is ~10 lines and auto-renews Let's Encrypt. |
| Binary frames, no upload | HTTP POST + URL forwarding | Fewer moving parts, no storage to manage, no URL lifecycle to clean up. |
| Token in query string | Token in subprotocol header | Query string is visible in Node req.url at `verifyClient` time — simplest. TLS encrypts it either way. |
| `127.0.0.1` + Caddy | Node listens on `0.0.0.0` directly | Forces all traffic through the hardened reverse proxy; eliminates accidental plaintext path. |
| `electron-store` + `safeStorage` | Plain JSON + OS keychain | `safeStorage` uses OS-level encryption on all three OSes; no native deps. |

---

## 9. Handoff checklist for Claude Code

Before writing code, verify:

- [ ] You have read this document end to end.
- [ ] You have opened each existing sketch file (in `podcast-device-app/`,
      `relay-server/`, `cretched-extension/`, `deploy/`) and understand it.
- [ ] You have read `DEPLOYMENT.md` in full.
- [ ] You understand that milestones ship as independent PRs.

For each milestone:

- [ ] Implement only the work items for that milestone.
- [ ] Write the tests described in the acceptance criteria.
- [ ] Run the tests and the manual smoke test.
- [ ] Commit with a message of the form `M{n}: <summary>`.
- [ ] Update the root `README.md` if user-facing behavior changed.
- [ ] Do not advance to the next milestone until the current one is
      fully green.

If a milestone's acceptance criteria cannot be met, STOP and write a
short report explaining what blocked you. Do not paper over failures.

Good luck.

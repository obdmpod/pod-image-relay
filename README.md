# Podcast Device — starter sketch

> **Implementing this?** Read **[BUILD_PLAN.md](./BUILD_PLAN.md)** first.
> It is the authoritative handoff document: architecture, tech stack,
> milestone sequencing, acceptance criteria, and design rationale.
> For production relay deployment on Digital Ocean, see **[DEPLOYMENT.md](./DEPLOYMENT.md)**.


A three-pane "Podcast Device": on the left a real embedded web browser
(Column A), on the upper right a panel you control (Column B), and on the
lower right a GIF/image area that a remote collaborator can update over the
internet.

```
+-----------------------------------+---------------------+
|                                   |                     |
|                                   |     Column B        |
|        Column A                   |     (width +        |
|   (Main Window for Website —      |      bg adjustable) |
|    WebContentsView overlay)       |                     |
|                                   +---------------------+
|                                   |                     |
|                                   |   Animated GIF /    |
|                                   |   Image Area        |
|                                   |  (height, border,   |
|                                   |   bg adjustable)    |
+-----------------------------------+---------------------+
```

## Three pieces

```
podcast-device/
├── podcast-device-app/   ← Mike's Electron app (what you run on your PC)
├── relay-server/         ← tiny WebSocket server in the middle
└── cretched-extension/       ← Cretched's Chrome / Edge extension
```

### 1. `podcast-device-app/` — Mike's Electron app

Why Electron instead of a browser extension: a `WebContentsView` is a full
Chromium browsing surface embedded into any rectangle of the window. This
bypasses the `X-Frame-Options` / `frame-ancestors` problem that prevents
most sites (YouTube sign-in, Google, etc.) from being displayed inside a
normal `<iframe>`. Column A is a real browser; the rest is ordinary HTML.

**Tabs.** Column A supports multiple tabs. The main process keeps a map of
`tabId -> WebContentsView`, and only the active tab's view is attached to
the window; switching tabs is a `removeChildView` + `addChildView`. Each
view emits navigation events (title, URL, back/forward availability,
loading state) which the renderer listens for to keep the tab strip and
URL bar in sync. `target="_blank"` / `window.open` links spawn a new tab
via `setWindowOpenHandler` instead of popping out an OS window.

Files:

- `main.js` — creates the window, overlays the `WebContentsView` on Column A,
  listens for `navigate` and `set-bounds` IPC calls from the renderer.
- `preload.js` — safe bridge that exposes `window.podcast.navigate(url)`
  and `window.podcast.setMainBounds({x,y,w,h})` to the renderer.
- `renderer/index.html` — the chrome: URL bar, relay connection controls,
  color pickers, Column A placeholder, Column B, GIF area.
- `renderer/styles.css` — layout, splitters, default colors.
- `renderer/app.js` — splitter drag logic, tells main process where
  Column A is whenever it resizes, opens a WebSocket to the relay as a
  `receiver`, swaps the `<img>` when bytes arrive.

Run:

```
cd podcast-device-app
npm install
npm start
```

### 2. `relay-server/` — the hop between the two networks

Because Cretched and Mike are on different networks, something in the middle
has to introduce them. Simpler than WebRTC for this use case: a ~60-line
WebSocket relay on a small VPS.

- Clients connect as `role=sender` (Cretched) or `role=receiver` (Mike).
- Clients specify a `room` so multiple podcasts don't cross.
- Any binary/text message from a sender is forwarded to every receiver in
  the same room. Receivers can't broadcast.
- A `token` query param gates access (swap for real auth in production).

Run (local testing):

```
cd relay-server
npm install
TOKEN=dev-token node server.js
# listens on 127.0.0.1:8080, TLS termination (wss://) via your reverse proxy
```

For a production install on Digital Ocean — droplet sizing, SSH hardening,
UFW, Caddy + Let's Encrypt, systemd unit with sandboxing, and the full
security checklist — see **[DEPLOYMENT.md](./DEPLOYMENT.md)** and the
example configs in `deploy/` (`Caddyfile`, `podcast-relay.service`,
`.env.example`, `ufw-setup.sh`).

### 3. `cretched-extension/` — Cretched's drag-and-drop controller

An MV3 browser extension. Cretched clicks the toolbar icon, enters the relay
URL + room + token once (persisted via `chrome.storage`), clicks Connect,
and then drags any GIF from his desktop or a webpage into the popup.

Load unpacked: go to `chrome://extensions`, enable Developer mode, click
"Load unpacked", and select the `cretched-extension/` folder.

## End-to-end flow

1. You start `relay-server` on a public host (or `localhost` for testing).
2. You launch `podcast-device-app` on your PC. Enter the relay URL and a
   room code, click Connect. Status flips to `connected`.
3. Cretched installs `cretched-extension`, enters the same relay URL, room, and
   token, clicks Connect.
4. Cretched drags a GIF into the popup. Bytes travel:
   `Cretched's browser → WebSocket → relay → WebSocket → Mike's Electron app`.
5. Mike's app creates a blob URL and swaps the `<img>` in the GIF area.

Latency on a near-region VPS: typically <300 ms for a few-MB GIF.

## What this sketch does not cover yet

- TLS. Put the relay behind `nginx` / Caddy and use `wss://`.
- Authentication beyond a shared token (per-user tokens, expiring links).
- File size guardrails in the UI (server already caps at 8 MB).
- Multiple senders / moderator controls.
- Persisting the last GIF so reconnects restore it.
- Packaging the Electron app (electron-builder) for distribution.
- A "Cretched Electron" mode if you don't want to ship a browser extension.

## Adjusting the design

- Column B background: the color picker in the top bar; wire it to
  persistent storage if you want it to survive relaunches.
- GIF area background / border thickness: the two controls beside it.
- Column A vs Column B width: drag the vertical black splitter.
- GIF area height: drag the horizontal black splitter inside Column B.

## Relay settings persistence

Mike's app saves the relay server and room in Electron's user-data
directory. The shared token is stored encrypted with Electron
`safeStorage` when the operating system supports it. After you click
Connect once, the app restores those values on restart and collapses the
relay controls so the server, room, and token do not need to stay visible
on stream.

## Why not a pure Chrome extension for Mike's side

Extensions can't reliably embed arbitrary third-party sites — most big
sites send frame-blocking headers, and Chrome has been tightening the
APIs that could strip them. An Electron `WebContentsView` has no such
limit because it's a real browser, not an iframe.

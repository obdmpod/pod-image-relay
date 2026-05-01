# pod-image-relay

A way to display images and GIFs on stream from a trusted remote sender.

> Read [BUILD_PLAN.md](./BUILD_PLAN.md) for the implementation plan and
> architecture notes. Read [DEPLOYMENT.md](./DEPLOYMENT.md) for Railway,
> Digital Ocean, and relay security guidance.

## What It Is

This project has three pieces:

- `podcast-device-app/` - Mike's Windows Electron app with a real embedded browser in Column A, stream controls in Column B, and a GIF/image area in Section C.
- `relay-server/` - a small WebSocket relay that forwards images from the sender to the receiver in a shared room.
- `cretched-extension/` - Cretched's Chrome/Edge extension for dragging images or GIFs into the relay.

The flow is:

```text
Cretched's browser extension
        |
        v
WebSocket relay
        |
        v
Mike's Podcast Device app
```

## Local Setup

Install dependencies for each component:

```powershell
cd relay-server
npm install

cd ..\podcast-device-app
npm install

cd ..\cretched-extension
npm install
```

Run the relay locally:

```powershell
cd relay-server
$env:TOKEN="dev-token"
npm start
```

Run Mike's app:

```powershell
cd podcast-device-app
npm start
```

Load Cretched's extension:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select the `cretched-extension/` folder.

Use matching relay settings in both clients:

- Server: `ws://localhost:8080`
- Room: any shared room value, for example `mike-cretched-1`
- Token: the same value used by the relay

## Production Notes

For hosted use, deploy only `relay-server/` first. Railway is the simplest path:

- Use `wss://` for the hosted relay URL.
- Set a long random `TOKEN`.
- Set `HOST=0.0.0.0` on Railway.
- Let Railway provide `PORT`.
- Restrict `ALLOWED_ORIGINS` after the Electron app and extension origins are known.

Mike's Electron app stores relay settings locally. The shared token is encrypted with Electron `safeStorage` when the operating system supports it, and the relay controls can be hidden so server/room/token values are not visible on stream.

## Tests

Run all tests manually:

```powershell
cd relay-server
npm test

cd ..\podcast-device-app
npm test

cd ..\cretched-extension
npm test
```

GitHub Actions also runs the same test suites on push and pull request.

## Current Limitations

- The Electron app is not packaged into an installer yet.
- The browser ad blocker is lightweight and is not a full Brave Shields replacement.
- The extension is currently loaded unpacked for local testing.
- The relay uses a shared token; per-room or per-user tokens can be added later.

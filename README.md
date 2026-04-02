# VibraLink

VibraLink is a Windows Electron desktop app that captures system audio and streams it to a phone browser over the local network using WebRTC.

## Architecture

- `source/main/main.js`: Electron bootstrap, app icon wiring, and Windows desktop-audio loopback capture setup
- `source/main/server/appServer.js`: Express + Socket.IO server for the phone UI, signaling, and QR generation
- `source/main/network/localNetwork.js`: local IP detection
- `source/renderer/desktop/*`: desktop control window
- `source/renderer/phone/*`: phone browser UI
- `build-resources/*`: packaged branding assets for Electron and NSIS

## How it captures audio

The desktop app requests desktop media with `audio: "loopback"` through Electron's display media handler. On Windows, that uses Chromium's system-audio loopback capture path rather than microphone input.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the desktop app:

   ```bash
   npm start
   ```

3. In the Electron window:
   - Click `Start Streaming`
   - Open the displayed `Phone URL` on your phone
   - Tap `Connect` on the phone page

## Build the Windows .exe

```bash
npm run build:win
```

The generated installer will be written to `dist/`.

## Branding and Installer

- Author and Windows publisher metadata are set to `Framefield`
- The app and installer use the `build-resources/VibraLink.png` logo and generated `.ico`
- NSIS is configured for a branded install flow with directory selection, desktop shortcut creation, and launch-after-install

## Notes

- Phone and PC must be on the same WiFi or LAN.
- WebRTC audio is negotiated as Opus by preference in the sender.
- If the peer connection drops, both sides keep reconnect logic enabled and the desktop app will renegotiate when the phone comes back.

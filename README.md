# VibraLink

VibraLink is a Windows Electron desktop app that captures PC output audio and streams it to a phone browser over the local network using WebRTC and Opus.

## What changed in this version

- Added a capture settings panel in the desktop UI
- Added Windows output-device discovery and device selection
- Added quality presets for `Low latency`, `Balanced`, and `High quality`
- Upgraded the WebRTC audio path to explicitly prefer stereo Opus at 48 kHz
- Raised sender bitrate targets to 128 kbps, 160 kbps, and 256 kbps depending on mode
- Added sender telemetry for current bitrate, sample rate, capture path, and connected device
- Improved reconnect handling and server-side audio status reporting

## Architecture

- `source/main/main.js`: Electron bootstrap and loopback capture handler
- `source/main/server/appServer.js`: Express + Socket.IO runtime server, signaling, audio settings APIs, and status fanout
- `source/main/audio/qualityPresets.js`: central audio preset definitions
- `source/main/audio/windowsAudioDeviceService.js`: Node wrapper around Windows audio-device helper commands
- `source/main/audio/windowsAudioDeviceService.ps1`: Windows render-device enumeration and default-output switching helper
- `source/renderer/desktop/*`: desktop control UI, device selection, quality settings, and sender telemetry
- `source/renderer/phone/*`: phone receiver UI and WebRTC playback

## Capture model

VibraLink still uses Chromium / Electron system loopback capture for the actual media track, but it now wraps that path with Windows output-device control:

1. The desktop UI enumerates active Windows render devices.
2. When you choose a specific output device, VibraLink temporarily promotes that device to the Windows shared default output during capture.
3. Electron loopback capture then locks onto that shared output consistently.
4. When streaming stops, VibraLink restores the previous default output device.

This is the practical path that improves reliability for shared-mode DAW monitoring without downgrading audio quality.

## DAW support and limitations

### Supported well

- Standard Windows apps playing through the default output
- DAWs using `WASAPI (shared)`
- DAWs using `DirectSound`
- DAWs routed to a shared Windows device or virtual cable

### Important limitation: ASIO

ASIO streams are not exposed to Chromium system loopback capture directly. VibraLink cannot directly capture a DAW that is talking only to an ASIO device path.

### Recommended DAW workflows

1. Best shared-mode option:
   - Set the DAW output to `WASAPI (shared)` on the device you want to monitor.
   - In VibraLink, select that same Windows output device.

2. Best ASIO fallback:
   - Keep the DAW on ASIO if needed for production work.
   - Route a monitor bus or duplicate output to a virtual audio device such as `VB-CABLE`.
   - In VibraLink, select the virtual cable render device.

3. Hardware-interface workflow:
   - If your interface exposes a shared Windows render endpoint, route monitoring there.
   - Select that interface output in VibraLink before starting the stream.

## Audio quality defaults

- Codec: `Opus`
- Target sample rate: `48000 Hz`
- Channels: `Stereo`
- Quality presets:
  - `Low latency`: `128 kbps`
  - `Balanced`: `160 kbps`
  - `High quality`: `256 kbps`

The sender prefers stereo Opus and advertises bitrate / packetization hints through SDP and sender parameters. Echo cancellation, noise suppression, and automatic gain control are disabled to keep the signal path clean for music and DAW monitoring.

## Status model

The desktop UI now exposes:

- `Starting`
- `Streaming`
- `Connected device`
- Current bitrate
- Current sample rate
- Capture path

If the peer link drops, the desktop host automatically renegotiates when the phone reconnects.

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
   - Select the Windows output device you want to monitor
   - Choose a quality mode
   - Click `Start Streaming`
   - Open the displayed `Phone URL` on your phone
   - Tap `Connect` on the phone page

## Build the Windows .exe

```bash
npm run build:win
```

The generated installer will be written to `dist/`.

## Troubleshooting

### No audio on the phone

- Make sure the phone and PC are on the same WiFi or LAN.
- Make sure VibraLink is streaming and the phone page is connected.
- Confirm the selected Windows output device is the one actually carrying the audio.
- If the source is a DAW, verify it is using `WASAPI shared`, `DirectSound`, or a virtual cable path.

### Poor quality or artifacts

- Use `Balanced` or `High quality`.
- Avoid changing Windows sample-rate settings while streaming.
- Make sure the DAW or system output is not being routed through enhancement software.
- Restart the stream after changing audio devices.

### DAW is not detected

- If the DAW uses ASIO only, VibraLink will not see it directly.
- Route the DAW to a shared Windows device or to `VB-CABLE`.
- Re-select the intended capture device in VibraLink and start streaming again.

### Wrong output device is being captured

- Select the exact render device in the VibraLink settings panel before starting.
- VibraLink temporarily switches the Windows shared default output to that device while capture is active.
- Stop the stream to restore the previous default output.

## Verification completed during this refactor

- Verified Windows render-device enumeration through the new helper
- Verified default-output switching and restoration on start / stop
- Verified `/api/audio/settings`, `/api/audio/start`, and `/api/audio/stop` endpoint flows
- Verified JavaScript syntax for the updated desktop, phone, and server code

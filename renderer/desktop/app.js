const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const toggleButton = document.getElementById("toggleButton");
const phoneUrlEl = document.getElementById("phoneUrl");
const localIpEl = document.getElementById("localIp");
const portEl = document.getElementById("port");
const qrFrame = document.getElementById("qrFrame");
const qrImage = document.getElementById("qrImage");
const deviceSelect = document.getElementById("deviceSelect");
const qualitySelect = document.getElementById("qualitySelect");
const connectedDeviceEl = document.getElementById("connectedDevice");
const sampleRateEl = document.getElementById("sampleRate");
const bitrateEl = document.getElementById("bitrate");
const capturePathEl = document.getElementById("capturePath");
const dawHintEl = document.getElementById("dawHint");

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 4000,
});

const QUALITY_MODE_LABELS = {
  lowLatency: "Low latency",
  balanced: "Balanced",
  highQuality: "High quality",
};

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

let runtime = null;
let peerConnection = null;
let captureStream = null;
let captureSettings = null;
let isStreaming = false;
let receiverConnected = false;
let reconnectTimer = null;
let statsTimer = null;
let lastStatsSnapshot = null;
let selectedAudioDeviceId = "default";
let selectedQualityMode = "balanced";

function setStatus(text, isLive) {
  statusText.textContent = text;
  statusDot.classList.toggle("live", Boolean(isLive));
}

function updateButton() {
  toggleButton.textContent = isStreaming ? "Stop Streaming" : "Start Streaming";
}

function renderQrCode(url) {
  if (!url) {
    return;
  }

  qrFrame.classList.remove("is-ready");
  qrImage.classList.remove("is-ready");
  qrImage.src = `/api/phone-qr?ts=${Date.now()}`;
  qrImage.dataset.url = url;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopStatsPolling() {
  if (statsTimer) {
    window.clearInterval(statsTimer);
    statsTimer = null;
  }
  lastStatsSnapshot = null;
}

function formatBitrate(bitsPerSecond) {
  if (!bitsPerSecond) {
    return "0 kbps";
  }

  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

function updateTelemetry(audioState = {}) {
  connectedDeviceEl.textContent = audioState.connectedDevice || "Windows default output";
  sampleRateEl.textContent = `${audioState.sampleRate || 48000} Hz / ${audioState.channels || 2} ch`;
  bitrateEl.textContent = `${formatBitrate(audioState.actualBitrate || audioState.bitrate)} target ${formatBitrate(audioState.bitrate)}`;
  capturePathEl.textContent = audioState.capturePath || "Windows shared output loopback";

  dawHintEl.textContent =
    selectedAudioDeviceId === "default"
      ? "ASIO cannot be captured directly. For ASIO DAWs, route the DAW to a shared WASAPI device or a virtual cable such as VB-CABLE. Sadly that is just the case until I find a better way to develop the application."
      : "The selected output device is promoted to the Windows shared default while capture is active so loopback can target it consistently. Sadly that is just the case until I find a better way to develop the application.";
}

async function emitHostStreamState(partialState) {
  socket.emit("host-stream-state", partialState);
}

function cleanupPeerConnection() {
  clearReconnectTimer();
  stopStatsPolling();

  if (!peerConnection) {
    return;
  }

  peerConnection.onicecandidate = null;
  peerConnection.onconnectionstatechange = null;
  peerConnection.close();
  peerConnection = null;
}

function stopCaptureStream() {
  if (!captureStream) {
    return;
  }

  captureStream.getTracks().forEach((track) => track.stop());
  captureStream = null;
}

function buildDisplayMediaOptions() {
  return {
    video: {
      displaySurface: "monitor",
      frameRate: {
        ideal: 1,
        max: 5,
      },
      width: {
        ideal: 1280,
      },
      height: {
        ideal: 720,
      },
    },
    audio: {
      channelCount: 2,
      sampleRate: 48000,
      sampleSize: 16,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: false,
    },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
    preferCurrentTab: false,
    monitorTypeSurfaces: "include",
  };
}

function applySenderQualityPreset(sender) {
  if (!sender) {
    return;
  }

  const parameters = sender.getParameters();
  parameters.degradationPreference = "maintain-resolution";
  parameters.encodings = parameters.encodings && parameters.encodings.length ? parameters.encodings : [{}];
  parameters.encodings[0].maxBitrate = captureSettings.state.bitrate;
  parameters.encodings[0].minBitrate = Math.min(captureSettings.state.bitrate, 96000);
  parameters.encodings[0].networkPriority = "high";
  parameters.encodings[0].priority = "high";
  sender.setParameters(parameters).catch(() => {});
}

function mungeOpusSdp(sdp) {
  if (!sdp) {
    return sdp;
  }

  const ptime = selectedQualityMode === "lowLatency" ? 10 : 20;
  const maxAverageBitrate = captureSettings?.state?.bitrate || 160000;
  const lines = sdp.split("\r\n");
  const opusLine = lines.find((line) => /^a=rtpmap:(\d+) opus\/48000\/2$/i.test(line));
  if (!opusLine) {
    return sdp;
  }

  const [, payloadType] = opusLine.match(/^a=rtpmap:(\d+) opus\/48000\/2$/i);
  const fmtpIndex = lines.findIndex((line) => line.startsWith(`a=fmtp:${payloadType}`));
  const opusConfig = `stereo=1;sprop-stereo=1;maxaveragebitrate=${maxAverageBitrate};minptime=10;ptime=${ptime};useinbandfec=1;usedtx=0`;

  if (fmtpIndex >= 0) {
    const current = lines[fmtpIndex].split(" ", 2);
    const existingParams = current[1] ? `${current[1]};` : "";
    lines[fmtpIndex] = `a=fmtp:${payloadType} ${existingParams}${opusConfig}`;
  } else {
    const rtpMapIndex = lines.findIndex((line) => line === opusLine);
    lines.splice(rtpMapIndex + 1, 0, `a=fmtp:${payloadType} ${opusConfig}`);
  }

  return lines.join("\r\n");
}

async function fetchRuntime() {
  const response = await fetch("/api/runtime");
  runtime = await response.json();
  phoneUrlEl.textContent = runtime.phoneUrl;
  localIpEl.textContent = runtime.preferredIp;
  portEl.textContent = String(runtime.port);
  renderQrCode(runtime.phoneUrl);
  receiverConnected = runtime.receiverConnected;
  updateTelemetry(runtime.audio || {});
  setStatus(receiverConnected ? "Phone connected" : "Waiting for phone", receiverConnected && isStreaming);
}

async function loadAudioSettings() {
  const response = await fetch("/api/audio/settings");
  captureSettings = await response.json();

  const { devices, presets, settings, state } = captureSettings;
  selectedAudioDeviceId = settings.selectedDeviceId;
  selectedQualityMode = settings.qualityMode;

  deviceSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "default";
  defaultOption.textContent = "Windows default output";
  deviceSelect.append(defaultOption);

  devices.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.Id;
    option.textContent = device.IsDefault ? `${device.Name} (Current default)` : device.Name;
    deviceSelect.append(option);
  });
  deviceSelect.value = selectedAudioDeviceId;

  qualitySelect.innerHTML = "";
  presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label} • ${formatBitrate(preset.bitrate)}`;
    qualitySelect.append(option);
  });
  qualitySelect.value = selectedQualityMode;

  updateTelemetry(state);
}

async function persistAudioSettings() {
  const response = await fetch("/api/audio/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      selectedDeviceId: selectedAudioDeviceId,
      qualityMode: selectedQualityMode,
    }),
  });
  captureSettings = await response.json();
  updateTelemetry(captureSettings.state);
}

function scheduleReconnect(reason) {
  if (!isStreaming || !receiverConnected || reconnectTimer) {
    return;
  }

  setStatus(reason, false);
  emitHostStreamState({
    status: "recovering",
    message: reason,
    peerState: "reconnecting",
  });

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    createOfferToReceiver().catch((error) => {
      setStatus(`Reconnect failed: ${error.message}`, false);
      emitHostStreamState({
        status: "recovering",
        message: `Reconnect failed: ${error.message}`,
        lastError: error.message,
      });
      scheduleReconnect("Retrying audio link");
    });
  }, 1200);
}

function createPeerConnection() {
  cleanupPeerConnection();
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;

    if (state === "connected") {
      setStatus("Streaming", true);
      emitHostStreamState({
        status: "streaming",
        message: "Streaming",
        peerState: state,
        lastError: null,
      });
      startStatsPolling();
      return;
    }

    if (state === "connecting") {
      setStatus("Negotiating audio link", false);
      emitHostStreamState({
        status: "starting",
        message: "Negotiating audio link",
        peerState: state,
      });
      return;
    }

    if (["failed", "disconnected", "closed"].includes(state)) {
      cleanupPeerConnection();
      scheduleReconnect("Connection dropped, retrying");
    }
  };
}

async function ensureCapture() {
  if (captureStream) {
    return captureStream;
  }

  captureStream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions());
  const audioTracks = captureStream.getAudioTracks();
  if (!audioTracks.length) {
    stopCaptureStream();
    throw new Error("No system loopback audio track detected.");
  }

  const [videoTrack] = captureStream.getVideoTracks();
  if (videoTrack) {
    videoTrack.stop();
  }

  const audioTrack = audioTracks[0];
  audioTrack.contentHint = "music";
  audioTrack.onended = () => {
    stopStreaming("System audio capture stopped.");
  };
  audioTrack.onmute = () => {
    setStatus("Capture muted on Windows output", false);
    emitHostStreamState({
      status: "recovering",
      message: "Capture muted on Windows output",
    });
  };

  return captureStream;
}

async function createOfferToReceiver() {
  if (!receiverConnected || !isStreaming) {
    return;
  }

  clearReconnectTimer();
  createPeerConnection();

  const stream = await ensureCapture();
  const [audioTrack] = stream.getAudioTracks();
  const transceiver = peerConnection.addTransceiver(audioTrack, {
    direction: "sendonly",
    streams: [stream],
  });

  const codecPreferences = RTCRtpSender.getCapabilities("audio").codecs.filter(
    (codec) => codec.mimeType.toLowerCase() === "audio/opus"
  );
  if (codecPreferences.length && transceiver.setCodecPreferences) {
    transceiver.setCodecPreferences(codecPreferences);
  }

  applySenderQualityPreset(transceiver.sender);

  let offer = await peerConnection.createOffer({
    offerToReceiveAudio: false,
    offerToReceiveVideo: false,
  });
  offer = {
    type: offer.type,
    sdp: mungeOpusSdp(offer.sdp),
  };
  await peerConnection.setLocalDescription(offer);
  socket.emit("offer", { sdp: peerConnection.localDescription });
  setStatus("Sending offer to phone", false);
}

async function startStatsPolling() {
  stopStatsPolling();

  statsTimer = window.setInterval(async () => {
    if (!peerConnection) {
      return;
    }

    const stats = await peerConnection.getStats();
    stats.forEach((report) => {
      if (report.type !== "outbound-rtp" || report.kind !== "audio") {
        return;
      }

      const timestamp = report.timestamp;
      if (lastStatsSnapshot) {
        const byteDelta = report.bytesSent - lastStatsSnapshot.bytesSent;
        const timeDeltaSeconds = (timestamp - lastStatsSnapshot.timestamp) / 1000;
        const actualBitrate = timeDeltaSeconds > 0 ? (byteDelta * 8) / timeDeltaSeconds : 0;

        bitrateEl.textContent = `${formatBitrate(actualBitrate)} target ${formatBitrate(captureSettings.state.bitrate)}`;
        emitHostStreamState({
          actualBitrate,
          sampleRate: 48000,
          channels: 2,
          status: "streaming",
          message: "Streaming",
          peerState: peerConnection.connectionState,
        });
      }

      lastStatsSnapshot = {
        bytesSent: report.bytesSent,
        timestamp,
      };
    });
  }, 1200);
}

async function startStreaming() {
  try {
    isStreaming = true;
    updateButton();
    setStatus("Starting", false);

    await persistAudioSettings();
    const response = await fetch("/api/audio/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        selectedDeviceId: selectedAudioDeviceId,
        qualityMode: selectedQualityMode,
      }),
    });
    captureSettings = await response.json();
    updateTelemetry(captureSettings.state);

    await ensureCapture();
    emitHostStreamState({
      status: "starting",
      message: "Starting",
      connectedDevice: captureSettings.state.connectedDevice,
      capturePath: captureSettings.state.capturePath,
      bitrate: captureSettings.state.bitrate,
      sampleRate: 48000,
      channels: 2,
      actualBitrate: 0,
      peerState: "starting",
      lastError: null,
    });

    if (receiverConnected) {
      await createOfferToReceiver();
    } else {
      setStatus("Waiting for phone", false);
    }
  } catch (error) {
    isStreaming = false;
    updateButton();
    setStatus(`Stream start failed: ${error.message}`, false);
    emitHostStreamState({
      status: "error",
      message: `Stream start failed: ${error.message}`,
      lastError: error.message,
    });
    await fetch("/api/audio/stop", { method: "POST" }).catch(() => {});
  }
}

async function stopStreaming(reason = "Streaming stopped") {
  isStreaming = false;
  updateButton();
  cleanupPeerConnection();
  stopCaptureStream();
  setStatus(reason, false);
  emitHostStreamState({
    status: "idle",
    message: reason,
    actualBitrate: 0,
    peerState: "disconnected",
  });
  await fetch("/api/audio/stop", { method: "POST" }).catch(() => {});
}

qrImage.addEventListener("load", () => {
  qrFrame.classList.add("is-ready");
  qrImage.classList.add("is-ready");
});

qrImage.addEventListener("error", () => {
  qrFrame.classList.remove("is-ready");
  qrImage.classList.remove("is-ready");
});

deviceSelect.addEventListener("change", async (event) => {
  selectedAudioDeviceId = event.target.value;
  await persistAudioSettings();
});

qualitySelect.addEventListener("change", async (event) => {
  selectedQualityMode = event.target.value;
  await persistAudioSettings();
});

socket.on("connect", () => {
  socket.emit("join-role", { role: "host" });
});

socket.on("role-joined", async (state) => {
  receiverConnected = state.receiverConnected;
  updateTelemetry(state.audio || {});
  if (isStreaming && receiverConnected && !peerConnection) {
    await createOfferToReceiver();
    return;
  }

  setStatus(receiverConnected ? "Phone connected" : "Waiting for phone", receiverConnected && isStreaming);
});

socket.on("client-state", async (state) => {
  receiverConnected = state.receiverConnected;

  if (!receiverConnected) {
    cleanupPeerConnection();
    setStatus(isStreaming ? "Waiting for phone" : "Disconnected", false);
    return;
  }

  if (isStreaming && !peerConnection) {
    await createOfferToReceiver();
    return;
  }

  if (!isStreaming) {
    setStatus("Phone connected", false);
  }
});

socket.on("audio-state", (audioState) => {
  if (!audioState) {
    return;
  }

  updateTelemetry(audioState);
});

socket.on("answer", async ({ sdp }) => {
  if (!peerConnection) {
    return;
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  setStatus("Negotiated audio link", false);
});

socket.on("ice-candidate", async ({ candidate }) => {
  if (!peerConnection || !candidate) {
    return;
  }

  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (_error) {
    scheduleReconnect("Refreshing ICE connection");
  }
});

socket.on("peer-left", ({ role }) => {
  if (role === "receiver") {
    receiverConnected = false;
    cleanupPeerConnection();
    setStatus(isStreaming ? "Waiting for phone" : "Disconnected", false);
    emitHostStreamState({
      status: isStreaming ? "starting" : "idle",
      message: isStreaming ? "Waiting for phone" : "Idle",
      peerState: "disconnected",
      actualBitrate: 0,
    });
  }
});

socket.on("stream-error", (message) => {
  setStatus(message, false);
  emitHostStreamState({
    status: "error",
    message,
    lastError: message,
  });
});

toggleButton.addEventListener("click", async () => {
  if (isStreaming) {
    await stopStreaming();
    return;
  }

  await startStreaming();
});

window.addEventListener("beforeunload", () => {
  if (isStreaming) {
    fetch("/api/audio/stop", { method: "POST", keepalive: true }).catch(() => {});
  }
});

Promise.all([fetchRuntime(), loadAudioSettings()]).catch((error) => {
  setStatus(`Runtime load failed: ${error.message}`, false);
});
updateButton();

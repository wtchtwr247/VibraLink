const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const toggleButton = document.getElementById("toggleButton");
const phoneUrlEl = document.getElementById("phoneUrl");
const localIpEl = document.getElementById("localIp");
const portEl = document.getElementById("port");
const qrFrame = document.getElementById("qrFrame");
const qrImage = document.getElementById("qrImage");

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 4000,
});

let runtime = null;
let peerConnection = null;
let captureStream = null;
let isStreaming = false;
let receiverConnected = false;
let reconnectTimer = null;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  bundlePolicy: "max-bundle",
};

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

qrImage.addEventListener("load", () => {
  qrFrame.classList.add("is-ready");
  qrImage.classList.add("is-ready");
});

qrImage.addEventListener("error", () => {
  qrFrame.classList.remove("is-ready");
  qrImage.classList.remove("is-ready");
});

function clearReconnectTimer() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function cleanupPeerConnection() {
  clearReconnectTimer();

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

async function fetchRuntime() {
  const response = await fetch("/api/runtime");
  runtime = await response.json();
  phoneUrlEl.textContent = runtime.phoneUrl;
  localIpEl.textContent = runtime.preferredIp;
  portEl.textContent = String(runtime.port);
  renderQrCode(runtime.phoneUrl);
  receiverConnected = runtime.receiverConnected;
  setStatus(receiverConnected ? "Phone connected" : "Waiting for phone", receiverConnected && isStreaming);
}

function scheduleReconnect(reason) {
  if (!isStreaming || !receiverConnected || reconnectTimer) {
    return;
  }

  setStatus(reason, false);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    createOfferToReceiver().catch((error) => {
      setStatus(`Reconnect failed: ${error.message}`, false);
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
      setStatus("Streaming to phone", true);
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

  // Electron routes this request through desktop loopback on Windows,
  // which captures system output instead of microphone input.
  captureStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  const audioTracks = captureStream.getAudioTracks();
  if (!audioTracks.length) {
    stopCaptureStream();
    throw new Error("No loopback audio track detected.");
  }

  const [videoTrack] = captureStream.getVideoTracks();
  if (videoTrack) {
    videoTrack.enabled = false;
  }

  audioTracks[0].contentHint = "music";
  audioTracks[0].onended = () => {
    stopStreaming("System audio capture stopped.");
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

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("offer", { sdp: peerConnection.localDescription });
  setStatus("Sending offer to phone", false);
}

async function startStreaming() {
  try {
    isStreaming = true;
    updateButton();
    setStatus("Starting loopback capture", false);
    await ensureCapture();

    if (receiverConnected) {
      await createOfferToReceiver();
    } else {
      setStatus("Waiting for phone", false);
    }
  } catch (error) {
    isStreaming = false;
    updateButton();
    setStatus(`Stream start failed: ${error.message}`, false);
  }
}

function stopStreaming(reason = "Streaming stopped") {
  isStreaming = false;
  updateButton();
  cleanupPeerConnection();
  stopCaptureStream();
  setStatus(reason, false);
}

socket.on("connect", () => {
  socket.emit("join-role", { role: "host" });
});

socket.on("role-joined", async (state) => {
  receiverConnected = state.receiverConnected;
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
  }
});

socket.on("stream-error", (message) => {
  setStatus(message, false);
});

toggleButton.addEventListener("click", async () => {
  if (isStreaming) {
    stopStreaming();
    return;
  }

  await startStreaming();
});

fetchRuntime().catch((error) => {
  setStatus(`Runtime load failed: ${error.message}`, false);
});
updateButton();

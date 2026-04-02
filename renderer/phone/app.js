const connectButton = document.getElementById("connectButton");
const statusEl = document.getElementById("status");
const audioEl = document.getElementById("audio");

const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 4000,
});

let peerConnection = null;
let wantsConnection = false;

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  bundlePolicy: "max-bundle",
};

function setStatus(text) {
  statusEl.textContent = text;
}

function updateButton() {
  connectButton.textContent = wantsConnection ? "Disconnect" : "Connect";
}

function cleanupPeerConnection() {
  if (!peerConnection) {
    return;
  }

  peerConnection.ontrack = null;
  peerConnection.onicecandidate = null;
  peerConnection.onconnectionstatechange = null;
  peerConnection.close();
  peerConnection = null;
}

function ensurePeerConnection() {
  if (peerConnection) {
    return peerConnection;
  }

  peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;
    audioEl.srcObject = stream;
    audioEl.play().catch(() => {});
    setStatus("Receiving audio");
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === "connected") {
      setStatus("Connected");
      return;
    }

    if (["failed", "disconnected", "closed"].includes(state)) {
      cleanupPeerConnection();
      if (wantsConnection) {
        setStatus("Reconnecting");
      }
    }
  };

  return peerConnection;
}

function connectToDesktop() {
  if (socket.connected) {
    socket.emit("join-role", { role: "receiver" });
    setStatus("Waiting for stream");
    return;
  }

  socket.connect();
  setStatus("Connecting");
}

socket.on("connect", () => {
  socket.emit("join-role", { role: "receiver" });
  setStatus("Waiting for stream");
});

socket.on("offer", async ({ sdp }) => {
  const currentPeer = ensurePeerConnection();
  await currentPeer.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await currentPeer.createAnswer();
  await currentPeer.setLocalDescription(answer);
  socket.emit("answer", { sdp: currentPeer.localDescription });
  setStatus("Negotiating audio");
});

socket.on("ice-candidate", async ({ candidate }) => {
  if (!peerConnection || !candidate) {
    return;
  }

  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (_error) {
    cleanupPeerConnection();
    if (wantsConnection) {
      setStatus("Refreshing connection");
    }
  }
});

socket.on("peer-left", ({ role }) => {
  if (role === "host") {
    cleanupPeerConnection();
    if (wantsConnection) {
      setStatus("Desktop app disconnected");
    }
  }
});

socket.on("stream-error", (message) => {
  setStatus(message);
});

connectButton.addEventListener("click", () => {
  wantsConnection = !wantsConnection;
  updateButton();

  if (!wantsConnection) {
    cleanupPeerConnection();
    socket.disconnect();
    audioEl.srcObject = null;
    setStatus("Disconnected");
    return;
  }

  connectToDesktop();
});

updateButton();

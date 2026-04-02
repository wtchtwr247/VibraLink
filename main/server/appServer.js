const path = require("path");
const http = require("http");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const { getLocalIPv4Addresses, getPreferredLocalIp } = require("../network/localNetwork");
const { WindowsAudioDeviceService } = require("../audio/windowsAudioDeviceService");
const { QUALITY_PRESETS, getQualityPreset } = require("../audio/qualityPresets");

class AppServer {
  constructor() {
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.io = new Server(this.httpServer, {
      cors: {
        origin: "*",
      },
    });

    this.runtime = null;
    this.state = {
      hostConnected: false,
      receiverConnected: false,
    };
    this.audioDevices = new WindowsAudioDeviceService();
    this.settings = {
      selectedDeviceId: "default",
      qualityMode: "balanced",
    };
    this.captureSession = {
      previousDefaultDeviceId: null,
      currentDevice: null,
      restorePending: false,
    };
    this.audioState = {
      status: "idle",
      message: "Idle",
      selectedDeviceId: "default",
      selectedQualityMode: "balanced",
      connectedDevice: "Windows default output",
      capturePath: "Windows shared output loopback",
      sampleRate: 48000,
      channels: 2,
      bitrate: getQualityPreset("balanced").bitrate,
      actualBitrate: 0,
      receiverConnected: false,
      peerState: "disconnected",
      lastError: null,
    };
    this.roleSockets = {
      host: null,
      receiver: null,
    };
    this.started = false;
  }

  async start() {
    const phoneUiDir = path.join(__dirname, "../../renderer/phone");
    const desktopUiDir = path.join(__dirname, "../../renderer/desktop");

    this.app.use(express.json());
    this.app.use("/phone", express.static(phoneUiDir));
    this.app.use("/desktop", express.static(desktopUiDir));

    this.app.get("/", (_req, res) => {
      res.sendFile(path.join(phoneUiDir, "index.html"));
    });

    this.app.get("/desktop", (_req, res) => {
      res.sendFile(path.join(desktopUiDir, "index.html"));
    });

    this.app.get("/api/health", (_req, res) => {
      res.json({ ok: true });
    });

    this.app.get("/api/runtime", (_req, res) => {
      res.json({
        ...this.runtime,
        ...this.state,
        audio: this.audioState,
      });
    });

    this.app.get("/api/audio/devices", async (_req, res, next) => {
      try {
        const devices = await this.audioDevices.listDevices();
        res.json({
          devices,
          selectedDeviceId: this.settings.selectedDeviceId,
        });
      } catch (error) {
        next(error);
      }
    });

    this.app.get("/api/audio/settings", async (_req, res, next) => {
      try {
        const devices = await this.audioDevices.listDevices();
        res.json({
          devices,
          presets: Object.values(QUALITY_PRESETS),
          settings: this.settings,
          state: this.audioState,
        });
      } catch (error) {
        next(error);
      }
    });

    this.app.post("/api/audio/settings", async (req, res, next) => {
      try {
        const { selectedDeviceId, qualityMode } = req.body || {};
        this.applySettings({
          selectedDeviceId,
          qualityMode,
        });
        this.broadcastAudioState();
        res.json({
          settings: this.settings,
          state: this.audioState,
        });
      } catch (error) {
        next(error);
      }
    });

    this.app.post("/api/audio/start", async (req, res, next) => {
      try {
        const { selectedDeviceId, qualityMode } = req.body || {};
        await this.prepareAudioCapture({
          selectedDeviceId,
          qualityMode,
        });
        res.json({
          settings: this.settings,
          state: this.audioState,
        });
      } catch (error) {
        next(error);
      }
    });

    this.app.post("/api/audio/stop", async (_req, res, next) => {
      try {
        await this.endAudioCapture();
        res.json({
          settings: this.settings,
          state: this.audioState,
        });
      } catch (error) {
        next(error);
      }
    });

    this.app.get("/api/phone-qr", async (_req, res, next) => {
      try {
        const svg = await QRCode.toString(this.runtime.phoneUrl, {
          type: "svg",
          margin: 1,
          width: 220,
          errorCorrectionLevel: "M",
          color: {
            dark: "#11161d",
            light: "#f7fbff",
          },
        });

        res.type("image/svg+xml");
        res.send(svg);
      } catch (error) {
        next(error);
      }
    });

    this.configureSignaling();

    const port = await new Promise((resolve) => {
      this.httpServer.listen(process.env.PORT || 0, "0.0.0.0", () => {
        const address = this.httpServer.address();
        resolve(address.port);
      });
    });
    this.started = true;

    const localIps = getLocalIPv4Addresses();
    const preferredIp = getPreferredLocalIp();

    this.runtime = {
      port,
      localIps,
      preferredIp,
      desktopUrl: `http://127.0.0.1:${port}/desktop`,
      phoneUrl: `http://${preferredIp}:${port}`,
    };

    return this.runtime;
  }

  configureSignaling() {
    this.io.on("connection", (socket) => {
      socket.on("join-role", ({ role }) => {
        if (!["host", "receiver"].includes(role)) {
          socket.emit("stream-error", "Unknown role.");
          return;
        }

        const existingSocketId = this.roleSockets[role];
        if (existingSocketId && existingSocketId !== socket.id) {
          const existingSocket = this.io.sockets.sockets.get(existingSocketId);
          if (existingSocket) {
            existingSocket.emit("stream-error", `${role} session replaced by a newer connection.`);
            existingSocket.disconnect(true);
          }
        }

        socket.data.role = role;
        this.roleSockets[role] = socket.id;
        this.refreshState();
        socket.emit("role-joined", {
          role,
          ...this.state,
          audio: this.audioState,
        });
        this.broadcastState();
        socket.emit("audio-state", this.audioState);
      });

      socket.on("offer", ({ sdp }) => {
        this.emitToRole("receiver", "offer", { sdp });
      });

      socket.on("answer", ({ sdp }) => {
        this.emitToRole("host", "answer", { sdp });
      });

      socket.on("ice-candidate", ({ candidate }) => {
        const targetRole = socket.data.role === "host" ? "receiver" : "host";
        this.emitToRole(targetRole, "ice-candidate", { candidate });
      });

      socket.on("host-stream-state", (payload) => {
        if (socket.data.role !== "host" || !payload) {
          return;
        }

        this.audioState = {
          ...this.audioState,
          ...payload,
          receiverConnected: this.state.receiverConnected,
        };
        this.broadcastAudioState();
      });

      socket.on("disconnect", () => {
        if (socket.data.role && this.roleSockets[socket.data.role] === socket.id) {
          this.roleSockets[socket.data.role] = null;
        }

        this.refreshState();
        this.broadcastState();
        this.audioState.receiverConnected = this.state.receiverConnected;
        if (socket.data.role === "host") {
          this.audioState.peerState = "disconnected";
        }
        this.broadcastAudioState();
        this.io.emit("peer-left", {
          role: socket.data.role || "unknown",
        });
      });
    });
  }

  emitToRole(role, eventName, payload) {
    const socketId = this.roleSockets[role];
    if (!socketId) {
      return;
    }

    this.io.to(socketId).emit(eventName, payload);
  }

  refreshState() {
    this.state.hostConnected = Boolean(this.roleSockets.host);
    this.state.receiverConnected = Boolean(this.roleSockets.receiver);
    this.audioState.receiverConnected = this.state.receiverConnected;
  }

  broadcastState() {
    this.io.emit("client-state", this.state);
  }

  broadcastAudioState() {
    this.io.emit("audio-state", this.audioState);
  }

  applySettings({ selectedDeviceId, qualityMode }) {
    if (selectedDeviceId) {
      this.settings.selectedDeviceId = selectedDeviceId;
      this.audioState.selectedDeviceId = selectedDeviceId;
    }

    if (qualityMode && QUALITY_PRESETS[qualityMode]) {
      this.settings.qualityMode = qualityMode;
      this.audioState.selectedQualityMode = qualityMode;
      this.audioState.bitrate = getQualityPreset(qualityMode).bitrate;
    }
  }

  async prepareAudioCapture({ selectedDeviceId, qualityMode }) {
    this.applySettings({ selectedDeviceId, qualityMode });

    const devices = await this.audioDevices.listDevices();
    const defaultDevice = devices.find((device) => device.IsDefault) || null;
    const desiredDevice =
      this.settings.selectedDeviceId === "default"
        ? defaultDevice
        : devices.find((device) => device.Id === this.settings.selectedDeviceId);

    if (!desiredDevice && this.settings.selectedDeviceId !== "default") {
      throw new Error("Selected output device is no longer available.");
    }

    const effectiveDevice =
      desiredDevice || {
        Id: "default",
        Name: "Windows default output",
        IsDefault: true,
      };

    this.captureSession.currentDevice = effectiveDevice;
    this.captureSession.restorePending = false;

    if (defaultDevice && effectiveDevice.Id !== defaultDevice.Id) {
      this.captureSession.previousDefaultDeviceId = defaultDevice.Id;
      await this.audioDevices.setDefaultDevice(effectiveDevice.Id);
      this.captureSession.restorePending = true;
    } else {
      this.captureSession.previousDefaultDeviceId = null;
    }

    this.audioState = {
      ...this.audioState,
      status: "starting",
      message: "Starting shared-output loopback capture",
      connectedDevice: effectiveDevice.Name,
      selectedDeviceId: this.settings.selectedDeviceId,
      selectedQualityMode: this.settings.qualityMode,
      bitrate: getQualityPreset(this.settings.qualityMode).bitrate,
      sampleRate: 48000,
      channels: 2,
      capturePath:
        this.captureSession.restorePending
          ? "Selected Windows shared output loopback"
          : "Windows default shared output loopback",
      lastError: null,
    };

    this.broadcastAudioState();
  }

  async endAudioCapture() {
    if (this.captureSession.restorePending && this.captureSession.previousDefaultDeviceId) {
      try {
        await this.audioDevices.setDefaultDevice(this.captureSession.previousDefaultDeviceId);
      } catch (error) {
        this.audioState.lastError = `Failed to restore previous Windows output: ${error.message}`;
      }
    }

    this.captureSession = {
      previousDefaultDeviceId: null,
      currentDevice: null,
      restorePending: false,
    };

    this.audioState = {
      ...this.audioState,
      status: "idle",
      message: "Idle",
      connectedDevice: "Windows default output",
      capturePath: "Windows shared output loopback",
      actualBitrate: 0,
      peerState: "disconnected",
    };

    this.broadcastAudioState();
  }

  async stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    await this.endAudioCapture();
    this.io.close();

    await new Promise((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

module.exports = {
  AppServer,
};

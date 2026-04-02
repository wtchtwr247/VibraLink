const path = require("path");
const http = require("http");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const { getLocalIPv4Addresses, getPreferredLocalIp } = require("../network/localNetwork");

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
      });
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
        });
        this.broadcastState();
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

      socket.on("disconnect", () => {
        if (socket.data.role && this.roleSockets[socket.data.role] === socket.id) {
          this.roleSockets[socket.data.role] = null;
        }

        this.refreshState();
        this.broadcastState();
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
  }

  broadcastState() {
    this.io.emit("client-state", this.state);
  }

  async stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
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

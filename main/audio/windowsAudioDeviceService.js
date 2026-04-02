const path = require("path");
const { execFile } = require("child_process");

class WindowsAudioDeviceService {
  constructor() {
    this.scriptPath = path.join(__dirname, "windowsAudioDeviceService.ps1");
  }

  listDevices() {
    return this.run("list")
      .then((output) => {
        if (!output) {
          return [];
        }

        const parsed = JSON.parse(output);
        return Array.isArray(parsed) ? parsed : [parsed];
      })
      .catch(() => []);
  }

  async setDefaultDevice(deviceId) {
    await this.run("set", deviceId);
  }

  run(command, deviceId) {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", this.scriptPath, command];
    if (deviceId) {
      args.push("-DeviceId", deviceId);
    }

    return new Promise((resolve, reject) => {
      execFile("powershell.exe", args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout.trim());
      });
    });
  }
}

module.exports = {
  WindowsAudioDeviceService,
};

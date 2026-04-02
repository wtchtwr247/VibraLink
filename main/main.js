const path = require("path");
const { app, BrowserWindow, desktopCapturer, session } = require("electron");
const { AppServer } = require("./server/appServer");

let mainWindow = null;
let server = null;
const windowIconPath = path.join(app.getAppPath(), "build-resources", "VibraLink.png");

async function configureLoopbackCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: 1,
          height: 1,
        },
      });

      callback({
        video: sources[0],
        audio: "loopback",
      });
    },
    {
      useSystemPicker: false,
    }
  );
}

async function createMainWindow(runtime) {
  mainWindow = new BrowserWindow({
    title: "VibraLink",
    width: 980,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#11161d",
    autoHideMenuBar: true,
    icon: windowIconPath,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  await mainWindow.loadURL(runtime.desktopUrl);
}

async function bootstrap() {
  server = new AppServer();
  const runtime = await server.start();
  console.log(`VibraLink desktop URL: ${runtime.desktopUrl}`);
  console.log(`VibraLink phone URL: ${runtime.phoneUrl}`);
  await configureLoopbackCapture();
  await createMainWindow(runtime);
}

app.setName("VibraLink");
app.setAppUserModelId("com.framefield.vibralink");

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async () => {
  if (server) {
    await server.stop();
  }
});

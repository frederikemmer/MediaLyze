const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveFfprobePath } = require("./ffprobe-paths.cjs");

let mainWindow = null;
let backendProcess = null;
let quitting = false;
let backendPort = null;

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function bundledBinaryName() {
  return process.platform === "win32" ? "medialyze-backend.exe" : "medialyze-backend";
}

function resolveFrontendDistPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "frontend-dist");
  }
  return path.join(repoRoot(), "frontend", "dist");
}

function resolveBackendCommand() {
  if (app.isPackaged) {
    return {
      command: path.join(
        process.resourcesPath,
        "backend",
        "medialyze-backend",
        bundledBinaryName()
      ),
      args: [],
      cwd: process.resourcesPath,
    };
  }

  return {
    command: process.env.MEDIALYZE_DESKTOP_PYTHON || process.env.PYTHON || "python3",
    args: ["-m", "backend.app.launcher"],
    cwd: repoRoot(),
  };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a free local port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function waitForHealth(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error("Timed out while waiting for the MediaLyze backend"));
        return;
      }

      const request = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/api/health",
        },
        (response) => {
          response.resume();
          if (response.statusCode === 200) {
            resolve();
            return;
          }
          setTimeout(attempt, 500);
        }
      );
      request.on("error", () => {
        setTimeout(attempt, 500);
      });
    };

    attempt();
  });
}

function stopBackend() {
  if (!backendProcess) {
    return;
  }
  const activeProcess = backendProcess;
  backendProcess = null;
  backendPort = null;
  if (process.platform === "win32") {
    activeProcess.kill();
    return;
  }
  activeProcess.kill("SIGTERM");
}

function startBackend(port) {
  const launch = resolveBackendCommand();
  const configPath = app.getPath("userData");
  const isPackagedWindows = app.isPackaged && process.platform === "win32";
  backendProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      MEDIALYZE_RUNTIME: "desktop",
      APP_HOST: "127.0.0.1",
      APP_PORT: String(port),
      CONFIG_PATH: configPath,
      FRONTEND_DIST_PATH: resolveFrontendDistPath(),
      FFPROBE_PATH: resolveFfprobePath({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
      PYTHONUNBUFFERED: "1",
    },
    stdio: isPackagedWindows ? "ignore" : "inherit",
    windowsHide: isPackagedWindows,
  });
  backendPort = port;

  backendProcess.once("exit", (code) => {
    backendProcess = null;
    if (!quitting) {
      dialog.showErrorBox(
        "MediaLyze backend stopped",
        `The local backend exited unexpectedly with code ${code ?? "unknown"}.`
      );
      app.quit();
    }
  });
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

ipcMain.handle("medialyze:select-library-path", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select library folder",
    properties: ["openDirectory"],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0] ?? null;
});

async function launchDesktopApp() {
  const port = backendProcess && backendPort ? backendPort : await findFreePort();
  if (!backendProcess) {
    startBackend(port);
  }
  await waitForHealth(port);
  createMainWindow(port);
}

app.on("before-quit", () => {
  quitting = true;
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (!mainWindow) {
    try {
      await launchDesktopApp();
    } catch (error) {
      dialog.showErrorBox("MediaLyze failed to start", String(error));
      app.quit();
    }
  }
});

app.whenReady().then(async () => {
  try {
    await launchDesktopApp();
  } catch (error) {
    dialog.showErrorBox("MediaLyze failed to start", String(error));
    app.quit();
  }
});

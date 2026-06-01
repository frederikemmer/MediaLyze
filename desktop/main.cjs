const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveFfmpegPath, resolveFfprobePath } = require("./ffprobe-paths.cjs");
const { buildLatestInstallerDownload, isAllowedInstallerDownloadUrl } = require("./update-download.cjs");

let mainWindow = null;
let backendProcess = null;
let quitting = false;
let backendPort = null;

if (process.argv.includes("--version")) {
  console.log(app.getVersion());
  app.exit(0);
}

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
  const backendEnv = {
    ...process.env,
    MEDIALYZE_RUNTIME: "desktop",
    APP_HOST: "127.0.0.1",
    APP_PORT: String(port),
    CONFIG_PATH: configPath,
    FRONTEND_DIST_PATH: resolveFrontendDistPath(),
    FFMPEG_PATH: resolveFfmpegPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }),
    FFPROBE_PATH: resolveFfprobePath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }),
    PYTHONUNBUFFERED: "1",
  };

  backendProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: backendEnv,
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

ipcMain.handle("medialyze:select-library-paths", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select library folder",
    properties: ["openDirectory", "multiSelections"],
  });
  if (result.canceled) {
    return [];
  }
  return result.filePaths;
});

ipcMain.handle("medialyze:open-external-url", async (_event, url) => {
  if (typeof url !== "string") {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  await shell.openExternal(parsed.toString());
  return true;
});

function downloadToFile(url, destinationPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!isAllowedInstallerDownloadUrl(url)) {
      reject(new Error("Installer URL is not allowed"));
      return;
    }
    downloadUrlToFile(url, destinationPath, redirectsLeft, resolve, reject);
  });
}

function downloadUrlToFile(url, destinationPath, redirectsLeft, resolve, reject) {
  const request = https.get(url, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      if (redirectsLeft <= 0) {
        reject(new Error("Too many installer download redirects"));
        return;
      }
      const redirectedUrl = new URL(response.headers.location, url).toString();
      if (!redirectedUrl.startsWith("https://")) {
        reject(new Error("Installer redirect is not HTTPS"));
        return;
      }
      response.resume();
      downloadUrlToFile(redirectedUrl, destinationPath, redirectsLeft - 1, resolve, reject);
      return;
    }
    if (response.statusCode !== 200) {
      response.resume();
      reject(new Error(`Installer download failed with HTTP ${response.statusCode}`));
      return;
    }
    const file = fs.createWriteStream(destinationPath);
    response.pipe(file);
    file.on("finish", () => file.close(resolve));
    file.on("error", reject);
  });
  request.on("error", reject);
}

ipcMain.handle("medialyze:download-latest-installer", async (_event, version) => {
  if (typeof version !== "string") {
    return { ok: false, error: "Invalid target version" };
  }
  const download = buildLatestInstallerDownload(process.platform, version);
  if (!download) {
    return { ok: false, error: "No installer available for this platform or version" };
  }
  const destinationPath = path.join(app.getPath("desktop"), download.filename);
  try {
    await downloadToFile(download.url, destinationPath);
    return { ok: true, path: destinationPath, filename: download.filename };
  } catch (error) {
    await fs.promises.rm(destinationPath, { force: true });
    return { ok: false, error: String(error) };
  }
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

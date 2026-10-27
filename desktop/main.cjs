const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { spawn } = require("node:child_process");
const { resolveFfmpegPath, resolveFfprobePath } = require("./ffprobe-paths.cjs");
const {
  createInstallerIntegrityVerifier,
  installerFilters,
  isAllowedInstallerDownloadUrl,
  isAllowedInstallerRedirectUrl,
  selectInstallerAsset,
  validateInstallerContentLength,
} = require("./update-download.cjs");

let mainWindow = null;
let backendProcess = null;
let quitting = false;
let backendPort = null;
let activeInstallerDownload = null;
const desktopCredential = crypto.randomBytes(48).toString("base64url");

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
          headers: { "X-MediaLyze-Desktop": desktopCredential },
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
    MEDIALYZE_DESKTOP_TOKEN: desktopCredential,
    ...(app.isPackaged ? { MEDIALYZE_APP_VERSION: app.getVersion() } : {}),
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
      partition: `medialyze-${crypto.randomUUID()}`,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const backendOrigin = `http://127.0.0.1:${port}`;
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "x-medialyze-desktop") delete headers[key];
    }
    if (new URL(details.url).origin === backendOrigin && details.webContentsId === mainWindow?.webContents.id) {
      headers["X-MediaLyze-Desktop"] = desktopCredential;
    }
    callback({ requestHeaders: headers });
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== backendOrigin) event.preventDefault();
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

class InstallerDownloadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getLocalUpdateStatus() {
  return new Promise((resolve, reject) => {
    if (!backendPort) {
      reject(new InstallerDownloadError("network_error", "Backend is not running"));
      return;
    }
    const request = http.get(
      { host: "127.0.0.1", port: backendPort, path: "/api/update-status", headers: { "X-MediaLyze-Desktop": desktopCredential } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new InstallerDownloadError("network_error", `Update status failed with HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            request.destroy(new InstallerDownloadError("network_error", "Update status response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new InstallerDownloadError("network_error", "Update status response is invalid"));
          }
        });
      },
    );
    request.on("error", reject);
  });
}

function openInstallerResponse(url, asset, signal, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        if (redirectsLeft <= 0) {
          response.resume();
          reject(new InstallerDownloadError("network_error", "Too many installer download redirects"));
          return;
        }
        const redirectedUrl = new URL(response.headers.location, url).toString();
        if (!isAllowedInstallerRedirectUrl(redirectedUrl)) {
          response.resume();
          reject(new InstallerDownloadError("network_error", "Installer redirect is not allowed"));
          return;
        }
        response.resume();
        void openInstallerResponse(redirectedUrl, asset, signal, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new InstallerDownloadError("network_error", `Installer download failed with HTTP ${response.statusCode}`));
        return;
      }
      const contentLength = response.headers["content-length"];
      try {
        validateInstallerContentLength(contentLength, asset.size_bytes);
      } catch (error) {
        response.resume();
        reject(error);
        return;
      }
      resolve(response);
    });
    if (activeInstallerDownload) {
      activeInstallerDownload.request = request;
    }
    request.on("error", (error) => {
      if (signal.aborted) {
        reject(new InstallerDownloadError("canceled", "Installer download was canceled"));
      } else {
        reject(error);
      }
    });
  });
}

async function downloadAndVerifyInstaller(asset, temporaryPath, controller) {
  if (!isAllowedInstallerDownloadUrl(asset.download_url, asset.version, asset.filename)) {
    throw new InstallerDownloadError("asset_unavailable", "Installer URL is not allowed");
  }
  const response = await openInstallerResponse(asset.download_url, asset, controller.signal);
  const verifier = createInstallerIntegrityVerifier(asset);
  try {
    await pipeline(
      response,
      verifier.stream,
      fs.createWriteStream(temporaryPath, { flags: "wx" }),
      { signal: controller.signal },
    );
  } catch (error) {
    if (
      !(error instanceof InstallerDownloadError)
      && error?.name !== "AbortError"
      && ["EACCES", "EEXIST", "ENOSPC", "EROFS"].includes(error?.code)
    ) {
      throw new InstallerDownloadError("save_error", String(error));
    }
    throw error;
  }
  verifier.verify();
}

async function replaceVerifiedInstaller(temporaryPath, destinationPath) {
  const backupPath = `${destinationPath}.${process.pid}-${Date.now()}.backup`;
  let movedExistingFile = false;
  try {
    try {
      await fs.promises.rename(destinationPath, backupPath);
      movedExistingFile = true;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    await fs.promises.rename(temporaryPath, destinationPath);
    if (movedExistingFile) {
      await fs.promises.rm(backupPath, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (movedExistingFile) {
      await fs.promises.rename(backupPath, destinationPath).catch(() => undefined);
    }
    throw error;
  }
}

ipcMain.handle("medialyze:download-latest-installer", async (_event, version) => {
  if (typeof version !== "string") {
    return { ok: false, status: "asset_unavailable", error: "Invalid target version" };
  }
  if (activeInstallerDownload) {
    return { ok: false, status: "network_error", error: "Another installer download is already running" };
  }

  let temporaryPath = null;
  try {
    const updateStatus = await getLocalUpdateStatus();
    const selection = selectInstallerAsset(updateStatus, process.platform, process.arch, version);
    if (!selection.asset) {
      return { ok: false, status: selection.status };
    }
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: `Save MediaLyze v${version} installer`,
      defaultPath: path.join(app.getPath("downloads"), selection.asset.localFilename),
      filters: installerFilters(selection.target),
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, status: "canceled" };
    }

    temporaryPath = `${saveResult.filePath}.${crypto.randomUUID()}.part`;
    const controller = new AbortController();
    activeInstallerDownload = { controller, request: null, temporaryPath };
    await downloadAndVerifyInstaller(
      { ...selection.asset, version },
      temporaryPath,
      controller,
    );
    try {
      await replaceVerifiedInstaller(temporaryPath, saveResult.filePath);
    } catch (error) {
      throw new InstallerDownloadError("save_error", String(error));
    }
    temporaryPath = null;
    return {
      ok: true,
      status: "success",
      path: saveResult.filePath,
      filename: path.basename(saveResult.filePath),
    };
  } catch (error) {
    const status = error instanceof InstallerDownloadError || error?.status
      ? error.status
      : error?.name === "AbortError"
        ? "canceled"
        : "network_error";
    return { ok: false, status, error: String(error) };
  } finally {
    if (temporaryPath) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    activeInstallerDownload = null;
  }
});

ipcMain.handle("medialyze:cancel-installer-download", () => {
  if (!activeInstallerDownload) {
    return false;
  }
  activeInstallerDownload.controller.abort();
  return true;
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

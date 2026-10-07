import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export function resolveBackendPaths(scriptPath = fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..");
  return {
    repoRoot,
    backendPath: path.join(
      repoRoot,
      "dist",
      "desktop-backend",
      "medialyze-backend",
      "medialyze-backend.exe"
    ),
  };
}

const { repoRoot, backendPath } = resolveBackendPaths();
const healthTimeoutMs = 30_000;
const requestTimeoutMs = 1_000;
const maxCapturedOutputCharacters = 12_000;

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate a local port for the backend smoke test.");
  }

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function failureWithOutput(message, output) {
  const details = output.trim();
  return new Error(details ? `${message}\n\nBackend output:\n${details}` : message);
}

async function waitForHealth(child, port, getOutput) {
  const deadline = Date.now() + healthTimeoutMs;
  let spawnError = null;
  child.once("error", (error) => {
    spawnError = error;
  });

  while (Date.now() < deadline) {
    if (spawnError) {
      throw failureWithOutput(`Unable to start packaged backend: ${spawnError.message}`, getOutput());
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw failureWithOutput(
        `Packaged backend exited before becoming healthy (code ${child.exitCode ?? "unknown"}).`,
        getOutput()
      );
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok && (await response.json()).status === "ok") {
        return;
      }
    } catch {
      // The backend is still starting or has not bound its local port yet.
    }

    await delay(250);
  }

  throw failureWithOutput(
    `Packaged backend did not pass /api/health within ${healthTimeoutMs / 1000} seconds.`,
    getOutput()
  );
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("The packaged backend startup smoke test is intended for Windows CI.");
  }

  const configPath = mkdtempSync(path.join(os.tmpdir(), "medialyze-backend-smoke-"));
  let child = null;
  let output = "";
  const capture = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-maxCapturedOutputCharacters);
  };

  try {
    const port = await findFreePort();
    child = spawn(backendPath, [], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MEDIALYZE_RUNTIME: "desktop",
        APP_HOST: "127.0.0.1",
        APP_PORT: String(port),
        CONFIG_PATH: configPath,
        FRONTEND_DIST_PATH: path.join(repoRoot, "frontend", "dist"),
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);

    await waitForHealth(child, port, () => output);
    console.log("Packaged Windows backend passed /api/health smoke test.");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([once(child, "exit").catch(() => undefined), delay(5_000)]);
    }
    rmSync(configPath, { recursive: true, force: true });
  }
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  main().catch((error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}

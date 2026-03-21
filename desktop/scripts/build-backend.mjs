import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const outputDir = path.join(repoRoot, "dist", "desktop-backend");
const workDir = path.join(repoRoot, "dist", "pyinstaller-work");
const specDir = path.join(repoRoot, "dist", "pyinstaller-spec");

function resolvePythonInvocation() {
  if (process.env.MEDIALYZE_DESKTOP_PYTHON) {
    return {
      command: process.env.MEDIALYZE_DESKTOP_PYTHON,
      args: [],
    };
  }

  if (process.platform === "win32") {
    const venv = process.env.VIRTUAL_ENV;
    if (venv) {
      const venvPython = path.join(venv, "Scripts", "python.exe");
      if (existsSync(venvPython)) {
        return {
          command: venvPython,
          args: [],
        };
      }
    }

    if (process.env.PYTHON) {
      return {
        command: process.env.PYTHON,
        args: [],
      };
    }

    return {
      command: "py",
      args: ["-3.12"],
    };
  }

  if (process.env.PYTHON) {
    return {
      command: process.env.PYTHON,
      args: [],
    };
  }

  return {
    command: "python3",
    args: [],
  };
}

const pythonInvocation = resolvePythonInvocation();
const pyInstallerArgs = [
  ...pythonInvocation.args,
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--name",
  "medialyze-backend",
  "--distpath",
  outputDir,
  "--workpath",
  workDir,
  "--specpath",
  specDir,
  "--paths",
  repoRoot,
];

if (process.platform === "win32") {
  pyInstallerArgs.push("--noconsole");
}

pyInstallerArgs.push(path.join(repoRoot, "backend", "app", "launcher.py"));

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(specDir, { recursive: true });

const pyInstallerResult = spawnSync(
  pythonInvocation.command,
  pyInstallerArgs,
  {
    cwd: repoRoot,
    stdio: "inherit",
  }
);

if (pyInstallerResult.status !== 0) {
  process.exit(pyInstallerResult.status ?? 1);
}

const bundledFfprobeDir = process.env.MEDIALYZE_FFPROBE_DIR;
if (bundledFfprobeDir && existsSync(bundledFfprobeDir)) {
  cpSync(bundledFfprobeDir, path.join(outputDir, "ffprobe"), { recursive: true });
}

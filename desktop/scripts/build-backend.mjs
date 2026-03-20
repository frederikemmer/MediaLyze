import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const outputDir = path.join(repoRoot, "dist", "desktop-backend");
const workDir = path.join(repoRoot, "dist", "pyinstaller-work");
const specDir = path.join(repoRoot, "dist", "pyinstaller-spec");
const pythonBin = process.env.MEDIALYZE_DESKTOP_PYTHON || process.env.PYTHON || "python3";
const pyInstallerArgs = [
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
  pythonBin,
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

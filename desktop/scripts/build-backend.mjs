import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..", "..");
const outputDir = path.join(repoRoot, "dist", "desktop-backend");
const workDir = path.join(repoRoot, "dist", "pyinstaller-work");
const specDir = path.join(repoRoot, "dist", "pyinstaller-spec");

export function bundledFfprobeName(platform = process.platform) {
  return platform === "win32" ? "ffprobe.exe" : "ffprobe";
}

export function bundledFfmpegName(platform = process.platform) {
  return platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function commandLookupInvocation(platform = process.platform) {
  return platform === "win32"
    ? { command: "where", args: ["ffprobe"] }
    : { command: "which", args: ["ffprobe"] };
}

function firstExistingLine(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

export function resolveBundledFfprobeSource({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  stat = statSync,
  lookup = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
} = {}) {
  const executableName = bundledFfprobeName(platform);
  const configuredPath = env.MEDIALYZE_FFPROBE_DIR?.trim();

  if (configuredPath) {
    if (!exists(configuredPath)) {
      throw new Error(
        `MEDIALYZE_FFPROBE_DIR does not exist: ${configuredPath}`
      );
    }
    const configuredStat = stat(configuredPath);
    if (configuredStat.isDirectory()) {
      const bundledExecutable = path.join(configuredPath, executableName);
      if (!exists(bundledExecutable)) {
        throw new Error(
          `MEDIALYZE_FFPROBE_DIR does not contain ${executableName}: ${configuredPath}`
        );
      }
      return {
        kind: "directory",
        sourcePath: configuredPath,
        executableName,
      };
    }
    return {
      kind: "file",
      sourcePath: configuredPath,
      executableName,
    };
  }

  const lookupInvocation = commandLookupInvocation(platform);
  const lookupResult = lookup(lookupInvocation.command, lookupInvocation.args);
  if (lookupResult.status !== 0) {
    throw new Error(
      "Unable to locate ffprobe for desktop packaging. Set MEDIALYZE_FFPROBE_DIR or install ffprobe on PATH."
    );
  }

  const detectedExecutable = firstExistingLine(lookupResult.stdout ?? "");
  if (!detectedExecutable || !exists(detectedExecutable)) {
    throw new Error(
      "ffprobe lookup did not return a usable executable path for desktop packaging."
    );
  }

  return {
    kind: "file",
    sourcePath: detectedExecutable,
    executableName,
  };
}

export function resolveBundledFfmpegSource({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  stat = statSync,
  lookup = (command, args) => spawnSync(command, args, { encoding: "utf8" }),
} = {}) {
  const executableName = bundledFfmpegName(platform);
  const configuredPath = env.MEDIALYZE_FFMPEG_DIR?.trim();

  if (configuredPath) {
    if (!exists(configuredPath)) {
      throw new Error(`MEDIALYZE_FFMPEG_DIR does not exist: ${configuredPath}`);
    }
    const configuredStat = stat(configuredPath);
    if (configuredStat.isDirectory()) {
      const bundledExecutable = path.join(configuredPath, executableName);
      if (!exists(bundledExecutable)) {
        throw new Error(`MEDIALYZE_FFMPEG_DIR does not contain ${executableName}: ${configuredPath}`);
      }
      return {
        kind: "directory",
        sourcePath: configuredPath,
        executableName,
      };
    }
    return {
      kind: "file",
      sourcePath: configuredPath,
      executableName,
    };
  }

  const lookupInvocation = platform === "win32"
    ? { command: "where", args: ["ffmpeg"] }
    : { command: "which", args: ["ffmpeg"] };
  const lookupResult = lookup(lookupInvocation.command, lookupInvocation.args);
  if (lookupResult.status !== 0) {
    throw new Error("Unable to locate ffmpeg for desktop packaging. Set MEDIALYZE_FFMPEG_DIR or install ffmpeg on PATH.");
  }

  const detectedExecutable = firstExistingLine(lookupResult.stdout ?? "");
  if (!detectedExecutable || !exists(detectedExecutable)) {
    throw new Error("ffmpeg lookup did not return a usable executable path for desktop packaging.");
  }

  return {
    kind: "file",
    sourcePath: detectedExecutable,
    executableName,
  };
}

export function bundleFfprobe(outputPath, options = {}) {
  const source = resolveBundledFfprobeSource(options);
  const targetDir = path.join(outputPath, "ffprobe");
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  if (source.kind === "directory") {
    cpSync(source.sourcePath, targetDir, { recursive: true });
    return path.join(targetDir, source.executableName);
  }

  const targetExecutable = path.join(targetDir, source.executableName);
  cpSync(source.sourcePath, targetExecutable);
  return targetExecutable;
}

export function bundleFfmpeg(outputPath, options = {}) {
  const source = resolveBundledFfmpegSource(options);
  const targetDir = path.join(outputPath, "ffmpeg");
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  if (source.kind === "directory") {
    cpSync(source.sourcePath, targetDir, { recursive: true });
    return path.join(targetDir, source.executableName);
  }

  const targetExecutable = path.join(targetDir, source.executableName);
  cpSync(source.sourcePath, targetExecutable);
  return targetExecutable;
}

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

export function main() {
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

  bundleFfprobe(outputDir);
  bundleFfmpeg(outputDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}

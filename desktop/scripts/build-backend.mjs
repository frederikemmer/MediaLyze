import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
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

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${
        result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`
      }`
    );
  }

  return result;
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

export function parseOtoolDependencies(stdout) {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^(.+?) \(/)?.[1] ?? null)
    .filter(Boolean);
}

export function parseOtoolRpaths(stdout) {
  const rpaths = [];
  const lines = stdout.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("cmd LC_RPATH")) {
      continue;
    }

    for (let offset = index + 1; offset < lines.length; offset += 1) {
      const match = lines[offset].match(/^\s*path\s+(.+?)\s+\(offset \d+\)$/);
      if (match) {
        rpaths.push(match[1]);
        break;
      }
      if (lines[offset].includes("Load command")) {
        break;
      }
    }
  }

  return rpaths;
}

function defaultInspectMachOBinary(binaryPath) {
  const dependencyResult = runCommand("otool", ["-L", binaryPath]);
  const loadCommandResult = runCommand("otool", ["-l", binaryPath]);
  return {
    dependencies: parseOtoolDependencies(dependencyResult.stdout ?? ""),
    rpaths: parseOtoolRpaths(loadCommandResult.stdout ?? ""),
  };
}

function defaultPatchMachOBinary(targetPath, args) {
  runCommand("install_name_tool", [...args, targetPath]);
}

function defaultSignMachOBinary(targetPath) {
  runCommand("codesign", ["--force", "--sign", "-", targetPath]);
}

function isMacosSystemDependency(candidate) {
  return (
    typeof candidate === "string" &&
    candidate.startsWith("/") &&
    (candidate.startsWith("/System/Library/") || candidate.startsWith("/usr/lib/"))
  );
}

function expandMachOPathToken(candidate, binaryPath, executablePath) {
  if (candidate === "@loader_path") {
    return path.dirname(binaryPath);
  }
  if (candidate.startsWith("@loader_path/")) {
    return path.resolve(path.dirname(binaryPath), candidate.slice("@loader_path/".length));
  }
  if (candidate === "@executable_path") {
    return path.dirname(executablePath);
  }
  if (candidate.startsWith("@executable_path/")) {
    return path.resolve(
      path.dirname(executablePath),
      candidate.slice("@executable_path/".length)
    );
  }
  return null;
}

function resolveMachODependencyPath(
  dependency,
  binaryPath,
  executablePath,
  rpaths,
  exists
) {
  if (typeof dependency !== "string" || !dependency) {
    return null;
  }

  if (dependency.startsWith("/")) {
    return isMacosSystemDependency(dependency) ? null : dependency;
  }

  const expandedTokenPath = expandMachOPathToken(
    dependency,
    binaryPath,
    executablePath
  );
  if (expandedTokenPath) {
    return exists(expandedTokenPath) ? expandedTokenPath : null;
  }

  if (!dependency.startsWith("@rpath/")) {
    return null;
  }

  const rpathSuffix = dependency.slice("@rpath/".length);
  for (const rpath of rpaths) {
    const expandedRpath =
      expandMachOPathToken(rpath, binaryPath, executablePath) ??
      (rpath.startsWith("/") ? rpath : null);
    if (!expandedRpath) {
      continue;
    }

    const resolvedCandidate = path.resolve(expandedRpath, rpathSuffix);
    if (exists(resolvedCandidate)) {
      return resolvedCandidate;
    }
  }

  return null;
}

export function bundleMacosFfprobeDependencies(
  bundleDir,
  executablePath,
  {
    copy = cpSync,
    exists = existsSync,
    inspectBinary = defaultInspectMachOBinary,
    mkdir = mkdirSync,
    patchBinary = defaultPatchMachOBinary,
    realpath = realpathSync,
    signBinary = defaultSignMachOBinary,
    sourceExecutablePath = executablePath,
  } = {}
) {
  const libDir = path.join(bundleDir, "lib");
  const pendingBinaries = [
    {
      bundledPath: executablePath,
      sourcePath: sourceExecutablePath,
    },
  ];
  const inspected = new Set();
  const copiedLibraries = new Map();
  const binaryDependencies = new Map();

  while (pendingBinaries.length > 0) {
    const { bundledPath, sourcePath } = pendingBinaries.pop();
    if (inspected.has(bundledPath)) {
      continue;
    }
    inspected.add(bundledPath);

    const inspection = inspectBinary(sourcePath);
    binaryDependencies.set(bundledPath, {
      ...inspection,
      sourcePath,
    });

    for (const dependency of inspection.dependencies) {
      const resolvedDependency = resolveMachODependencyPath(
        dependency,
        sourcePath,
        sourceExecutablePath,
        inspection.rpaths,
        exists
      );
      if (!resolvedDependency) {
        continue;
      }

      const realDependency = realpath(resolvedDependency);
      let bundledDependency = copiedLibraries.get(realDependency);

      if (!bundledDependency) {
        mkdir(libDir, { recursive: true });
        bundledDependency = path.join(libDir, path.basename(realDependency));
        copy(realDependency, bundledDependency);
        copiedLibraries.set(realDependency, bundledDependency);
        pendingBinaries.push({
          bundledPath: bundledDependency,
          sourcePath: realDependency,
        });
      }
    }
  }

  for (const bundledDependency of copiedLibraries.values()) {
    if (!exists(bundledDependency)) {
      throw new Error(
        `Bundled ffprobe dependency missing after copy: ${bundledDependency}`
      );
    }
    patchBinary(bundledDependency, [
      "-id",
      `@loader_path/${path.basename(bundledDependency)}`,
    ]);
  }

  for (const [binaryPath, inspection] of binaryDependencies.entries()) {
    for (const dependency of inspection.dependencies) {
      const resolvedDependency = resolveMachODependencyPath(
        dependency,
        inspection.sourcePath,
        sourceExecutablePath,
        inspection.rpaths,
        exists
      );
      if (!resolvedDependency) {
        continue;
      }

      const bundledDependency = copiedLibraries.get(realpath(resolvedDependency));
      if (!bundledDependency) {
        throw new Error(`Unable to rewrite bundled dependency: ${dependency}`);
      }

      const rewrittenDependency =
        binaryPath === executablePath
          ? `@executable_path/lib/${path.basename(bundledDependency)}`
          : `@loader_path/${path.basename(bundledDependency)}`;

      patchBinary(binaryPath, ["-change", dependency, rewrittenDependency]);
    }
  }

  for (const bundledDependency of copiedLibraries.values()) {
    signBinary(bundledDependency);
  }
  signBinary(executablePath);
}

export function bundleFfprobe(outputPath, options = {}) {
  const source = resolveBundledFfprobeSource(options);
  const targetDir = path.join(outputPath, "ffprobe");
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  if (source.kind === "directory") {
    cpSync(source.sourcePath, targetDir, { recursive: true });
    const bundledExecutable = path.join(targetDir, source.executableName);
    if ((options.platform ?? process.platform) === "darwin") {
      bundleMacosFfprobeDependencies(targetDir, bundledExecutable, {
        ...options,
        sourceExecutablePath: path.join(source.sourcePath, source.executableName),
      });
    }
    return bundledExecutable;
  }

  const targetExecutable = path.join(targetDir, source.executableName);
  const sourceExecutable = options.realpath
    ? options.realpath(source.sourcePath)
    : realpathSync(source.sourcePath);
  cpSync(
    sourceExecutable,
    targetExecutable
  );
  if ((options.platform ?? process.platform) === "darwin") {
    bundleMacosFfprobeDependencies(targetDir, targetExecutable, {
      ...options,
      sourceExecutablePath: sourceExecutable,
    });
  }
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}

const path = require("node:path");
const { existsSync } = require("node:fs");

function bundledFfprobeName(platform = process.platform) {
  return platform === "win32" ? "ffprobe.exe" : "ffprobe";
}

function bundledFfprobeLauncherName(platform = process.platform) {
  return platform === "linux" ? "ffprobe-medialyze" : bundledFfprobeName(platform);
}

function normalizeEnvPath(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function packagedFfprobeCandidates(resourcesPath, platform = process.platform) {
  const executableName = bundledFfprobeName(platform);
  const launcherName = bundledFfprobeLauncherName(platform);
  const names = launcherName === executableName ? [executableName] : [launcherName, executableName];
  return [
    ...names.map((name) => path.join(resourcesPath, "backend", "ffprobe", name)),
    ...names.map((name) => path.join(resourcesPath, "backend", "ffprobe", "bin", name)),
    ...names.map((name) => path.join(resourcesPath, "ffprobe", name)),
    ...names.map((name) => path.join(resourcesPath, "ffprobe", "bin", name)),
  ];
}

function packagedFfprobeLibraryCandidates(resourcesPath) {
  return [
    path.join(resourcesPath, "backend", "ffprobe", "lib"),
    path.join(resourcesPath, "ffprobe", "lib"),
  ];
}

function resolveFfprobeLibraryPath({
  isPackaged,
  resourcesPath,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (!isPackaged || platform !== "linux" || !resourcesPath) {
    return null;
  }

  for (const candidate of packagedFfprobeLibraryCandidates(resourcesPath)) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function prependLibraryPath(libraryPath, existingValue) {
  if (!libraryPath) {
    return existingValue;
  }
  return [libraryPath, existingValue].filter(Boolean).join(":");
}

function isPackagedFfprobePath(candidate, resourcesPath, platform = process.platform) {
  if (!candidate || !resourcesPath) {
    return false;
  }
  return packagedFfprobeCandidates(resourcesPath, platform).includes(candidate);
}

function resolveFfprobePath({
  isPackaged,
  resourcesPath,
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  const explicitOverride = normalizeEnvPath(env.FFPROBE_PATH);
  if (explicitOverride && (!isPackaged || exists(explicitOverride))) {
    return explicitOverride;
  }

  if (isPackaged && resourcesPath) {
    for (const candidate of packagedFfprobeCandidates(resourcesPath, platform)) {
      if (exists(candidate)) {
        return candidate;
      }
    }
  }

  if (explicitOverride) {
    return explicitOverride;
  }

  return "ffprobe";
}

function resolveFfprobeEnvironment({
  isPackaged,
  resourcesPath,
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  const ffprobePath = resolveFfprobePath({
    isPackaged,
    resourcesPath,
    env,
    platform,
    exists,
  });
  const resolvedEnv = {
    FFPROBE_PATH: ffprobePath,
  };

  if (isPackagedFfprobePath(ffprobePath, resourcesPath, platform)) {
    const libraryPath = resolveFfprobeLibraryPath({
      isPackaged,
      resourcesPath,
      platform,
      exists,
    });
    const ldLibraryPath = prependLibraryPath(libraryPath, env.LD_LIBRARY_PATH);
    if (ldLibraryPath) {
      resolvedEnv.LD_LIBRARY_PATH = ldLibraryPath;
    }
  }

  return resolvedEnv;
}

module.exports = {
  bundledFfprobeLauncherName,
  bundledFfprobeName,
  isPackagedFfprobePath,
  packagedFfprobeLibraryCandidates,
  packagedFfprobeCandidates,
  prependLibraryPath,
  resolveFfprobeEnvironment,
  resolveFfprobeLibraryPath,
  resolveFfprobePath,
};

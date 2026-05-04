const path = require("node:path");
const { existsSync } = require("node:fs");

function bundledFfprobeName(platform = process.platform) {
  return platform === "win32" ? "ffprobe.exe" : "ffprobe";
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
  return [
    path.join(resourcesPath, "backend", "ffprobe", executableName),
    path.join(resourcesPath, "backend", "ffprobe", "bin", executableName),
    path.join(resourcesPath, "ffprobe", executableName),
    path.join(resourcesPath, "ffprobe", "bin", executableName),
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

module.exports = {
  bundledFfprobeName,
  packagedFfprobeLibraryCandidates,
  packagedFfprobeCandidates,
  prependLibraryPath,
  resolveFfprobeLibraryPath,
  resolveFfprobePath,
};

const path = require("node:path");
const { existsSync } = require("node:fs");

function bundledFfmpegName(platform = process.platform) {
  return platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function normalizeEnvPath(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function packagedFfmpegCandidates(resourcesPath, platform = process.platform) {
  const executableName = bundledFfmpegName(platform);
  return [
    path.join(resourcesPath, "backend", "ffmpeg", executableName),
    path.join(resourcesPath, "backend", "ffmpeg", "bin", executableName),
    path.join(resourcesPath, "ffmpeg", executableName),
    path.join(resourcesPath, "ffmpeg", "bin", executableName),
  ];
}

function resolveFfmpegPath({
  isPackaged,
  resourcesPath,
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  const explicitOverride = normalizeEnvPath(env.FFMPEG_PATH);
  if (explicitOverride && (!isPackaged || exists(explicitOverride))) {
    return explicitOverride;
  }

  if (isPackaged && resourcesPath) {
    for (const candidate of packagedFfmpegCandidates(resourcesPath, platform)) {
      if (exists(candidate)) {
        return candidate;
      }
    }
  }

  if (explicitOverride) {
    return explicitOverride;
  }

  return "ffmpeg";
}

module.exports = {
  bundledFfmpegName,
  packagedFfmpegCandidates,
  resolveFfmpegPath,
};

const path = require("node:path");
const { existsSync } = require("node:fs");

function bundledToolName(toolName, platform = process.platform) {
  return platform === "win32" ? `${toolName}.exe` : toolName;
}

function bundledFfprobeName(platform = process.platform) {
  return bundledToolName("ffprobe", platform);
}

function bundledFfmpegName(platform = process.platform) {
  return bundledToolName("ffmpeg", platform);
}

function normalizeEnvPath(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function packagedToolCandidates(toolName, resourcesPath, platform = process.platform) {
  const executableName = bundledToolName(toolName, platform);
  return [
    path.join(resourcesPath, "backend", toolName, executableName),
    path.join(resourcesPath, "backend", toolName, "bin", executableName),
    path.join(resourcesPath, toolName, executableName),
    path.join(resourcesPath, toolName, "bin", executableName),
  ];
}

function packagedFfprobeCandidates(resourcesPath, platform = process.platform) {
  return packagedToolCandidates("ffprobe", resourcesPath, platform);
}

function packagedFfmpegCandidates(resourcesPath, platform = process.platform) {
  return packagedToolCandidates("ffmpeg", resourcesPath, platform);
}

function resolveToolPath({
  toolName,
  envName,
  isPackaged,
  resourcesPath,
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  const explicitOverride = normalizeEnvPath(env[envName]);
  if (explicitOverride && (!isPackaged || exists(explicitOverride))) {
    return explicitOverride;
  }

  if (isPackaged && resourcesPath) {
    for (const candidate of packagedToolCandidates(toolName, resourcesPath, platform)) {
      if (exists(candidate)) {
        return candidate;
      }
    }
  }

  if (explicitOverride) {
    return explicitOverride;
  }

  return toolName;
}

function resolveFfprobePath(options = {}) {
  return resolveToolPath({
    ...options,
    toolName: "ffprobe",
    envName: "FFPROBE_PATH",
  });
}

function resolveFfmpegPath(options = {}) {
  return resolveToolPath({
    ...options,
    toolName: "ffmpeg",
    envName: "FFMPEG_PATH",
  });
}

module.exports = {
  bundledFfmpegName,
  bundledFfprobeName,
  packagedFfmpegCandidates,
  packagedFfprobeCandidates,
  resolveFfmpegPath,
  resolveFfprobePath,
};

const path = require("node:path");

const GITHUB_LATEST_DOWNLOAD_BASE = "https://github.com/frederikemmer/MediaLyze/releases/latest/download";
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const PLATFORM_ASSETS = {
  darwin: "MediaLyze-arm64.dmg",
  win32: "MediaLyze.Setup.exe",
  linux: "MediaLyze.AppImage",
};

function installerAssetForPlatform(platform) {
  return PLATFORM_ASSETS[platform] ?? null;
}

function isAllowedInstallerDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.host !== "github.com") {
    return false;
  }
  const assetNames = new Set(Object.values(PLATFORM_ASSETS));
  return (
    parsed.pathname.startsWith("/frederikemmer/MediaLyze/releases/latest/download/") &&
    assetNames.has(path.posix.basename(parsed.pathname))
  );
}

function buildLatestInstallerDownload(platform, version) {
  const assetName = installerAssetForPlatform(platform);
  if (!assetName || !STABLE_VERSION_PATTERN.test(version)) {
    return null;
  }
  const url = `${GITHUB_LATEST_DOWNLOAD_BASE}/${assetName}`;
  if (!isAllowedInstallerDownloadUrl(url)) {
    return null;
  }
  const extension = assetName === "MediaLyze-arm64.dmg"
    ? "-arm64.dmg"
    : assetName === "MediaLyze.Setup.exe"
      ? ".Setup.exe"
      : ".AppImage";
  return {
    assetName,
    url,
    filename: `MediaLyze-v${version}${extension}`,
  };
}

module.exports = {
  buildLatestInstallerDownload,
  installerAssetForPlatform,
  isAllowedInstallerDownloadUrl,
};

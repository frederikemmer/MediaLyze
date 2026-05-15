const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLatestInstallerDownload,
  installerAssetForPlatform,
  isAllowedInstallerDownloadUrl,
} = require("./update-download.cjs");

test("installer assets are mapped per desktop platform", () => {
  assert.equal(installerAssetForPlatform("darwin"), "MediaLyze-arm64.dmg");
  assert.equal(installerAssetForPlatform("win32"), "MediaLyze.Setup.exe");
  assert.equal(installerAssetForPlatform("linux"), "MediaLyze.AppImage");
  assert.equal(installerAssetForPlatform("freebsd"), null);
});

test("installer URLs only allow expected HTTPS latest-release assets", () => {
  assert.equal(
    isAllowedInstallerDownloadUrl(
      "https://github.com/frederikemmer/MediaLyze/releases/latest/download/MediaLyze.AppImage"
    ),
    true
  );
  assert.equal(isAllowedInstallerDownloadUrl("http://github.com/frederikemmer/MediaLyze/releases/latest/download/MediaLyze.AppImage"), false);
  assert.equal(isAllowedInstallerDownloadUrl("https://example.test/frederikemmer/MediaLyze/releases/latest/download/MediaLyze.AppImage"), false);
  assert.equal(isAllowedInstallerDownloadUrl("https://github.com/frederikemmer/MediaLyze/releases/latest/download/evil.exe"), false);
});

test("download descriptors use stable URLs and versioned local filenames", () => {
  assert.deepEqual(buildLatestInstallerDownload("darwin", "0.12.0"), {
    assetName: "MediaLyze-arm64.dmg",
    url: "https://github.com/frederikemmer/MediaLyze/releases/latest/download/MediaLyze-arm64.dmg",
    filename: "MediaLyze-v0.12.0-arm64.dmg",
  });
  assert.equal(buildLatestInstallerDownload("linux", "0.12.0-beta.1"), null);
});

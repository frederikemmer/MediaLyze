const test = require("node:test");
const assert = require("node:assert/strict");

const {
  packagedFfmpegCandidates,
  resolveFfmpegPath,
} = require("./ffmpeg-paths.cjs");

test("resolveFfmpegPath prefers an explicit existing override in packaged mode", () => {
  const resolved = resolveFfmpegPath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    env: { FFMPEG_PATH: "/custom/ffmpeg" },
    exists: (candidate) => candidate === "/custom/ffmpeg",
  });

  assert.equal(resolved, "/custom/ffmpeg");
});

test("resolveFfmpegPath falls back to bundled packaged candidates", () => {
  const candidates = packagedFfmpegCandidates("/app/resources", "win32");
  const resolved = resolveFfmpegPath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "win32",
    env: {},
    exists: (candidate) => candidate === candidates[1],
  });

  assert.equal(resolved, candidates[1]);
});

test("resolveFfmpegPath keeps an explicit override when packaged candidates are missing", () => {
  const resolved = resolveFfmpegPath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    env: { FFMPEG_PATH: "/missing/ffmpeg" },
    exists: () => false,
  });

  assert.equal(resolved, "/missing/ffmpeg");
});

test("resolveFfmpegPath defaults to PATH lookup in development", () => {
  const resolved = resolveFfmpegPath({
    isPackaged: false,
    env: {},
    exists: () => false,
  });

  assert.equal(resolved, "ffmpeg");
});

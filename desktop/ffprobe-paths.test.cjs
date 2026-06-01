const test = require("node:test");
const assert = require("node:assert/strict");

const {
  packagedFfmpegCandidates,
  packagedFfprobeCandidates,
  resolveFfmpegPath,
  resolveFfprobePath,
} = require("./ffprobe-paths.cjs");

test("resolveFfprobePath prefers an explicit existing override in packaged mode", () => {
  const resolved = resolveFfprobePath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    env: { FFPROBE_PATH: "/custom/ffprobe" },
    exists: (candidate) => candidate === "/custom/ffprobe",
  });

  assert.equal(resolved, "/custom/ffprobe");
});

test("resolveFfprobePath falls back to bundled packaged candidates", () => {
  const candidates = packagedFfprobeCandidates("/app/resources", "linux");
  const resolved = resolveFfprobePath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "linux",
    env: {},
    exists: (candidate) => candidate === candidates[0],
  });

  assert.equal(resolved, candidates[0]);
});

test("resolveFfprobePath keeps an explicit override when packaged candidates are missing", () => {
  const resolved = resolveFfprobePath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    env: { FFPROBE_PATH: "/missing/ffprobe" },
    exists: () => false,
  });

  assert.equal(resolved, "/missing/ffprobe");
});

test("resolveFfprobePath defaults to PATH lookup in development", () => {
  const resolved = resolveFfprobePath({
    isPackaged: false,
    env: {},
    exists: () => false,
  });

  assert.equal(resolved, "ffprobe");
});

test("resolveFfmpegPath falls back to bundled packaged candidates", () => {
  const candidates = packagedFfmpegCandidates("/app/resources", "linux");
  const resolved = resolveFfmpegPath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "linux",
    env: {},
    exists: (candidate) => candidate === candidates[0],
  });

  assert.equal(resolved, candidates[0]);
});

test("resolveFfmpegPath defaults to PATH lookup in development", () => {
  const resolved = resolveFfmpegPath({
    isPackaged: false,
    env: {},
    exists: () => false,
  });

  assert.equal(resolved, "ffmpeg");
});

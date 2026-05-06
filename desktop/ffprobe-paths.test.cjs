const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bundledFfprobeLauncherName,
  isPackagedFfprobePath,
  packagedFfprobeLibraryCandidates,
  packagedFfprobeCandidates,
  prependLibraryPath,
  resolveFfprobeEnvironment,
  resolveFfprobeLibraryPath,
  resolveFfprobePath,
} = require("./ffprobe-paths.cjs");

test("bundledFfprobeLauncherName uses a Linux wrapper", () => {
  assert.equal(bundledFfprobeLauncherName("linux"), "ffprobe-medialyze");
  assert.equal(bundledFfprobeLauncherName("darwin"), "ffprobe");
  assert.equal(bundledFfprobeLauncherName("win32"), "ffprobe.exe");
});

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

test("resolveFfprobeLibraryPath returns packaged Linux ffprobe lib directory", () => {
  const candidates = packagedFfprobeLibraryCandidates("/app/resources");
  const resolved = resolveFfprobeLibraryPath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "linux",
    exists: (candidate) => candidate === candidates[0],
  });

  assert.equal(resolved, candidates[0]);
});

test("resolveFfprobeLibraryPath is disabled outside packaged Linux builds", () => {
  const resolved = resolveFfprobeLibraryPath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "darwin",
    exists: () => true,
  });

  assert.equal(resolved, null);
});

test("prependLibraryPath prepends bundled library directory without dropping existing paths", () => {
  assert.equal(
    prependLibraryPath("/app/resources/backend/ffprobe/lib", "/usr/local/lib"),
    "/app/resources/backend/ffprobe/lib:/usr/local/lib"
  );
});

test("prependLibraryPath leaves existing value alone when no bundled library path exists", () => {
  assert.equal(prependLibraryPath(null, "/usr/local/lib"), "/usr/local/lib");
});

test("isPackagedFfprobePath detects bundled candidates only", () => {
  const candidates = packagedFfprobeCandidates("/app/resources", "linux");

  assert.equal(
    isPackagedFfprobePath(candidates[0], "/app/resources", "linux"),
    true
  );
  assert.equal(
    isPackagedFfprobePath("/usr/local/bin/ffprobe", "/app/resources", "linux"),
    false
  );
});

test("resolveFfprobeEnvironment honors system override without bundled libraries", () => {
  const resolved = resolveFfprobeEnvironment({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "linux",
    env: {
      FFPROBE_PATH: "/usr/local/bin/ffprobe",
      LD_LIBRARY_PATH: "/usr/local/lib",
    },
    exists: (candidate) =>
      candidate === "/usr/local/bin/ffprobe" ||
      candidate === "/app/resources/backend/ffprobe/lib",
  });

  assert.deepEqual(resolved, {
    FFPROBE_PATH: "/usr/local/bin/ffprobe",
  });
});

test("resolveFfprobeEnvironment adds bundled libraries for bundled Linux ffprobe", () => {
  const ffprobeCandidates = packagedFfprobeCandidates("/app/resources", "linux");
  const libraryCandidates = packagedFfprobeLibraryCandidates("/app/resources");
  const resolved = resolveFfprobeEnvironment({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "linux",
    env: {
      LD_LIBRARY_PATH: "/usr/local/lib",
    },
    exists: (candidate) =>
      candidate === ffprobeCandidates[0] || candidate === libraryCandidates[0],
  });

  assert.deepEqual(resolved, {
    FFPROBE_PATH: ffprobeCandidates[0],
    LD_LIBRARY_PATH: `${libraryCandidates[0]}:/usr/local/lib`,
  });
});

test("resolveFfprobeEnvironment falls back to bundled binary when wrapper is missing", () => {
  const ffprobeCandidates = packagedFfprobeCandidates("/app/resources", "linux");
  const libraryCandidates = packagedFfprobeLibraryCandidates("/app/resources");
  const resolved = resolveFfprobeEnvironment({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "linux",
    env: {},
    exists: (candidate) =>
      candidate === ffprobeCandidates[1] || candidate === libraryCandidates[0],
  });

  assert.deepEqual(resolved, {
    FFPROBE_PATH: ffprobeCandidates[1],
    LD_LIBRARY_PATH: libraryCandidates[0],
  });
});

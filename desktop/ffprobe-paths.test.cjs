const test = require("node:test");
const assert = require("node:assert/strict");

const {
  packagedFfprobeLibraryCandidates,
  packagedFfprobeCandidates,
  prependLibraryPath,
  resolveFfprobeLibraryPath,
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
  const candidates = packagedFfprobeCandidates("/app/resources", "win32");
  const resolved = resolveFfprobePath({
    isPackaged: true,
    resourcesPath: "/app/resources",
    platform: "win32",
    env: {},
    exists: (candidate) => candidate === candidates[1],
  });

  assert.equal(resolved, candidates[1]);
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

const test = require("node:test");
const assert = require("node:assert/strict");

const packageJson = require("./package.json");

test("desktop package includes ffmpeg and ffprobe path helpers", () => {
  assert.ok(packageJson.build);
  assert.ok(Array.isArray(packageJson.build.files));
  assert.ok(packageJson.build.files.includes("ffprobe-paths.cjs"));
  assert.ok(packageJson.build.files.includes("ffmpeg-paths.cjs"));
});

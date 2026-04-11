const test = require("node:test");
const assert = require("node:assert/strict");
const packageJson = require("./package.json");

test("desktop packaged app includes all runtime CommonJS entry files", () => {
  const packagedFiles = packageJson.build?.files;

  assert.ok(Array.isArray(packagedFiles), "build.files must be configured");
  assert.deepEqual(
    packagedFiles,
    expectEntries(packagedFiles, ["main.cjs", "preload.cjs", "ffprobe-paths.cjs"])
  );
});

function expectEntries(actualEntries, requiredEntries) {
  for (const entry of requiredEntries) {
    assert.equal(
      actualEntries.includes(entry),
      true,
      `Expected desktop build.files to include ${entry}`
    );
  }
  return actualEntries;
}

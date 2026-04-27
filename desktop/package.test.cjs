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

test("desktop packaging uses stable release artifact names", () => {
  assert.equal(
    packageJson.build?.mac?.artifactName,
    "${productName}-arm64.${ext}",
    "Expected macOS desktop artifact name to stay stable"
  );
  assert.equal(
    packageJson.build?.linux?.artifactName,
    "${productName}.${ext}",
    "Expected Linux desktop artifact name to stay stable"
  );
  assert.equal(
    packageJson.build?.win?.artifactName,
    "${productName}.Setup.${ext}",
    "Expected Windows desktop artifact name to stay stable"
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

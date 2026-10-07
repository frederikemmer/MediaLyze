import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { resolveBackendPaths } from "./smoke-test-backend.mjs";

test("packaged backend smoke test resolves paths from the repository root", () => {
  const fixtureRoot = path.join(process.cwd(), "smoke-test-path-fixture");
  const scriptPath = path.join(
    fixtureRoot,
    "desktop",
    "scripts",
    "smoke-test-backend.mjs"
  );

  assert.deepEqual(resolveBackendPaths(scriptPath), {
    repoRoot: fixtureRoot,
    backendPath: path.join(
      fixtureRoot,
      "dist",
      "desktop-backend",
      "medialyze-backend",
      "medialyze-backend.exe"
    ),
  });
});

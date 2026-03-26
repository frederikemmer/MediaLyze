import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bundleFfprobe,
  bundledFfprobeName,
  resolveBundledFfprobeSource,
} from "./build-backend.mjs";

function withTempDir(fn) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "medialyze-build-backend-"));
  try {
    return fn(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test("resolveBundledFfprobeSource accepts a configured directory", () => {
  withTempDir((tempDir) => {
    const ffprobeDir = path.join(tempDir, "ffprobe-bundle");
    mkdirSync(ffprobeDir, { recursive: true });
    writeFileSync(path.join(ffprobeDir, "ffprobe"), "binary");

    const resolved = resolveBundledFfprobeSource({
      env: { MEDIALYZE_FFPROBE_DIR: ffprobeDir },
      platform: "linux",
    });

    assert.deepEqual(resolved, {
      kind: "directory",
      sourcePath: ffprobeDir,
      executableName: "ffprobe",
    });
  });
});

test("resolveBundledFfprobeSource falls back to a PATH lookup", () => {
  const resolved = resolveBundledFfprobeSource({
    env: {},
    platform: "win32",
    exists: (candidate) => candidate === "C:\\ffmpeg\\bin\\ffprobe.exe",
    stat: () => {
      throw new Error("stat should not be used when no explicit directory is configured");
    },
    lookup: () => ({
      status: 0,
      stdout: "C:\\ffmpeg\\bin\\ffprobe.exe\r\n",
    }),
  });

  assert.deepEqual(resolved, {
    kind: "file",
    sourcePath: "C:\\ffmpeg\\bin\\ffprobe.exe",
    executableName: "ffprobe.exe",
  });
});

test("bundleFfprobe creates the expected ffprobe folder structure", () => {
  withTempDir((tempDir) => {
    const sourceBinary = path.join(tempDir, "ffprobe.exe");
    const outputDir = path.join(tempDir, "desktop-backend");
    writeFileSync(sourceBinary, "ffprobe-binary");
    mkdirSync(outputDir, { recursive: true });

    const bundledExecutable = bundleFfprobe(outputDir, {
      env: { MEDIALYZE_FFPROBE_DIR: sourceBinary },
      platform: "win32",
    });

    assert.equal(
      bundledExecutable,
      path.join(outputDir, "ffprobe", bundledFfprobeName("win32"))
    );
    assert.equal(existsSync(bundledExecutable), true);
    assert.equal(readFileSync(bundledExecutable, "utf8"), "ffprobe-binary");
  });
});

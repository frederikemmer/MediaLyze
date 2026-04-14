import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bundleMacosFfprobeDependencies,
  bundleFfprobe,
  bundledFfprobeName,
  parseOtoolDependencies,
  parseOtoolRpaths,
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

test("parseOtoolDependencies extracts linked library paths", () => {
  const dependencies = parseOtoolDependencies(`/tmp/ffprobe:
\t/opt/homebrew/Cellar/ffmpeg/8.1/lib/libavdevice.62.dylib (compatibility version 62.0.0, current version 62.3.100)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
`);

  assert.deepEqual(dependencies, [
    "/opt/homebrew/Cellar/ffmpeg/8.1/lib/libavdevice.62.dylib",
    "/usr/lib/libSystem.B.dylib",
  ]);
});

test("parseOtoolRpaths extracts LC_RPATH values", () => {
  const rpaths = parseOtoolRpaths(`example:
Load command 11
          cmd LC_RPATH
      cmdsize 32
         path @loader_path/../lib (offset 12)
Load command 12
          cmd LC_RPATH
      cmdsize 40
         path /opt/homebrew/lib (offset 12)
`);

  assert.deepEqual(rpaths, ["@loader_path/../lib", "/opt/homebrew/lib"]);
});

test("bundleMacosFfprobeDependencies copies and rewrites non-system dylibs", () => {
  withTempDir((tempDir) => {
    const bundleDir = path.join(tempDir, "ffprobe");
    const libDir = path.join(bundleDir, "lib");
    const executablePath = path.join(bundleDir, "ffprobe");
    const sourceLibDirPath = path.join(tempDir, "homebrew");

    mkdirSync(bundleDir, { recursive: true });
    mkdirSync(sourceLibDirPath, { recursive: true });
    const sourceLibDir = realpathSync(sourceLibDirPath);
    const avdevicePath = path.join(sourceLibDir, "libavdevice.62.dylib");
    const avutilPath = path.join(sourceLibDir, "libavutil.60.dylib");
    const sharpyuvPath = path.join(sourceLibDir, "libsharpyuv.0.dylib");
    writeFileSync(executablePath, "ffprobe");
    writeFileSync(avdevicePath, "avdevice");
    writeFileSync(avutilPath, "avutil");
    writeFileSync(sharpyuvPath, "sharpyuv");

    const patched = [];
    const signed = [];

    bundleMacosFfprobeDependencies(bundleDir, executablePath, {
      sourceExecutablePath: executablePath,
      inspectBinary: (candidate) => {
        if (candidate === executablePath) {
          return {
            dependencies: [avdevicePath, "/usr/lib/libSystem.B.dylib"],
            rpaths: [],
          };
        }
        if (candidate.endsWith("/libavdevice.62.dylib")) {
          return {
            dependencies: [avutilPath],
            rpaths: [],
          };
        }
        if (candidate.endsWith("/libavutil.60.dylib")) {
          return {
            dependencies: ["@rpath/libsharpyuv.0.dylib"],
            rpaths: ["@loader_path"],
          };
        }
        if (candidate.endsWith("/libsharpyuv.0.dylib")) {
          return {
            dependencies: [],
            rpaths: [],
          };
        }
        throw new Error(`Unexpected inspect target: ${candidate}`);
      },
      patchBinary: (targetPath, args) => {
        patched.push([targetPath, ...args]);
      },
      signBinary: (targetPath) => {
        signed.push(targetPath);
      },
    });

    assert.equal(
      readFileSync(path.join(libDir, "libavdevice.62.dylib"), "utf8"),
      "avdevice"
    );
    assert.equal(
      readFileSync(path.join(libDir, "libavutil.60.dylib"), "utf8"),
      "avutil"
    );
    assert.equal(
      readFileSync(path.join(libDir, "libsharpyuv.0.dylib"), "utf8"),
      "sharpyuv"
    );
    assert.deepEqual(patched, [
      [
        path.join(libDir, "libavdevice.62.dylib"),
        "-id",
        "@loader_path/libavdevice.62.dylib",
      ],
      [
        path.join(libDir, "libavutil.60.dylib"),
        "-id",
        "@loader_path/libavutil.60.dylib",
      ],
      [
        path.join(libDir, "libsharpyuv.0.dylib"),
        "-id",
        "@loader_path/libsharpyuv.0.dylib",
      ],
      [
        executablePath,
        "-change",
        avdevicePath,
        "@executable_path/lib/libavdevice.62.dylib",
      ],
      [
        path.join(libDir, "libavdevice.62.dylib"),
        "-change",
        avutilPath,
        "@loader_path/libavutil.60.dylib",
      ],
      [
        path.join(libDir, "libavutil.60.dylib"),
        "-change",
        "@rpath/libsharpyuv.0.dylib",
        "@loader_path/libsharpyuv.0.dylib",
      ],
    ]);
    assert.deepEqual(signed, [
      path.join(libDir, "libavdevice.62.dylib"),
      path.join(libDir, "libavutil.60.dylib"),
      path.join(libDir, "libsharpyuv.0.dylib"),
      executablePath,
    ]);
  });
});

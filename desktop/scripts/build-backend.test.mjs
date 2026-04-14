import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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

test(
  "bundleMacosFfprobeDependencies copies and rewrites non-system dylibs",
  () => {
    const pathLib = path.posix;
    const bundleDir = "/bundle/ffprobe";
    const libDir = pathLib.join(bundleDir, "lib");
    const executablePath = pathLib.join(bundleDir, "ffprobe");
    const sourceExecutablePath = "/source/ffprobe";
    const sourceLibDir = "/source/lib";
    const avdevicePath = pathLib.join(sourceLibDir, "libavdevice.62.dylib");
    const avutilPath = pathLib.join(sourceLibDir, "libavutil.60.dylib");
    const sharpyuvPath = pathLib.join(sourceLibDir, "libsharpyuv.0.dylib");

    const directories = new Set([bundleDir, sourceLibDir]);
    const files = new Map([
      [executablePath, "ffprobe-binary"],
      [sourceExecutablePath, "ffprobe-source"],
      [avdevicePath, "avdevice"],
      [avutilPath, "avutil"],
      [sharpyuvPath, "sharpyuv"],
    ]);
    const patched = [];
    const signed = [];

    bundleMacosFfprobeDependencies(bundleDir, executablePath, {
      sourceExecutablePath,
      pathLib,
      copy: (sourcePath, targetPath) => {
        files.set(targetPath, files.get(sourcePath) ?? "");
      },
      exists: (candidate) => files.has(candidate) || directories.has(candidate),
      inspectBinary: (candidate) => {
        if (candidate === sourceExecutablePath) {
          return {
            dependencies: [avdevicePath, "/usr/lib/libSystem.B.dylib"],
            rpaths: [],
          };
        }
        if (candidate === avdevicePath) {
          return {
            dependencies: [avutilPath],
            rpaths: [],
          };
        }
        if (candidate === avutilPath) {
          return {
            dependencies: ["@rpath/libsharpyuv.0.dylib"],
            rpaths: ["@loader_path"],
          };
        }
        if (candidate === sharpyuvPath) {
          return {
            dependencies: [],
            rpaths: [],
          };
        }
        throw new Error(`Unexpected inspect target: ${candidate}`);
      },
      mkdir: (directoryPath) => {
        directories.add(directoryPath);
      },
      patchBinary: (targetPath, args) => {
        patched.push([targetPath, ...args]);
      },
      realpath: (candidate) => candidate,
      signBinary: (targetPath) => {
        signed.push(targetPath);
      },
    });

    assert.equal(files.get(pathLib.join(libDir, "libavdevice.62.dylib")), "avdevice");
    assert.equal(files.get(pathLib.join(libDir, "libavutil.60.dylib")), "avutil");
    assert.equal(files.get(pathLib.join(libDir, "libsharpyuv.0.dylib")), "sharpyuv");
    assert.deepEqual(patched, [
      [
        pathLib.join(libDir, "libavdevice.62.dylib"),
        "-id",
        "@loader_path/libavdevice.62.dylib",
      ],
      [
        pathLib.join(libDir, "libavutil.60.dylib"),
        "-id",
        "@loader_path/libavutil.60.dylib",
      ],
      [
        pathLib.join(libDir, "libsharpyuv.0.dylib"),
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
        pathLib.join(libDir, "libavdevice.62.dylib"),
        "-change",
        avutilPath,
        "@loader_path/libavutil.60.dylib",
      ],
      [
        pathLib.join(libDir, "libavutil.60.dylib"),
        "-change",
        "@rpath/libsharpyuv.0.dylib",
        "@loader_path/libsharpyuv.0.dylib",
      ],
    ]);
    assert.deepEqual(signed, [
      pathLib.join(libDir, "libavdevice.62.dylib"),
      pathLib.join(libDir, "libavutil.60.dylib"),
      pathLib.join(libDir, "libsharpyuv.0.dylib"),
      executablePath,
    ]);
  }
);

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..");
const sourceIcon = path.join(repoRoot, "frontend", "public", "favicon.svg");
const outputDir = path.join(desktopDir, ".generated-icons");
const iconGenExecutable = path.join(
  desktopDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "icon-gen.cmd" : "icon-gen"
);

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const iconGenResult = spawnSync(
  iconGenExecutable,
  [
    "-i",
    sourceIcon,
    "-o",
    outputDir,
    "--ico",
    "--ico-name",
    "medialyze",
    "--ico-sizes",
    "16,24,32,48,64,128,256",
    "--icns",
    "--icns-name",
    "medialyze",
    "--icns-sizes",
    "16,32,64,128,256,512,1024",
    "--favicon",
    "--favicon-name",
    "icon",
    "--favicon-png-sizes",
    "32,64,128,256,512",
    "--favicon-ico-sizes",
    "16,32,64"
  ],
  {
    cwd: desktopDir,
    stdio: "inherit"
  }
);

if (iconGenResult.error) {
  console.error(`Failed to run ${iconGenExecutable}:`, iconGenResult.error);
  process.exit(1);
}

if (iconGenResult.status !== 0) {
  process.exit(iconGenResult.status ?? 1);
}

copyFileSync(path.join(outputDir, "icon512.png"), path.join(outputDir, "icon.png"));

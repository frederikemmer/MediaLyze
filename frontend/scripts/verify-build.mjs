import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

const directory = fileURLToPath(new URL("../dist/assets/", import.meta.url));
let verified = 0;
for (const name of readdirSync(directory)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const original = readFileSync(join(directory, name));
  if (statSync(join(directory, name)).size < 1024) continue;
  for (const [suffix, decompress] of [["br", brotliDecompressSync], ["gz", gunzipSync]]) {
    const compressed = readFileSync(join(directory, `${name}.${suffix}`));
    if (!original.equals(decompress(compressed))) {
      throw new Error(`Compressed asset differs from source: ${name}.${suffix}`);
    }
    verified += 1;
  }
}
if (!verified) throw new Error("No compressed JS/CSS assets were verified");
console.log(`Verified ${verified} compressed JS/CSS assets`);

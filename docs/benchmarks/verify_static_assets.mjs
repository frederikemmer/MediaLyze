// Verify the completed Vite build, including chunks with rewritten preloads.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
const folder = 'frontend/dist/assets';
const entries = [];
for (const file of readdirSync(folder).filter(x => /\.(js|css)$/.test(x))) {
  const raw = readFileSync(`${folder}/${file}`);
  const row = { file, bytes: raw.length };
  for (const [suffix, decoder] of [['gz', gunzipSync], ['br', brotliDecompressSync]]) {
    if (raw.length < 1024) continue;
    const compressed = readFileSync(`${folder}/${file}.${suffix}`);
    if (!decoder(compressed).equals(raw)) throw new Error(`Mismatch: ${file}.${suffix}`);
    row[suffix] = compressed.length;
  }
  entries.push(row);
}
writeFileSync('docs/benchmarks/results/nas-followup-assets.json', JSON.stringify(entries, null, 2) + '\n');
console.log(JSON.stringify({ verifiedAssets: entries.length, echarts: entries.find(x => x.file.startsWith('echarts-')) }));

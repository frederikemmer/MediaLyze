// node docs/benchmarks/benchmark_frontend_cache.mjs
// Uses TypeScript's syntax-only transpiler to run the actual cache source.
import fs from 'node:fs';
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';
const source = fs.readFileSync(new URL('../../frontend/src/lib/lru-cache.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { LruCache } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const cache = new LruCache(12, { maxWeight: 5000, weigh: value => value.items.length });
for (let i = 0; i < 12; i++) cache.set(i, { items: Array.from({ length: 4000 }, (_, index) => ({ id: index })) });
let entries = 0, rows = 0;
for (let i = 0; i < 12; i++) {
  const value = cache.get(i);
  if (value) { entries++; rows += value.items.length; }
}
console.log(JSON.stringify({ queries: 12, rows_per_query: 4000, retained_entries: entries, retained_rows: rows }));

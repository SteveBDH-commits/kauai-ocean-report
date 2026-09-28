// Assembles the static site (what gets published): index.html switched to "static" mode.
// ocean-report.json is written next to it by build.mjs.
//
//   node src/assemble-site.mjs --out site

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'site';

const html = await fs.readFile(path.join(here, '..', 'public', 'index.html'), 'utf8');
if (!html.includes('data-mode="server"')) throw new Error('index.html is missing data-mode="server"; cannot switch it to static mode');

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'index.html'), html.replace('data-mode="server"', 'data-mode="static"'));
console.log(`wrote ${path.join(outDir, 'index.html')} (static mode)`);

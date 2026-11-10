// Fails when the code a first visit downloads (every script and stylesheet
// dist/index.html names) grows past the budget. Run after `npm run build`.
// Raise BUDGET_KB only on purpose, noting why in docs/performance.md.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 185;
const dist = new URL("../dist/", import.meta.url);
const html = readFileSync(new URL("index.html", dist), "utf8");
const files = [...new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map(match => match[1]))];
const kb = files.reduce((sum, file) => sum + gzipSync(readFileSync(new URL(file, dist)), { level: 9 }).length, 0) / 1024;
console.log(`First load: ${files.length} files, ${kb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB).`);
// A classic inline script runs only once every stylesheet above it has
// downloaded. The ones that start the page's requests (its data, its chunks)
// must therefore come first, or each first load waits on the CSS to begin them.
const stylesheet = html.search(/<link[^>]+rel="stylesheet"/);
const late = stylesheet === -1 ? [] : [...html.slice(stylesheet).matchAll(/<script(?![^>]*\btype=)[^>]*>/g)];
if (late.length) {
  console.error(`${late.length} inline script(s) follow the stylesheet in dist/index.html and wait for it: move them above everything the build adds to <head>.`);
  process.exit(1);
}
if (kb > BUDGET_KB) {
  console.error("Over budget: load the new code on demand, or raise BUDGET_KB on purpose.");
  process.exit(1);
}

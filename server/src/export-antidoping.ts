import { writeFileSync } from "node:fs";
import { ANTIDOPING_SOURCE, FIRST_ANTIDOPING_YEAR, parseAntidopingTests, type AntidopingSnapshot } from "./antidoping.ts";
import { fetchHtml } from "./http.ts";

/** DATA_DIR=<private copy> node server/src/export-antidoping.ts
 * Fetch all public tables afresh; write the bundled snapshot only after all
 * years pass validation. Never export the local database or fighter links. */
const now = new Date();
const snapshot: AntidopingSnapshot = { source: ANTIDOPING_SOURCE, checkedAt: now.toISOString(), years: [] };
for (let year = FIRST_ANTIDOPING_YEAR; year <= now.getUTCFullYear(); year++) {
  const rows = parseAntidopingTests(await fetchHtml(`${ANTIDOPING_SOURCE}?year=${year}`), year, year === now.getUTCFullYear());
  snapshot.years.push({ year, rows: rows.map(({ name, tests }) => [name, tests]) });
  console.log(`${year}: ${rows.length} public rows validated`);
}
// One row per line keeps source corrections reviewable without shipping HTML.
const years = snapshot.years.map(({ year, rows }) => `    {"year":${year},"rows":[\n${rows.map(row => `      ${JSON.stringify(row)}`).join(",\n")}\n    ]}`);
writeFileSync(new URL("./antidoping-data.json", import.meta.url), `{
  "source": ${JSON.stringify(snapshot.source)},
  "checkedAt": ${JSON.stringify(snapshot.checkedAt)},
  "years": [\n${years.join(",\n")}\n  ]
}\n`);
console.log(`Snapshot saved: ${snapshot.years.reduce((n, year) => n + year.rows.length, 0)} public rows`);

import { parentPort } from "node:worker_threads";
import { resolvePublicApi, pageSeo, shareCardData, sitemap, warmingUp } from "./api.ts";
import { fightIndex, holdIndexes } from "./fight-index.ts";
import { fighterRecords } from "./records.ts";
import { officialsIndex } from "./officials.ts";
import { venueIndex } from "./venues.ts";
import { db } from "./db.ts";

// A worker keeps the indexes it built at startup, so no request waits on a
// rebuild; when the data changes the pool starts a fresh worker and retires
// this one (see `QueryPool.refresh`).
holdIndexes();

// Warm a worker before it takes requests: the fight index, the all-fighter
// record tables, the search and statistics indexes built on first use, and
// one page of each kind, so a new worker never meets cold code.
async function warm() {
  fightIndex();
  fighterRecords("");
  officialsIndex();
  venueIndex();
  // The newest cards, their bouts and fighters: the pages most readers open,
  // and enough of them that the code for each kind of page is compiled.
  const recent = db.prepare(`SELECT f.id, f.f1_id, f.f2_id, f.event_id FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.date <= date('now', '+30 days') ORDER BY e.date DESC, f.ord DESC LIMIT 40`).all() as { id: string; f1_id: string; f2_id: string; event_id: string }[];
  const urls = new Set(["/api/search?q=a", "/api/stats", "/api/events", "/api/live", "/api/rankings", "/api/labs/insights", "/api/officials", "/api/venues"]);
  for (const fight of recent) {
    for (const ranking of ["media", "meta"]) {
      urls.add(`/api/events/${fight.event_id}?ranking=${ranking}`);
      urls.add(`/api/fights/${fight.id}?ranking=${ranking}`);
    }
    for (const fighter of [fight.f1_id, fight.f2_id].filter(Boolean)) {
      urls.add(`/api/fighters/${fighter}?ranking=media`);
      urls.add(`/api/fighters/${fighter}/stats?scope=ufc&minBouts=0`);
    }
  }
  if (recent[0]) urls.add(`/api/previews/${recent[0].f1_id}`);
  for (const url of urls) {
    try { await resolvePublicApi(new URL(url, "http://localhost")); } catch { /* warming only */ }
  }
  for (const fight of recent.slice(0, 5)) pageSeo(`/fights/${fight.id}`);
}

await warmingUp(warm);
parentPort!.on("message", async ({ id, url }: { id: number; url: string }) => {
  try {
    const parsed = new URL(url, "http://localhost");
    const data = parsed.pathname === "/_seo" ? pageSeo(parsed.searchParams.get("path") ?? "/")
      : parsed.pathname === "/_sitemap" ? sitemap()
        : parsed.pathname === "/_share" ? shareCardData(parsed.searchParams.get("kind") ?? "", parsed.searchParams.get("id") ?? "")
          : await resolvePublicApi(parsed);
    parentPort!.postMessage({ id, result: { json: JSON.stringify(data === undefined ? { error: "not found" } : data), status: data === undefined ? 404 : 200 } });
  } catch (error) {
    console.error("query failed:", String(error));
    parentPort!.postMessage({ id, error: "Query failed" });
  }
});
parentPort!.postMessage({ ready: true });

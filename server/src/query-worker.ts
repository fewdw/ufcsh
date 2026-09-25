import { parentPort } from "node:worker_threads";
import { resolvePublicApi, pageSeo, refreshSearchIndex, shareCardData, sitemap } from "./api.ts";
import { fightIndex, holdIndexes, refreshFightIndex } from "./fight-index.ts";
import { fighterRecords } from "./records.ts";
import { officialsIndex } from "./officials.ts";
import { venueIndex } from "./venues.ts";
import { db } from "./db.ts";

// Requests read the index this worker already has; the pool refreshes one
// worker at a time (a `refresh` message) while the others keep answering.
holdIndexes();

// Warm a worker before it takes requests: the fight index, the all-fighter
// record tables, the search and statistics indexes built on first use, and
// one page of each kind, so neither a restart nor a refresh meets cold code.
async function warm() {
  fightIndex();
  fighterRecords("");
  officialsIndex();
  venueIndex();
  const recent = db.prepare(`SELECT f.id, f.f1_id, f.event_id FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 ORDER BY e.date DESC LIMIT 1`).get() as { id: string; f1_id: string; event_id: string } | undefined;
  for (const url of ["/api/search?q=a", "/api/stats", "/api/events", "/api/rankings", "/api/labs/insights",
    ...(recent ? [`/api/fights/${recent.id}`, `/api/fighters/${recent.f1_id}`, `/api/fighters/${recent.f1_id}/stats`,
      `/api/previews/${recent.f1_id}`, `/api/events/${recent.event_id}`] : [])]) {
    try { await resolvePublicApi(new URL(url, "http://localhost")); } catch { /* warming only */ }
  }
  if (recent) pageSeo(`/fights/${recent.id}`);
}

refreshFightIndex();
refreshSearchIndex();
await warm();
parentPort!.on("message", async ({ id, url, refresh }: { id: number; url: string; refresh?: boolean }) => {
  if (refresh) {
    try {
      const changed = refreshFightIndex();
      refreshSearchIndex();
      if (changed) await warm();
    } catch (error) {
      console.error("index refresh failed:", String(error));
    }
    parentPort!.postMessage({ refreshed: true });
    return;
  }
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

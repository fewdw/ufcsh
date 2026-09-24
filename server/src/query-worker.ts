import { parentPort } from "node:worker_threads";
import { resolvePublicApi, pageSeo, shareCardData, sitemap } from "./api.ts";
import { fightIndex } from "./fight-index.ts";
import { fighterRecords } from "./records.ts";
import { officialsIndex } from "./officials.ts";
import { db } from "./db.ts";

// Prewarm each worker before readiness: the fight index, the all-fighter
// record tables, the search and statistics indexes built on first use, and
// one page of each kind, so a restart under load doesn't meet cold code.
fightIndex();
fighterRecords("");
officialsIndex();
const recent = db.prepare(`SELECT f.id, f.f1_id, f.event_id FROM fights f JOIN events e ON e.id = f.event_id
  WHERE e.complete = 1 ORDER BY e.date DESC LIMIT 1`).get() as { id: string; f1_id: string; event_id: string } | undefined;
for (const url of ["/api/search?q=a", "/api/stats", "/api/events", "/api/rankings",
  ...(recent ? [`/api/fights/${recent.id}`, `/api/fighters/${recent.f1_id}`, `/api/previews/${recent.f1_id}`, `/api/events/${recent.event_id}`] : [])]) {
  await resolvePublicApi(new URL(url, "http://localhost"));
}
if (recent) pageSeo(`/fights/${recent.id}`);
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

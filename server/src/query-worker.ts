import { parentPort } from "node:worker_threads";
import { resolvePublicApi, pageSeo, sitemap } from "./api.ts";
import { fightIndex } from "./fight-index.ts";
import { fighterRecords } from "./records.ts";

// Prewarm each worker before readiness, including the all-fighter record tables.
fightIndex();
fighterRecords("");
parentPort!.on("message", async ({ id, url }: { id: number; url: string }) => {
  try {
    const parsed = new URL(url, "http://localhost");
    const data = parsed.pathname === "/_seo" ? pageSeo(parsed.searchParams.get("path") ?? "/")
      : parsed.pathname === "/_sitemap" ? sitemap() : await resolvePublicApi(parsed);
    parentPort!.postMessage({ id, result: { json: JSON.stringify(data === undefined ? { error: "not found" } : data), status: data === undefined ? 404 : 200 } });
  } catch (error) {
    console.error("query failed:", String(error));
    parentPort!.postMessage({ id, error: "Query failed" });
  }
});
parentPort!.postMessage({ ready: true });

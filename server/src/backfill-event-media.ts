import { writeFile } from "node:fs/promises";
import { db } from "./db.ts";
import { eventVideos, importBroadcast, syncEventMedia } from "./event-media.ts";
import { eventSearch, type MediaEvent } from "./scrape/event-media.ts";

/** DATA_DIR=<private copy> npm run backfill:event-media -- --events=332,333
 * --limit=10: bounded newest-first history. --event-id=<id> also supports Fight Nights.
 * --broadcast-url=<report>: import explicit broadcast sections for one selected event.
 * --export=src/event-media-data.ts: retain verified videos in versioned starter data. */
const options = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=", 2) as [string, string]));
const numbers = (options.get("events") ?? "").split(",").filter(Boolean);
const id = options.get("event-id");
const limit = Math.max(1, Math.min(100, Number(options.get("limit") ?? 2)));
if (!Number.isFinite(limit) || numbers.some(n => !/^\d+$/.test(n))) throw new Error("Use --events=332,333, --event-id=<id>, or --limit=<1..100>");
const events = (db.prepare("SELECT id, name, date, complete FROM events ORDER BY date DESC").all() as MediaEvent[])
  .filter(event => id ? event.id === id : numbers.length ? numbers.some(n => eventSearch(event) === `UFC ${n}`) : event.date <= new Date().toISOString().slice(0, 10));
if (!events.length || numbers.some(n => !events.some(event => eventSearch(event) === `UFC ${n}`))) throw new Error("Requested event not found in this archive");
const selected = id || numbers.length ? events : events.slice(0, limit);
if (options.has("broadcast-url") && selected.length !== 1) throw new Error("Select one event to import a broadcast report");
let failed = 0;
for (const event of selected) {
  console.log(`Reading ${event.name}`);
  if (options.get("broadcast-url")) await importBroadcast(event, options.get("broadcast-url")!);
  const result = await syncEventMedia(event.id);
  console.log(`${event.name}: ${result.videos} YouTube videos; ${result.failed} source errors`);
  failed += result.failed;
}
if (options.get("export")) {
  const curated: Record<string, ReturnType<typeof eventVideos>> = {};
  for (const event of selected) curated[eventSearch(event)] = eventVideos(event);
  const rows = Object.entries(curated).map(([key, videos]) => `  ${JSON.stringify(key)}: [\n${videos.map(video => `    ${JSON.stringify(video)},`).join("\n")}\n  ],`).join("\n");
  await writeFile(options.get("export")!, `import type { Video } from "./scrape/event-media.ts";\n/** Verified YouTube metadata retained by backfill:event-media. */\nexport const EVENT_MEDIA: Record<string, Video[]> = {\n${rows}\n};\n`);
}
if (failed) process.exitCode = 1;

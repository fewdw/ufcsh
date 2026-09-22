import { db } from "./db.ts";
import { importVerdictEvent, type ImportMode } from "./verdict-import.ts";

/**
 * One pass over Verdict MMA's whole event archive. Usage:
 *   node src/backfill-verdict-scorecards.ts [--from=1] [--max=2100] [--concurrency=6] [--refresh] [--since=<ms>]
 * By default only fights still missing official rounds or a community card are
 * read; --refresh replaces everything stored with what Verdict shows now.
 */

const argv = new Map(process.argv.slice(2).map(value => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const maxEvent = Math.max(1, Number(argv.get("max") ?? process.env.VERDICT_MAX_EVENT_ID ?? 2100));
const firstEvent = Math.max(1, Number(argv.get("from") ?? 1));
const concurrency = Math.min(12, Math.max(1, Number(argv.get("concurrency") ?? 6)));
const mode: ImportMode = argv.has("refresh") ? "refresh" : "missing";
// Fights read since this moment are not read again (default: this run).
const skipCheckedSince = Number(argv.get("since") ?? Date.now());

let scanned = 0;
let unreadable = 0;
let matchedEvents = 0;
const total = { matchedFights: 0, official: 0, community: 0, failed: 0 };

async function main(): Promise<void> {
  const scoreable = (db.prepare(`SELECT COUNT(*) AS n FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND (f.method LIKE '%DEC' OR CAST(f.round AS INTEGER) > 1)`).get() as { n: number }).n;
  console.log(`Verdict backfill: events ${firstEvent}–${maxEvent}, ${concurrency} concurrent requests, ${scoreable} scoreable local fights, mode ${mode}`);
  let next = firstEvent;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const eventId = next++;
      if (eventId > maxEvent) return;
      const result = await importVerdictEvent(eventId, mode, { quiet: true, skipCheckedSince });
      scanned += 1;
      if (!result) unreadable += 1;
      else {
        if (result.eventId) matchedEvents += 1;
        total.matchedFights += result.matchedFights;
        total.official += result.official;
        total.community += result.community;
        total.failed += result.failed;
      }
      if (scanned % 100 === 0) {
        console.log(`scanned ${scanned}/${maxEvent - firstEvent + 1}; matched ${matchedEvents} events / ${total.matchedFights} fights; official ${total.official}; community ${total.community}; failures ${total.failed}; unreadable ${unreadable}`);
      }
    }
  }));
  console.log(`done: scanned ${scanned}; matched ${matchedEvents} events / ${total.matchedFights} fights; official ${total.official}; community ${total.community}; failures ${total.failed}; unreadable ${unreadable}`);
}

await main();

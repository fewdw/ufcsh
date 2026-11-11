import { db, getMeta } from "./db.ts";
import { importVerdictPickCard } from "./verdict-picks.ts";

/**
 * Verdict MMA's fans' picks for its whole archive in one pass, instead of the
 * background walk's one card every 30 seconds. Usage:
 *   node src/backfill-verdict-picks.ts [--from=1] [--max=<newest card seen, else 2100>] [--concurrency=4]
 * Cards already read final are skipped, here and by the background walk.
 */

const argv = new Map(process.argv.slice(2).map(value => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const first = Math.max(1, Number(argv.get("from") ?? 1));
const last = Math.max(first, Number(argv.get("max") ?? getMeta("verdict_picks_newest") ?? 2100));
const concurrency = Math.min(8, Math.max(1, Number(argv.get("concurrency") ?? 4)));
const final = db.prepare("SELECT final FROM verdict_pick_cards WHERE verdict_id = ?");

let next = first, scanned = 0, cards = 0, stored = 0, failed = 0;
console.log(`Verdict picks backfill: cards ${first}–${last}, ${concurrency} at a time`);
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (;;) {
    const id = next++;
    if (id > last) return;
    scanned += 1;
    if ((final.get(id) as { final: number } | undefined)?.final) continue;
    try {
      const result = await importVerdictPickCard(id);
      if (result.matched) cards += 1;
      stored += result.stored;
    } catch (error) {
      failed += 1;
      console.log(`card ${id}: ${String(error)}`);
    }
    if (scanned % 100 === 0) console.log(`scanned ${scanned}/${last - first + 1}; ${cards} cards matched; ${stored} bouts stored; ${failed} failed`);
  }
}));
console.log(`done: scanned ${scanned}; ${cards} cards matched; ${stored} bouts stored; ${failed} failed`);

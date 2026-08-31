import { db } from "./db.ts";
import { syncOddsBackfill, syncUpcomingOdds } from "./sync.ts";

const BATCH_SIZE = 250;

function coverage(): { available: number; eligible: number } {
  return db.prepare(`
    SELECT
      SUM(CASE WHEN o.f1_close IS NOT NULL AND o.f2_close IS NOT NULL THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN e.date >= '2007-01-01' THEN 1 ELSE 0 END) AS eligible
    FROM fights f
    JOIN events e ON e.id = f.event_id
    LEFT JOIN odds o ON o.fight_id = f.id
  `).get() as { available: number; eligible: number };
}

const initial = coverage();
console.log(`odds backfill starting: ${initial.available}/${initial.eligible} source-era fights currently populated`);

const upcoming = await syncUpcomingOdds({ force: true, limit: 1_000 });
console.log(`upcoming odds: ${upcoming.stored}/${upcoming.selected} checked, ${upcoming.failed} failed`);

let batch = 0;
let consecutiveFailureBatches = 0;
while (true) {
  batch++;
  const result = await syncOddsBackfill(BATCH_SIZE);
  const current = coverage();
  console.log(
    `historical batch ${batch}: ${result.scanned}/${result.selected} fighters, ` +
      `${result.filled} matched lines, ${result.failed} failed; coverage ${current.available}/${current.eligible}`,
  );

  if (result.selected === 0) break;
  consecutiveFailureBatches = result.scanned === 0 ? consecutiveFailureBatches + 1 : 0;
  if (consecutiveFailureBatches >= 3) {
    throw new Error("odds source failed for three consecutive batches; stopping without suppressing retries");
  }
}

const final = coverage();
console.log(`odds backfill complete: ${final.available}/${final.eligible} source-era fights populated`);

import { db } from "./db.ts";
import { syncMethodOddsBackfill, syncUpcomingMethodOdds } from "./sync.ts";

const upcoming = await syncUpcomingMethodOdds(100);
console.log(`upcoming method odds: ${upcoming.fights} fights across ${upcoming.events} events`);

const remaining = db.prepare(`
  SELECT COUNT(*) AS count FROM events
  WHERE complete = 1 AND date >= '2007-01-01' AND bfo_final_at IS NULL
`);
let batch = 0;
while ((remaining.get() as { count: number }).count) {
  batch++;
  const result = await syncMethodOddsBackfill(10);
  const left = (remaining.get() as { count: number }).count;
  console.log(`method odds batch ${batch}: ${result.fights} fights across ${result.events} events, ${result.failed} failed; ${left} events remaining`);
  // Failed events wait an hour before the backfill selects them again.
  if (!result.events) break;
}

const coverage = db.prepare("SELECT COUNT(*) AS fights FROM method_odds").get() as { fights: number };
console.log(`method odds: ${coverage.fights} fights stored`);

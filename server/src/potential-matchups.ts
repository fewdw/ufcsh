import { db, prepared, setMeta, getMeta } from "./db.ts";
import { normName } from "./util.ts";
import { bestFightOddsPotentialBouts, type PotentialBout } from "./scrape/potential-odds.ts";
import { fighterNamed } from "./fighter-identity.ts";
import { boutLines, boutProps, fightOddsProps, fightOddsBoard, fightOddsEvents } from "./scrape/fightodds.ts";

export const POTENTIAL_EVENT_ID = "potential-matchups";
export const POTENTIAL_EVENT_NAME = "Potential matchups";

export type PotentialMatchup = {
  id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string;
  odds_json: string; fetched_at: number;
};

/** Separate from booked fights: these never enter records, schedules or predictions.
 * A pairing moves out of this list as soon as it appears on an announced card. */
export function potentialMatchups(): PotentialMatchup[] {
  const rows = prepared(`SELECT p.* FROM potential_matchups p WHERE NOT EXISTS (
    SELECT 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 0
      AND ((f.f1_id = p.f1_id AND f.f2_id = p.f2_id) OR (f.f1_id = p.f2_id AND f.f2_id = p.f1_id))
      AND p.f1_id != '' AND p.f2_id != ''
  ) ORDER BY p.fetched_at DESC`).all() as PotentialMatchup[];
  const fresh = (row: PotentialMatchup) => JSON.parse(row.odds_json).source_url.startsWith("https://fightodds.io/") && Date.now() - row.fetched_at < 10 * 60_000;
  rows.sort((a, b) => Number(fresh(b)) - Number(fresh(a)) || b.fetched_at - a.fetched_at);
  const seen = new Set<string>();
  return rows.filter(row => {
    const pair = [row.f1_id || normName(row.f1_name), row.f2_id || normName(row.f2_name)].sort().join(":");
    if (seen.has(pair)) return false;
    seen.add(pair);
    return true;
  }).sort((a, b) => a.f1_name.localeCompare(b.f1_name) || a.f2_name.localeCompare(b.f2_name));
}

export function potentialFight(row: PotentialMatchup, ord = Number.MAX_SAFE_INTEGER) {
  return {
    ...row, ord, event_id: POTENTIAL_EVENT_ID, event_name: POTENTIAL_EVENT_NAME,
    // Only used internally as the cutoff for current career comparisons.
    event_date: new Date().toISOString().slice(0, 10),
    event_location: "", event_complete: 0, weight_class: "", title_fight: 0,
    f1_outcome: null, f2_outcome: null, method: null, method_details: null,
    round: null, time: null, detail_json: null, detail_fetched_at: null,
    perf_bonus: 0, fotn_bonus: 0,
  };
}

/** Replace only after a successful board read. Removed/cancelled/unpriced bouts
 * disappear; a failed request preserves the last successful snapshot. */
export async function storePotentialBoard(bouts: PotentialBout[], props = false, source: "fightodds" | "bestfightodds" = "fightodds"): Promise<number> {
  const priced = bouts.filter(bout => boutLines(bout));
  const boards = props ? await fightOddsProps(priced.filter(bout => bout.propCount > 0).map(bout => bout.slug)) : new Map();
  const prior = new Map((db.prepare("SELECT * FROM potential_matchups").all() as PotentialMatchup[]).map(row => [row.id, row]));
  const now = Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  const seen = new Set<string>();
  const rows: PotentialMatchup[] = [];
  for (const bout of priced) {
    const f1_id = bout.f1.id || fighterNamed(bout.f1.name, "", date);
    const f2_id = bout.f2.id || fighterNamed(bout.f2.name, "", date);
    const pair = [f1_id || normName(bout.f1.name), f2_id || normName(bout.f2.name)].sort().join(":");
    if (seen.has(pair)) continue;
    seen.add(pair);
    const id = `potential-${bout.slug}`;
    const lines = boutLines(bout)!;
    const old = prior.get(id);
    const same = old?.f1_id === f1_id && old?.f2_id === f2_id;
    const previous = same ? JSON.parse(old.odds_json) : null;
    const markets = bout.markets ?? (boards.has(bout.slug) ? boutProps(boards.get(bout.slug)!, bout, false, [bout.f1.name, bout.f2.name]) : null);
    const marketPrices = markets && (Object.keys(markets.f1).length || Object.keys(markets.f2).length || markets.additional.length);
    rows.push({ id, f1_id, f2_id, f1_name: bout.f1.name, f2_name: bout.f2.name, fetched_at: now,
      odds_json: JSON.stringify({
        f1: { open: previous?.f1.open ?? lines.open[0], close: lines.close[0] },
        f2: { open: previous?.f2.open ?? lines.open[1], close: lines.close[1] }, source_url: bout.url,
        ...(marketPrices ? { props: { f1: markets.f1, f2: markets.f2, additional: markets.additional,
          source_url: bout.url, fetched_at: now, final: false } } : !props && !bout.markets && previous?.props ? { props: previous.props } : {}),
      }),
    });
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM potential_matchups WHERE json_extract(odds_json, '$.source_url') LIKE ?").run(
      source === "fightodds" ? "https://fightodds.io/%" : "https://www.bestfightodds.com/%",
    );
    const insert = db.prepare("INSERT INTO potential_matchups VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const row of rows) insert.run(row.id, row.f1_id, row.f2_id, row.f1_name, row.f2_name, row.odds_json, now);
    setMeta("potential_matchups_read_at", String(now));
    setMeta(`potential_${source}_read_at`, String(now));
    setMeta(`potential_${source}_error`, "");
    if (props && source === "fightodds") setMeta("potential_props_read_at", String(now));
    db.exec("COMMIT");
  } catch (err) { db.exec("ROLLBACK"); throw err; }
  return rows.length;
}

let reading: Promise<{ failed: number }> | null = null;
/** Each source replaces only its own snapshot. A failure leaves the other
 * source available and never empties the list. One read at a time per worker. */
export function syncPotentialMatchups({ props = false }: { props?: boolean } = {}): Promise<{ failed: number }> {
  if (reading) return reading;
  reading = (async () => {
    const readFightOdds = async () => {
      const events = await fightOddsEvents(new Date().toISOString().slice(0, 10));
      const board = events.find(event => event.slug === "future-fights");
      if (!board) throw new Error("FightOdds.io future-fights board is missing");
      await storePotentialBoard(await fightOddsBoard(board.pk), props);
    };
    const results = await Promise.allSettled([
      readFightOdds(),
      bestFightOddsPotentialBouts().then(bouts => storePotentialBoard(bouts, false, "bestfightodds")),
    ]);
    let failed = 0;
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        setMeta(`potential_${index ? "bestfightodds" : "fightodds"}_error`, String(result.reason));
        failed++;
      }
    });
    return { failed };
  })().finally(() => { reading = null; });
  return reading;
}

/** Start immediately, independently of the long archive/card sync tick. */
export function startPotentialMatchupSync(): void {
  const read = () => void syncPotentialMatchups({ props: Date.now() - Number(getMeta("potential_props_read_at")) > 30 * 60_000 });
  read();
  setInterval(read, 5 * 60_000);
}

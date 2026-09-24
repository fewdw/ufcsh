import { db } from "./db.ts";
import { alignment } from "./verdict-import.ts";
import { hasCompleteJudgeRounds, mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";
import { fetchMmaDecisions, mmaDecisionUrl, parseMmaDecision, parseMmaEventDecisions, parseMmaEvents } from "./scrape/mmadecisions.ts";
import { normName } from "./util.ts";

/** Fill official round scores that Verdict MMA did not provide. Usage:
 * node src/backfill-mmadecisions-scorecards.ts [--from=1995] [--to=2026] [--concurrency=6] [--event-filter=TUF]
 * A bout must match both fighter names and date; each card's final score is
 * checked against UFCStats when UFCStats recorded official totals. */

const options = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=", 2) as [string, string]));
const from = Number(options.get("from") ?? 1995);
const to = Number(options.get("to") ?? new Date().getFullYear());
const concurrency = Math.max(1, Math.min(8, Number(options.get("concurrency") ?? 6)));
const eventFilter = options.get("event-filter") ?? "";

type Fight = {
  id: string; date: string; f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null;
  detail_json: string | null; judge_rounds_json: string | null;
};
const fights = db.prepare(`SELECT f.id, e.date, f.f1_name, f.f2_name,
    c1.source_name AS f1_alias, c2.source_name AS f2_alias, f.detail_json, f.judge_rounds_json
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE e.complete = 1 AND f.method LIKE '%DEC' AND e.date BETWEEN ? AND ?`).all(
    `${from}-01-01`, `${to}-12-31`) as Fight[];
const byDate = new Map<string, Fight[]>();
// MMA Decisions files some international cards under the following UTC day.
// Keep the window narrow; both fighter names and the official totals still
// have to match before any round card is stored.
function nearbyFights(date: string): Fight[] {
  const day = new Date(`${date}T12:00:00Z`);
  return [-1, 0, 1].flatMap(offset => {
    const shifted = new Date(day);
    shifted.setUTCDate(day.getUTCDate() + offset);
    return byDate.get(shifted.toISOString().slice(0, 10)) ?? [];
  });
}
const official = (fight: Fight): JudgeCard[] => {
  try { const cards = JSON.parse(fight.detail_json ?? "null")?.judges; return Array.isArray(cards) ? cards : []; }
  catch { return []; }
};
const imported = (fight: Fight): JudgeCard[] => {
  try { const cards = JSON.parse(fight.judge_rounds_json ?? "null")?.judges; return Array.isArray(cards) ? cards : []; }
  catch { return []; }
};
for (const fight of fights) {
  if (hasCompleteJudgeRounds(official(fight), imported(fight))) continue;
  byDate.set(fight.date, [...(byDate.get(fight.date) ?? []), fight]);
}

const update = db.prepare("UPDATE fights SET judge_rounds_json = ? WHERE id = ?");
const stats = { years: 0, events: 0, decisions: 0, repaired: 0, failed: 0 };
const seen = new Set<string>();

async function pool<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

// A card on December 31 may appear in the following year's archive.
const years = Array.from({ length: to - from + 3 }, (_v, i) => from - 1 + i);
const events: { date: string; path: string }[] = [];
await pool(years.filter(year => [...byDate.keys()].some(date =>
  Math.abs(Number(date.slice(0, 4)) - year) <= 1)), async year => {
  try {
    const found = parseMmaEvents(await fetchMmaDecisions(`decisions-by-event/${year}/`));
    events.push(...found.filter(event => nearbyFights(event.date).length && event.path.includes(eventFilter)));
    stats.years++;
  } catch (error) { stats.failed++; console.error(`MMA Decisions year ${year}: ${String(error)}`); }
});
console.log(`MMA Decisions: ${byDate.size} dates with missing rounds, ${events.length} possible events`);

const paths: { date: string; path: string }[] = [];
function relevantPath(date: string, path: string): boolean {
  const slug = normName(decodeURIComponent(path.split("/").at(-1) ?? ""));
  const words = new Set(slug.split(" ").filter(word => word.length >= 4));
  return nearbyFights(date).some(fight => [fight.f1_name, fight.f2_name, fight.f1_alias, fight.f2_alias]
    .some(name => name && normName(name).split(" ").some(word => words.has(word))));
}
await pool(events, async event => {
  try {
    for (const path of parseMmaEventDecisions(await fetchMmaDecisions(event.path))) {
      if (seen.has(path) || !relevantPath(event.date, path)) continue;
      seen.add(path);
      paths.push({ date: event.date, path });
    }
    stats.events++;
  } catch (error) { stats.failed++; console.error(`MMA Decisions ${event.path}: ${String(error)}`); }
});
console.log(`MMA Decisions: ${stats.events} events read, ${paths.length} decision pages`);

await pool(paths, async ({ date, path }) => {
  try {
    const page = parseMmaDecision(await fetchMmaDecisions(path));
    stats.decisions++;
    if (!page || !page.judges.length) return;
    const matches = nearbyFights(date).flatMap(fight => {
      const sides: [string[], string[]] = [
        [fight.f1_name, ...(fight.f1_alias ? [fight.f1_alias] : [])],
        [fight.f2_name, ...(fight.f2_alias ? [fight.f2_alias] : [])],
      ];
      const found = alignment(page.f1Name, page.f2Name, ...sides);
      return found?.tier === 1 ? [{ fight, order: found.order }] : [];
    });
    if (matches.length !== 1) return;
    const { fight, order } = matches[0];
    const cards = page.judges.map(card => order === 1 ? card : {
      ...card, f1Score: card.f2Score, f2Score: card.f1Score,
      rounds: card.rounds?.map(round => ({ ...round, f1Score: round.f2Score, f2Score: round.f1Score })),
    });
    const totals = official(fight);
    const prior = imported(fight);
    const before = totals.length ? mergeJudgeRounds(totals, prior).filter(card => card.rounds?.length).length : prior.length;
    const combined = totals.length ? mergeJudgeRounds(totals, [...prior, ...cards]).filter(card => card.rounds?.length) : cards;
    // Without independent UFCStats totals, require all three judge cards.
    if (combined.length <= before || (!totals.length && combined.length < 3)) return;
    const source = prior.length && combined.some(card => !cards.some(next => next.judge === card.judge))
      ? "MMA Decisions + Verdict MMA" : "MMA Decisions";
    fight.judge_rounds_json = JSON.stringify({ source, sourceUrl: mmaDecisionUrl(path), fetchedAt: Date.now(), judges: combined });
    update.run(fight.judge_rounds_json, fight.id);
    stats.repaired++;
  } catch (error) { stats.failed++; if (stats.failed <= 20) console.error(`MMA Decisions ${path}: ${String(error)}`); }
  finally {
    if (stats.decisions > 0 && stats.decisions % 100 === 0)
      console.log(`MMA Decisions: ${stats.decisions}/${paths.length} decisions, ${stats.repaired} repaired, ${stats.failed} failed`);
  }
});
console.log(`MMA Decisions done: ${JSON.stringify(stats)}`);

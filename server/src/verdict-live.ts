import { validCommunityScorecard } from "./community-scorecards.ts";
import { db } from "./db.ts";
import { isFightDay, type VerdictLive } from "./live-state.ts";
import { fetchVerdictDocument, parseVerdictFightPage, parseVerdictLiveCard, verdictRendered, VERDICT, type VerdictLiveFight } from "./scrape/verdict.ts";
import { log } from "./util.ts";
import { alignment } from "./verdict-import.ts";

/**
 * Verdict MMA while a card is being fought: which bout is on, which of its
 * rounds have started and ended, and its fans' average for the ended ones —
 * thousands of cards a round. Stored on the bout as `verdict_live_json`; the
 * Score tab opens rounds by it (`scoringEligibility`) and blends the average
 * into the fans' card (`ScoringStore.summary`) until the finished tally is
 * imported (`verdict-import.ts`).
 */

type LocalFight = { id: string; event_id: string; date: string; f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null; verdict_live_json: string | null };

/** How often a Verdict card is read: the bout on it every few seconds, a card
 * between bouts less often, and one with nothing of ours left rarely. */
export const VERDICT_LIVE_MS = 15_000;
const BETWEEN_BOUTS_MS = 30_000;
const IDLE_MS = 10 * 60_000;

const unfinished = db.prepare(`SELECT f.id, f.event_id, e.date, f.f1_name, f.f2_name,
    c1.source_name AS f1_alias, c2.source_name AS f2_alias, f.verdict_live_json
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE e.complete = 0 AND e.date BETWEEN date('now', '-1 day') AND date('now')
    AND f.f1_outcome IS NULL AND f.f2_outcome IS NULL`);
/** Verdict cards matched to tonight's, or dated on it and not matched yet
 * (nothing on it has finished). Verdict splits a card over two ids. */
const verdictCards = db.prepare(`SELECT verdict_id FROM verdict_events
  WHERE event_id IN (SELECT value FROM json_each(?))
    OR (event_id IS NULL AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day'))`);
const store = db.prepare("UPDATE fights SET verdict_live_json = ? WHERE id = ? AND verdict_live_json IS NOT ?");

/** Per Verdict card: when to read it next, and the bout it had on. */
const cards = new Map<number, { dueAt: number; on: number | null }>();
let running = false;

const sides = (fight: LocalFight): [string[], string[]] => [
  [fight.f1_name, ...(fight.f1_alias ? [fight.f1_alias] : [])],
  [fight.f2_name, ...(fight.f2_alias ? [fight.f2_alias] : [])],
];

/** Our unfinished bout this is, when exactly one matches best. */
function localFor(source: VerdictLiveFight, fights: LocalFight[]): { fight: LocalFight; order: 1 | -1 } | null {
  const ranked = fights.flatMap(fight => {
    const found = alignment(source.f1Name, source.f2Name, ...sides(fight));
    return found ? [{ fight, ...found }] : [];
  });
  const tier = Math.min(...ranked.map(match => match.tier));
  const best = ranked.filter(match => match.tier === tier);
  return best.length === 1 ? { fight: best[0].fight, order: best[0].order } : null;
}

/** What a bout's page says, in our corner order. Rounds count as started or
 * ended only from round one without a gap. */
export function liveState(fight: VerdictLiveFight, html: string, order: 1 | -1, sourceUrl: string): VerdictLive {
  const prefix = (test: (status: number) => boolean) => {
    let count = 0;
    for (const round of fight.rounds) { if (round.round !== count + 1 || !test(round.status)) break; count++; }
    return count;
  };
  const started = prefix(status => status >= 1);
  const ended = Math.min(started, prefix(status => status >= 2));
  const page = parseVerdictFightPage(verdictRendered(html));
  const card = page?.community;
  let community: VerdictLive["community"] = null;
  // The page's own names must agree with the card's, and the average may
  // cover only rounds Verdict has ended.
  if (page && card && alignment(page.f1Name, page.f2Name, [fight.f1Name], [fight.f2Name])?.order === 1
    && card.rounds.length <= ended && validCommunityScorecard(card, card.rounds.length)) {
    community = order === 1
      ? { cards: card.cards, avg1: card.avg1, avg2: card.avg2, rounds: card.rounds }
      : { cards: card.cards, avg1: card.avg2, avg2: card.avg1, rounds: card.rounds.map(round => ({ round: round.round, avg1: round.avg2, avg2: round.avg1 })) };
  }
  return { sourceUrl, status: fight.status, started, ended, community };
}

async function readCard(verdictId: number, fights: LocalFight[], now: number, again = true): Promise<void> {
  const card = cards.get(verdictId) ?? { dueAt: 0, on: null };
  cards.set(verdictId, card);
  if (now < card.dueAt) return;
  // The bout's own page lists the card's other bouts too, so while one is on
  // a single read covers both it and what follows.
  const html = await fetchVerdictDocument(card.on != null ? `/event/${verdictId}/fight/${card.on}` : `/event/${verdictId}`);
  const listed = parseVerdictLiveCard(html, verdictId);
  const watched = listed.filter(fight => localFor(fight, fights));
  const on = watched.find(fight => fight.status === 1) ?? null;
  // The page read is the bout's own: record it, including its last word
  // once Verdict calls it over.
  const read = card.on != null ? listed.find(fight => fight.fightNumber === card.on) : undefined;
  const match = read && localFor(read, fights);
  if (read && match) {
    const state = JSON.stringify(liveState(read, html, match.order, `${VERDICT}/event/${verdictId}/fight/${read.fightNumber}`));
    store.run(state, match.fight.id, state);
  }
  card.on = on?.fightNumber ?? null;
  card.dueAt = now + (on ? VERDICT_LIVE_MS : watched.length ? BETWEEN_BOUTS_MS : IDLE_MS);
  // A bout just found on is read straight away, from its own page.
  if (on && on.fightNumber !== read?.fightNumber && again) {
    card.dueAt = 0;
    await readCard(verdictId, fights, now, false);
  }
}

/** One pass over tonight's Verdict cards, each on its own clock. */
export async function syncVerdictLive(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const fights = (unfinished.all() as LocalFight[]).filter(fight => isFightDay(fight.date, now));
    if (!fights.length) { cards.clear(); return; }
    const date = fights[0].date;
    const ids = (verdictCards.all(JSON.stringify([...new Set(fights.map(fight => fight.event_id))]), date, date) as { verdict_id: number }[])
      .map(row => row.verdict_id);
    for (const id of ids) {
      try { await readCard(id, fights, now); }
      catch (error) {
        const card = cards.get(id);
        if (card) card.dueAt = now + BETWEEN_BOUTS_MS;
        log(`verdict live ${id}: ${String(error)}`);
      }
    }
  } finally {
    running = false;
  }
}

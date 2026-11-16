import { db } from "./db.ts";
import { hasCompleteJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";
import { mergeMmaJudgeRounds } from "./mma-judge-rounds.ts";
import { fetchEventFeedBouts, fetchFightRoundScores, ufcFightFeedUrl, type UfcFeedBout } from "./scrape/ufccom.ts";
import { log } from "./util.ts";
import { alignment, matchBouts, sides } from "./verdict-import.ts";

/**
 * The promotion's own fight feed publishes every judge's round card within
 * hours of a decision, days before Verdict MMA or MMA Decisions (blocked since
 * October 2026) may post one. This pass fills the gaps from it: recent
 * decisions often, older ones once each, a few cards at a time.
 */

type Candidate = {
  id: string; event_id: string; date: string; ufc_event_id: number;
  f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null;
  round: string | null; detail_json: string | null; judge_rounds_json: string | null;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const SELECT = `SELECT f.id, f.event_id, e.date, e.ufc_event_id, f.f1_name, f.f2_name,
    c1.source_name AS f1_alias, c2.source_name AS f2_alias, f.round, f.detail_json, f.judge_rounds_json
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE e.ufc_event_id IS NOT NULL AND f.method LIKE '%DEC%' AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)`;
const oneFight = db.prepare(`${SELECT} AND f.id = ?`);
const candidates = db.prepare(`${SELECT}
    AND (f.ufc_rounds_checked_at IS NULL
      OR (e.date >= date('now', '-3 day') AND f.ufc_rounds_checked_at < ?1)
      OR (e.date >= date('now', '-45 day') AND f.ufc_rounds_checked_at < ?2))
  ORDER BY e.date DESC, f.ord`);
const markChecked = db.prepare("UPDATE fights SET ufc_rounds_checked_at = ? WHERE id = ?");
const storeRounds = db.prepare("UPDATE fights SET judge_rounds_json = ?, ufc_rounds_checked_at = ? WHERE id = ?");

const parse = (json: string | null, key: string): JudgeCard[] => {
  try { const cards = JSON.parse(json ?? "null")?.[key]; return Array.isArray(cards) ? cards : []; }
  catch { return []; /* malformed: treated as nothing stored */ }
};
const official = (fight: Pick<Candidate, "detail_json">) => parse(fight.detail_json, "judges");
const stored = (fight: Pick<Candidate, "judge_rounds_json">) => parse(fight.judge_rounds_json, "judges");
export const needsUfcJudgeRounds = (fight: Pick<Candidate, "detail_json" | "judge_rounds_json">): boolean =>
  !hasCompleteJudgeRounds(official(fight), stored(fight));

/** Attach one feed bout's cards to our fight. Returns whether anything new was stored. */
async function importFight(fight: Candidate, bout: UfcFeedBout, now: number): Promise<boolean> {
  const scores = await fetchFightRoundScores(bout.fightId);
  const order = scores && alignment(scores.f1Name, scores.f2Name, ...sides(fight))?.order;
  if (!scores || !order) throw new Error(`ufc.com fight ${bout.fightId} names ${scores ? `${scores.f1Name} vs ${scores.f2Name}` : "no fighters"}`);
  const incoming = scores.judges.map(card => order === 1 ? card : {
    ...card, f1Score: card.f2Score, f2Score: card.f1Score,
    rounds: card.rounds!.map(round => ({ ...round, f1Score: round.f2Score, f2Score: round.f1Score })),
  });
  // Another importer may have stored cards while the feed was being read.
  const current = db.prepare("SELECT detail_json, judge_rounds_json FROM fights WHERE id = ?").get(fight.id) as Pick<Candidate, "detail_json" | "judge_rounds_json">;
  const prior = stored(current);
  const merged = incoming.length ? mergeMmaJudgeRounds(official(current), prior, incoming, Number(fight.round)) : null;
  if (!merged) { markChecked.run(now, fight.id); return false; }
  let priorSource = "";
  try { priorSource = String(JSON.parse(current.judge_rounds_json ?? "null")?.source ?? ""); } catch { /* replaced */ }
  const source = prior.length && priorSource && !priorSource.includes("UFC") ? `${priorSource} + UFC` : "UFC";
  storeRounds.run(JSON.stringify({ source, sourceUrl: ufcFightFeedUrl(bout.fightId), fetchedAt: now, judges: merged }), now, fight.id);
  return true;
}

/** Read one card's feed for the given decisions of it. */
async function importEvent(ufcEventId: number, fights: Candidate[], now: number): Promise<{ stored: number; failed: number }> {
  const result = { stored: 0, failed: 0 };
  const bouts = await fetchEventFeedBouts(ufcEventId);
  const matched = new Map(matchBouts(bouts, fights).map(({ source, fight }) => [fight.id, source]));
  for (const fight of fights) {
    const bout = matched.get(fight.id);
    if (!bout) { markChecked.run(now, fight.id); continue; }
    try { if (await importFight(fight, bout, now)) result.stored += 1; }
    catch (error) {
      result.failed += 1;
      markChecked.run(now, fight.id);
      log(`ufc judge rounds ${fight.f1_name} vs ${fight.f2_name}: ${String(error)}`);
    }
  }
  return result;
}

let running = false;

/** One pass: decisions from the last three days every ten minutes, the last
 * 45 days every six hours, and up to `archiveCards` older cards never read. */
export async function syncUfcJudgeRounds({ now = Date.now(), archiveCards = 2 } = {}): Promise<{ events: number; stored: number; failed: number }> {
  const total = { events: 0, stored: 0, failed: 0 };
  if (running) return total;
  running = true;
  try {
    const rows = candidates.all(now - 10 * MINUTE, now - 6 * HOUR) as Candidate[];
    // A complete panel needs nothing from the feed; note it so it isn't
    // offered again (the first pass notes the whole archive at once).
    const due: Candidate[] = [];
    const complete: Candidate[] = [];
    for (const fight of rows) (needsUfcJudgeRounds(fight) ? due : complete).push(fight);
    if (complete.length) {
      db.exec("BEGIN IMMEDIATE");
      try { for (const fight of complete) markChecked.run(now, fight.id); db.exec("COMMIT"); }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    const recentFrom = new Date(now - 45 * 86_400_000).toISOString().slice(0, 10);
    const byEvent = new Map<number, Candidate[]>();
    for (const fight of due) byEvent.set(fight.ufc_event_id, [...(byEvent.get(fight.ufc_event_id) ?? []), fight]);
    let archive = 0;
    for (const [ufcEventId, fights] of byEvent) {
      if (fights[0].date < recentFrom && archive++ >= archiveCards) continue;
      total.events += 1;
      try {
        const result = await importEvent(ufcEventId, fights, now);
        total.stored += result.stored;
        total.failed += result.failed;
      } catch (error) {
        // The feed itself failed. Recent bouts stay due for the next pass;
        // archive bouts are left to Admin → Bugs' re-read action.
        total.failed += fights.length;
        log(`ufc judge rounds event ${ufcEventId}: ${String(error)}`);
        if (fights[0].date < recentFrom) for (const fight of fights) markChecked.run(now, fight.id);
      }
    }
    if (total.stored || total.failed) log(`ufc judge rounds: ${total.events} cards, ${total.stored} stored, ${total.failed} failed`);
    return total;
  } finally {
    running = false;
  }
}

/** Admin → Bugs: read this decision's cards from the feed now. */
export async function rereadUfcJudgeRounds(fightId: string): Promise<{ ok: boolean; message: string }> {
  const fight = oneFight.get(fightId) as Candidate | undefined;
  if (!fight) return { ok: false, message: "Not a decision on a card linked to ufc.com's feed." };
  try {
    const { stored, failed } = await importEvent(fight.ufc_event_id, [fight], Date.now());
    const now = db.prepare("SELECT detail_json, judge_rounds_json FROM fights WHERE id = ?").get(fightId) as Pick<Candidate, "detail_json" | "judge_rounds_json">;
    if (!needsUfcJudgeRounds(now)) return { ok: true, message: stored ? "Round cards stored from ufc.com's feed." : "Every card already has its rounds." };
    return { ok: false, message: failed ? "The bout's feed couldn't be read or named other fighters." : "ufc.com's feed has no round cards for this bout that agree with its official totals yet." };
  } catch (error) {
    return { ok: false, message: `ufc.com's feed couldn't be read: ${String(error)}` };
  }
}

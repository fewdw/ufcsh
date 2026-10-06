import { boutsBefore, completeRecordBefore, opponentOf, professionalBoutsBefore, sideOf, ufcBoutsBefore, type CareerBout, type FightIndex, type FightRecord, type IndexedFight, type Outcome } from "./fight-index.ts";

const emptyRecord = (): FightRecord => ({ wins: 0, losses: 0, draws: 0, ncs: 0 });
const resultKey: Record<Outcome, keyof FightRecord> = { win: "wins", loss: "losses", draw: "draws", nc: "ncs" };

/** Where someone stood going into a fight: their rank on the last list
 *  before it, and any belt then, before or to come. UFC only. */
export type Standing = { rank: string | null; division: string | null; belt: "champion" | "interim" | "former" | "future" | null };

export type RankOf = (fighterId: string, fight: IndexedFight) => { rank: string; division: string } | null;

/** One of the opponent's earlier bouts: its opponent links to a profile here,
 *  else to their Sherdog page. */
export type EarlierBout = {
  fight_id: string | null; date: string; outcome: Outcome; method: string | null;
  opponent: { id: string | null; name: string; source_url: string | null };
  standing: Standing | null;
};

const wonBelt = (fight: IndexedFight, id: string) =>
  fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim") && sideOf(fight, id).outcome === "win";

/** Every UFC opponent, newest first, with their records and standing going in
 *  and their earlier bouts. `record` (UFC, on the night) sums to the matchup's
 *  combined opponent record; `history` is their whole verified professional
 *  history, or their UFC bouts until that history is verified. */
export function opposition(index: FightIndex, fighterId: string, before?: { id: string; date: string; ord: number }, rankOf?: RankOf) {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return null;
  const fights = before ? boutsBefore(index, fighterId, before.date, before.ord) : fighter.fights;
  const firstBelts = new Map<string, IndexedFight | null>();
  const firstBelt = (id: string) => {
    if (!firstBelts.has(id)) firstBelts.set(id, index.fighters.get(id)?.fights.find(fight => wonBelt(fight, id)) ?? null);
    return firstBelts.get(id)!;
  };
  const standingOf = (id: string | null, date: string, fight?: IndexedFight): Standing | null => {
    if (!id) return null;
    const rank = fight && rankOf ? rankOf(id, fight) : null;
    const belt = firstBelt(id);
    const beltBefore = belt && (belt.date < date || (fight != null && belt.date === fight.date && belt.ord > fight.ord));
    const status: Standing["belt"] = rank?.rank === "C" || (fight && sideOf(fight, id).prior.reigningChampion) ? "champion"
      : rank?.rank === "IC" ? "interim" : beltBefore ? "former" : belt && belt.id !== fight?.id && belt.date >= date ? "future" : null;
    const ranked = rank && rank.rank !== "C" && rank.rank !== "IC" ? rank : null;
    return ranked || status ? { rank: ranked?.rank ?? null, division: ranked?.division ?? null, belt: status } : null;
  };
  const earlierBout = (bout: CareerBout): EarlierBout => {
    const id = bout.opponentId || null;
    return {
      fight_id: bout.ufcFightId, date: bout.date, outcome: bout.outcome, method: bout.method || null,
      opponent: { id, name: bout.opponentName, source_url: id ? null : bout.opponentUrl || null },
      standing: standingOf(id, bout.date, bout.ufcFightId ? index.byId?.get(bout.ufcFightId) : undefined),
    };
  };
  const total = emptyRecord();
  const rows = fights.map(fight => {
    const opponent = opponentOf(fight, fighterId);
    const record = emptyRecord();
    for (const prior of ufcBoutsBefore(index, opponent.id, fight.date, fight.ord)) record[resultKey[prior.outcome]]++;
    for (const key of Object.keys(total) as (keyof FightRecord)[]) total[key] += record[key];
    const verified = Boolean(opponent.id && index.fighters.get(opponent.id)?.careerVerified);
    const earlier = verified ? professionalBoutsBefore(index, opponent.id, fight.date, fight.ord) : ufcBoutsBefore(index, opponent.id, fight.date, fight.ord);
    return {
      fight_id: fight.id, date: fight.date, outcome: sideOf(fight, fighterId).outcome, method: fight.method,
      opponent: { id: opponent.id || null, name: opponent.name },
      record, pro_record: verified ? completeRecordBefore(index, opponent.id, fight.date, fight.ord) : null,
      standing: standingOf(opponent.id || null, fight.date, fight),
      /** Newest first. */
      history: earlier.map(earlierBout).reverse(),
    };
  }).reverse();
  return {
    fighter_id: fighterId, name: fighter.name,
    before: before ? { fight_id: before.id, date: before.date } : null,
    record: total, rows,
  };
}

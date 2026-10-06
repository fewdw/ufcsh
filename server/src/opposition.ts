import { boutsBefore, completeRecordBefore, opponentOf, professionalBoutsBefore, sideOf, ufcBoutsBefore, type CareerBout, type FightIndex, type FightRecord, type IndexedFight, type Outcome } from "./fight-index.ts";

const emptyRecord = (): FightRecord => ({ wins: 0, losses: 0, draws: 0, ncs: 0 });
const resultKey: Record<Outcome, keyof FightRecord> = { win: "wins", loss: "losses", draw: "draws", nc: "ncs" };

/** The one thing worth knowing about an opponent's standing, most telling
 *  first: a belt then, a rank then, a belt before, a belt to come. UFC only. */
export type OpponentTag =
  | { kind: "champion" | "interim" | "former" | "future" }
  | { kind: "rank"; rank: string; division: string };

export type RankOf = (opponentId: string, fight: IndexedFight) => { rank: string; division: string } | null;

/** Someone the opponent had beaten: a profile here, else their Sherdog page. */
export type EarlierWin = {
  fight_id: string | null; date: string; method: string | null;
  opponent: { id: string | null; name: string; source_url: string | null };
};

const earlierWin = (bout: CareerBout): EarlierWin => ({
  fight_id: bout.ufcFightId, date: bout.date, method: bout.method || null,
  opponent: { id: bout.opponentId || null, name: bout.opponentName, source_url: bout.opponentId ? null : bout.opponentUrl || null },
});

const wonBelt = (fight: IndexedFight, id: string) =>
  fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim") && sideOf(fight, id).outcome === "win";

/** Every UFC opponent, newest first, with their records going in and who they
 *  had beaten. `record` (UFC, on the night) sums to the matchup's combined
 *  opponent record; `wins` is their whole verified professional history, or
 *  their UFC bouts until that history is verified. */
export function opposition(index: FightIndex, fighterId: string, before?: { id: string; date: string; ord: number }, rankOf?: RankOf) {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return null;
  const fights = before ? boutsBefore(index, fighterId, before.date, before.ord) : fighter.fights;
  const firstBelts = new Map<string, IndexedFight | null>();
  const firstBelt = (id: string) => {
    if (!firstBelts.has(id)) firstBelts.set(id, index.fighters.get(id)?.fights.find(fight => wonBelt(fight, id)) ?? null);
    return firstBelts.get(id)!;
  };
  const total = emptyRecord();
  const rows = fights.map(fight => {
    const opponent = opponentOf(fight, fighterId);
    const record = emptyRecord();
    for (const prior of ufcBoutsBefore(index, opponent.id, fight.date, fight.ord)) record[resultKey[prior.outcome]]++;
    for (const key of Object.keys(total) as (keyof FightRecord)[]) total[key] += record[key];
    const verified = Boolean(opponent.id && index.fighters.get(opponent.id)?.careerVerified);
    const earlier = verified ? professionalBoutsBefore(index, opponent.id, fight.date, fight.ord) : ufcBoutsBefore(index, opponent.id, fight.date, fight.ord);
    let tag: OpponentTag | null = null;
    if (opponent.id) {
      const rank = rankOf ? rankOf(opponent.id, fight) : null;
      const belt = firstBelt(opponent.id);
      const beltBefore = belt && (belt.date < fight.date || (belt.date === fight.date && belt.ord > fight.ord));
      if (rank?.rank === "C" || opponent.prior.reigningChampion) tag = { kind: "champion" };
      else if (rank?.rank === "IC") tag = { kind: "interim" };
      else if (rank) tag = { kind: "rank", rank: rank.rank, division: rank.division };
      else if (beltBefore) tag = { kind: "former" };
      else if (belt && belt.id !== fight.id) tag = { kind: "future" };
    }
    return {
      fight_id: fight.id, date: fight.date, outcome: sideOf(fight, fighterId).outcome, method: fight.method,
      opponent: { id: opponent.id || null, name: opponent.name },
      record, pro_record: verified ? completeRecordBefore(index, opponent.id, fight.date, fight.ord) : null, tag,
      /** Newest first. */
      wins: earlier.filter(bout => bout.outcome === "win").map(earlierWin).reverse(),
    };
  }).reverse();
  return {
    fighter_id: fighterId, name: fighter.name,
    before: before ? { fight_id: before.id, date: before.date } : null,
    record: total, rows,
  };
}

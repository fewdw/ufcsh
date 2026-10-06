import { completeRecordBefore, opponentOf, professionalBouts, professionalBoutsBefore, sideOf, ufcBoutsBefore, type FightIndex, type FightRecord, type IndexedFight, type Outcome } from "./fight-index.ts";
import { storedOpponentRecords, storedRecordBefore } from "./opponent-records.ts";

const emptyRecord = (): FightRecord => ({ wins: 0, losses: 0, draws: 0, ncs: 0 });
const resultKey: Record<Outcome, keyof FightRecord> = { win: "wins", loss: "losses", draw: "draws", nc: "ncs" };

/** The one thing worth knowing about an opponent's standing, most telling
 *  first: a belt then, a rank then, a belt before, a belt to come. UFC only. */
export type OpponentTag =
  | { kind: "champion" | "interim" | "former" | "future" }
  | { kind: "rank"; rank: string; division: string };

export type RankOf = (opponentId: string, fight: IndexedFight) => { rank: string; division: string } | null;

const wonBelt = (fight: IndexedFight, id: string) =>
  fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim") && sideOf(fight, id).outcome === "win";

/** Every professional bout, newest first, each opponent with their record on
 *  the night. `record` is the opponent's UFC record entering a UFC bout in our
 *  data, and those alone sum to the matchup's combined opponent record; the
 *  professional record is shown where a verified or linked history has it. */
export function opposition(index: FightIndex, fighterId: string, before?: { id: string; date: string; ord: number }, rankOf?: RankOf) {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return null;
  const bouts = before ? professionalBoutsBefore(index, fighterId, before.date, before.ord) : professionalBouts(index, fighterId);
  const stored = storedOpponentRecords(bouts.map(bout => bout.ufcFightId ? "" : bout.opponentUrl ?? ""));
  const firstBelts = new Map<string, IndexedFight | null>();
  const firstBelt = (id: string) => {
    if (!firstBelts.has(id)) firstBelts.set(id, index.fighters.get(id)?.fights.find(fight => wonBelt(fight, id)) ?? null);
    return firstBelts.get(id)!;
  };
  const total = emptyRecord();
  const rows = bouts.map(bout => {
    const local = bout.ufcFightId ? index.byId?.get(bout.ufcFightId) ?? fighter.fights.find(fight => fight.id === bout.ufcFightId) : undefined;
    const opponent = local ? opponentOf(local, fighterId) : null;
    const opponentId = opponent?.id || bout.opponentId || null;
    let record: FightRecord | null = null;
    if (local) {
      record = emptyRecord();
      for (const prior of ufcBoutsBefore(index, opponent!.id, local.date, local.ord)) record[resultKey[prior.outcome]]++;
      for (const key of Object.keys(total) as (keyof FightRecord)[]) total[key] += record[key];
    }
    const pro = opponentId && index.fighters.get(opponentId)?.careerVerified
      ? completeRecordBefore(index, opponentId, bout.date, local?.ord)
      : !local && bout.opponentUrl ? storedRecordBefore(stored.get(bout.opponentUrl), bout.date) : null;
    let tag: OpponentTag | null = null;
    if (opponentId) {
      const rank = local && rankOf ? rankOf(opponentId, local) : null;
      const belt = firstBelt(opponentId);
      const beltBefore = belt && (belt.date < bout.date || (local != null && belt.date === local.date && belt.ord > local.ord));
      if (rank?.rank === "C" || opponent?.prior.reigningChampion) tag = { kind: "champion" };
      else if (rank?.rank === "IC") tag = { kind: "interim" };
      else if (rank) tag = { kind: "rank", rank: rank.rank, division: rank.division };
      else if (beltBefore) tag = { kind: "former" };
      else if (belt && belt.id !== local?.id) tag = { kind: "future" };
    }
    return {
      fight_id: local?.id ?? null, date: bout.date, outcome: local ? sideOf(local, fighterId).outcome : bout.outcome,
      method: local?.method ?? (bout.method || null), round: local?.round ?? null,
      promotion: bout.isUfc ? "ufc" as const : "outside" as const, event_name: local?.eventName ?? bout.eventName,
      opponent: { id: opponentId, name: opponent?.name || bout.opponentName, source_url: opponentId ? null : bout.opponentUrl ?? null },
      record, pro_record: pro, tag,
    };
  }).reverse();
  return {
    fighter_id: fighterId, name: fighter.name,
    before: before ? { fight_id: before.id, date: before.date } : null,
    record: total, rows,
  };
}

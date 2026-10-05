import { boutsBefore, opponentOf, sideOf, ufcBoutsBefore, type FightIndex, type FightRecord, type Outcome } from "./fight-index.ts";

const emptyRecord = (): FightRecord => ({ wins: 0, losses: 0, draws: 0, ncs: 0 });
const resultKey: Record<Outcome, keyof FightRecord> = { win: "wins", loss: "losses", draw: "draws", nc: "ncs" };

/** Evidence for the matchup's combined opponent record. Rematches count once
 * per meeting, and each opponent's history stops before that meeting. */
export function opposition(index: FightIndex, fighterId: string, before?: { id: string; date: string; ord: number }) {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return null;
  const fights = before ? boutsBefore(index, fighterId, before.date, before.ord) : fighter.fights;
  const record = emptyRecord();
  const rows = fights.map(fight => {
    const opponent = opponentOf(fight, fighterId);
    const opponentRecord = emptyRecord();
    const history = ufcBoutsBefore(index, opponent.id, fight.date, fight.ord).map(bout => {
      opponentRecord[resultKey[bout.outcome]]++;
      return {
        fight_id: bout.ufcFightId, date: bout.date, outcome: bout.outcome, method: bout.method,
        opponent: { id: bout.opponentId ?? null, name: bout.opponentName },
      };
    }).reverse();
    for (const key of Object.keys(record) as (keyof FightRecord)[]) record[key] += opponentRecord[key];
    return {
      fight_id: fight.id, date: fight.date, outcome: sideOf(fight, fighterId).outcome, method: fight.method,
      opponent: { id: opponent.id || null, name: opponent.name }, record: opponentRecord, history,
    };
  }).reverse();
  return {
    fighter_id: fighterId, name: fighter.name,
    before: before ? { fight_id: before.id, date: before.date } : null,
    record, rows,
  };
}

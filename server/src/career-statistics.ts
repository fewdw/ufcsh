import { addCareerTotals, emptyCareerTotals, fightCareerTotals } from "./career-metrics.ts";
import { boutsBefore, opponentOf, sideOf, type FightIndex } from "./fight-index.ts";

/** Rebuilt with the fight index on every data revision; no scraped averages to go stale. */
export function careerStatistics(index: FightIndex, fighterId: string, before?: { id: string; date: string; ord: number }) {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return null;
  const fights = before ? boutsBefore(index, fighterId, before.date, before.ord) : fighter.fights;
  const totals = emptyCareerTotals();
  const rows = fights.map(fight => {
    const own = sideOf(fight, fighterId);
    const opponent = opponentOf(fight, fighterId);
    const sample = fightCareerTotals(fight.elapsed, own.actions, opponent.actions);
    addCareerTotals(totals, sample);
    return {
      fight_id: fight.id, date: fight.date, event_name: fight.eventName,
      opponent: { id: opponent.id || null, name: opponent.name }, outcome: own.outcome,
      totals: sample,
      takedowns: own.actions.takedowns ?? null,
      control_seconds: own.actions.control?.scored ?? null,
    };
  }).reverse();
  return {
    fighter_id: fighterId, name: fighter.name,
    before: before ? { fight_id: before.id, date: before.date } : null,
    bouts: fights.length, totals, rows,
  };
}

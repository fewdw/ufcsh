import { completeRecordBefore, type FightIndex, type IndexedFight, type IndexedFighter } from "./fight-index.ts";
import type { JudgeCard } from "./labs-insights.ts";

/** Final-card agreement, including draws. Partial panels cannot establish it. */
export function cardVerdict(cards: JudgeCard[]) {
  if (cards.length !== 3) return "incomplete";
  const votes = cards.map(card => Math.sign(card.a - card.b));
  if (votes.filter(v => v === 0).length >= 2 || new Set(votes).size === 3) return "draw";
  if (votes.includes(1) && votes.includes(-1)) return "split";
  if (votes.includes(0)) return "majority";
  return "unanimous";
}

export function judgeBout(fight: IndexedFight, cards: JudgeCard[]) {
  const winner = fight.sides.find(side => side.outcome === "win");
  const loser = fight.sides.find(side => side.outcome === "loss");
  const sig = (side: typeof winner) => side?.actions.significantStrikes?.scored ?? null;
  const ctrl = (side: typeof winner) => side?.actions.control?.scored ?? null;
  const sigGap = sig(winner) != null && sig(loser) != null ? sig(winner)! - sig(loser)! : null;
  const controlGap = ctrl(winner) != null && ctrl(loser) != null ? ctrl(winner)! - ctrl(loser)! : null;
  return {
    id: fight.id, date: fight.date, event: fight.eventName, division: fight.weightClass,
    rounds: fight.scheduledRounds, title: fight.titleFight, method: fight.method,
    verdict: cardVerdict(cards), sig_gap: sigGap, control_gap: controlGap,
    sides: fight.sides.map(side => ({ id: side.id, name: side.name, outcome: side.outcome,
      sig: sig(side), control: ctrl(side) })),
    cards: cards.map((card, i) => {
      const others = cards.filter((_, j) => j !== i).map(c => Math.sign(c.a - c.b));
      return { ...card, dissent: others.length === 2 && others[0] === others[1] && others[0] !== Math.sign(card.a - card.b) };
    }),
  };
}

/** Freeze the verified record at the first UFC appearance, including source
 * order for same-day tournament bouts. Later outside-UFC fights never leak in. */
export function roadArrival(index: FightIndex, fighter: IndexedFighter) {
  const debut = fighter.fights[0];
  if (!fighter.careerVerified || !debut) return null;
  const record = completeRecordBefore(index, fighter.id, debut.date, debut.ord)!;
  const sourceDebut = fighter.careerBouts.find(bout => bout.ufcFightId === debut.id);
  const prior = fighter.careerBouts.filter(bout => bout.date < debut.date ||
    (sourceDebut && bout.date === debut.date && bout.sourceOrder > sourceDebut.sourceOrder));
  const first = prior.map(bout => bout.date).sort()[0];
  const age = fighter.birthDate ? (Date.parse(debut.date) - Date.parse(fighter.birthDate)) / (365.25 * 86_400_000) : null;
  return {
    id: fighter.id, name: fighter.name, debut: debut.date, division: debut.weightClass,
    age: age != null && age >= 15 && age < 55 ? age : null,
    experience: record.wins + record.losses + record.draws + record.ncs, record,
    runway: first ? (Date.parse(debut.date) - Date.parse(first)) / (365.25 * 86_400_000) : null,
  };
}

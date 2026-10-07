import { boutsBefore, opponentOf, sideOf, ufcBoutsBefore, type CareerBout, type FightIndex, type FightRecord, type IndexedFight, type Outcome } from "./fight-index.ts";

const emptyRecord = (): FightRecord => ({ wins: 0, losses: 0, draws: 0, ncs: 0 });
const resultKey: Record<Outcome, keyof FightRecord> = { win: "wins", loss: "losses", draw: "draws", nc: "ncs" };

/** Where someone stood going into a fight: their rank on the last list
 *  before it, and any belt then, before or to come. UFC only. An interim belt
 *  is told apart from the undisputed one, which outranks it: someone who had
 *  held both is a former champion. */
export type Standing = { rank: string | null; division: string | null; belt: "champion" | "interim" | "former" | "former-interim" | "future" | "future-interim" | null };

export type RankOf = (fighterId: string, fight: IndexedFight) => { rank: string; division: string } | null;

/** One of the opponent's earlier bouts: its opponent links to a profile here,
 *  else to their Sherdog page. */
export type EarlierBout = {
  fight_id: string | null; date: string; outcome: Outcome; method: string | null;
  opponent: { id: string | null; name: string; source_url: string | null };
  standing: Standing | null;
  /** That opponent's UFC record when the selected fighter met the listed one
   *  (or today, when asked for), when they have a profile here. */
  record: FightRecord | null;
};

const NOW = "9999-12-31";

const wonBelt = (fight: IndexedFight, id: string, type: "title" | "interim") =>
  fight.titleFight && fight.titleType === type && sideOf(fight, id).outcome === "win";

/** Every UFC opponent, newest first, with their records and standing going in
 *  and their earlier bouts. `record` (UFC, on the night) sums to the matchup's
 *  combined opponent record; `history` is their fights on UFC cards only, so
 *  everyone in it is a UFC fighter. Everyone in
 *  that history carries their UFC record on the night of the meeting.
 *  `current` swaps the night for today: every bout the opponent has had, and
 *  everyone's UFC record now. The total stays the one going in. */
export function opposition(index: FightIndex, fighterId: string, before?: { id: string; date: string; ord: number }, rankOf?: RankOf, current = false) {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return null;
  const fights = before ? boutsBefore(index, fighterId, before.date, before.ord) : fighter.fights;
  // An interim champion promoted without a fight shows only in their next
  // undisputed title bout: they enter it with an interim claim they never
  // lost and no undisputed champion across the cage, against someone with
  // no claim or the newer interim champion. Same reading as the title
  // narratives; the lineage's own interim holder is cleared too early for it.
  const promotedInto = (fight: IndexedFight, id: string) => {
    if (!fight.titleFight || fight.titleType !== "title") return false;
    const holders = index.holdersBefore(fight.weightClass, fight.date, fight.ord);
    const other = opponentOf(fight, id).id;
    if (holders.undisputed === id || holders.undisputed === other) return false;
    const claim = (who: string) => index.interimClaimBefore(who, fight.weightClass, fight.date, fight.ord);
    return claim(id) && (holders.interim === other || !claim(other));
  };
  /** The first bout that won each belt, or that they entered already promoted. */
  type Belts = Record<"title" | "interim", IndexedFight | null>;
  const firstBelts = new Map<string, Belts>();
  const firstBelt = (id: string) => {
    let belts = firstBelts.get(id);
    if (!belts) {
      const fights = index.fighters.get(id)?.fights ?? [];
      firstBelts.set(id, belts = { title: fights.find(fight => wonBelt(fight, id, "title") || promotedInto(fight, id)) ?? null, interim: fights.find(fight => wonBelt(fight, id, "interim")) ?? null });
    }
    return belts;
  };
  const standingOf = (id: string | null, date: string, fight?: IndexedFight): Standing | null => {
    if (!id) return null;
    const rank = fight && rankOf ? rankOf(id, fight) : null;
    const belts = firstBelt(id);
    const before = (belt: IndexedFight | null) => belt != null && (belt.date < date || (fight != null && belt.date === fight.date && belt.ord > fight.ord));
    const after = (belt: IndexedFight | null) => belt != null && !before(belt) && belt.date >= date;
    // Won on the night itself, the belt is neither held going in nor still to come.
    const tonight = (belt: IndexedFight | null) => belt != null && belt.id === fight?.id;
    const prior = fight ? sideOf(fight, id).prior : null;
    // Between a promotion and the title bout that shows it, the date it was
    // made is unknown: with the interim claim still theirs and the interim
    // belt no longer on the lineage, they are taken as already promoted.
    const promoted = fight != null && belts.title != null && !before(belts.title) && !tonight(belts.title) && promotedInto(belts.title, id)
      && index.interimClaimBefore(id, belts.title.weightClass, fight.date, fight.ord)
      && index.holdersBefore(belts.title.weightClass, fight.date, fight.ord).interim !== id;
    const status: Standing["belt"] = rank?.rank === "C" || (fight && promotedInto(fight, id)) || promoted ? "champion" : rank?.rank === "IC" || (prior?.interimChampion && !prior.champion) ? "interim"
      : prior?.reigningChampion ? "champion"
      : before(belts.title) ? "former" : before(belts.interim) ? "former-interim"
      : tonight(belts.title) ? null : after(belts.title) ? "future"
      : tonight(belts.interim) ? null : after(belts.interim) ? "future-interim" : null;
    const ranked = rank && rank.rank !== "C" && rank.rank !== "IC" ? rank : null;
    return ranked || status ? { rank: ranked?.rank ?? null, division: ranked?.division ?? null, belt: status } : null;
  };
  const ufcRecordBefore = (id: string, date: string, ord?: number) => {
    const record = emptyRecord();
    for (const prior of ufcBoutsBefore(index, id, date, ord)) record[resultKey[prior.outcome]]++;
    return record;
  };
  const earlierBout = (bout: CareerBout, date: string, ord?: number): EarlierBout => {
    const id = bout.opponentId || null;
    const local = bout.ufcFightId ? index.byId?.get(bout.ufcFightId) : undefined;
    return {
      fight_id: bout.ufcFightId, date: bout.date, outcome: bout.outcome, method: bout.method || null,
      opponent: { id, name: bout.opponentName, source_url: id ? null : bout.opponentUrl || null },
      standing: standingOf(id, bout.date, local),
      record: id ? ufcRecordBefore(id, date, ord) : null,
    };
  };
  const total = emptyRecord();
  const rows = fights.map(fight => {
    const opponent = opponentOf(fight, fighterId);
    const record = ufcRecordBefore(opponent.id, fight.date, fight.ord);
    for (const key of Object.keys(total) as (keyof FightRecord)[]) total[key] += record[key];
    const [date, ord] = current ? [NOW, undefined] : [fight.date, fight.ord];
    // Fights on UFC cards only: a Contender Series bout can be against someone who never fought in the UFC.
    const earlier = ufcBoutsBefore(index, opponent.id, date, ord).filter(bout => bout.ufcFightId);
    return {
      fight_id: fight.id, date: fight.date, outcome: sideOf(fight, fighterId).outcome, method: fight.method,
      opponent: { id: opponent.id || null, name: opponent.name },
      record: current ? ufcRecordBefore(opponent.id, NOW) : record,
      standing: standingOf(opponent.id || null, fight.date, fight),
      /** Newest first. */
      history: earlier.map(bout => earlierBout(bout, date, ord)).reverse(),
    };
  }).reverse();
  return {
    fighter_id: fighterId, name: fighter.name,
    before: before ? { fight_id: before.id, date: before.date } : null,
    current, record: total, rows,
  };
}

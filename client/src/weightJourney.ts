/** Weight classes describe the bout's division, not the fighter's weigh-in. */
const LIMITS: Record<string, number> = {
  Strawweight: 115, Flyweight: 125, Bantamweight: 135, Featherweight: 145,
  Lightweight: 155, Welterweight: 170, Middleweight: 185,
  "Light Heavyweight": 205, Heavyweight: 265,
};

type WeightBout = {
  fight_id: string | null;
  date: string;
  weight_class: string;
  upcoming: boolean;
  title_fight: boolean;
  title_type?: string | null;
  opponent: { name: string };
};

export type WeightMilestone = {
  fightId: string;
  date: string;
  from: string;
  to: string;
  direction: "up" | "down";
  kind: "move" | "challenge";
  opponent: string;
};

function divisionLimit(division: string): number | undefined {
  return LIMITS[division.replace(/^Women's /, "")];
}

/** Establish a division with two bouts (ignoring catchweights), or a title
 * fight. Highlight later sustained moves and title excursions. A solitary
 * early appearance never becomes an invented career move, and a return from
 * a title excursion does not create another weight-cut announcement. */
export function weightJourney(history: WeightBout[]): { base: string | null; milestones: WeightMilestone[] } {
  const bouts = [...history].reverse()
    .filter((bout) => !bout.upcoming && bout.fight_id && divisionLimit(bout.weight_class) != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const isTitle = (bout: WeightBout) => bout.title_fight
    && (!bout.title_type || bout.title_type === "title" || bout.title_type === "interim");
  const runs: { division: string; bouts: WeightBout[] }[] = [];
  for (const bout of bouts) {
    const last = runs.at(-1);
    if (last?.division === bout.weight_class) last.bouts.push(bout);
    else runs.push({ division: bout.weight_class, bouts: [bout] });
  }
  const established = runs.findIndex((run) => run.bouts.length >= 2 || run.bouts.some(isTitle));
  if (established < 0) return { base: null, milestones: [] };
  const base = runs[established].division;
  let current = base;
  const milestones: WeightMilestone[] = [];
  for (let i = established + 1; i < runs.length; i++) {
    const run = runs[i];
    if (run.division === current) continue;
    const direction = divisionLimit(run.division)! > divisionLimit(current)! ? "up" : "down";
    const titleExcursion = run.bouts.every(isTitle)
      && (run.bouts.length === 1 || runs[i + 1]?.division === current);
    if (titleExcursion) {
      for (const bout of run.bouts) milestones.push({
        fightId: bout.fight_id!, date: bout.date, from: current, to: run.division,
        direction, kind: "challenge", opponent: bout.opponent.name,
      });
    } else if (run.bouts.length >= 2) {
      const bout = run.bouts[0];
      milestones.push({
        fightId: bout.fight_id!, date: bout.date, from: current, to: run.division,
        direction, kind: "move", opponent: bout.opponent.name,
      });
      current = run.division;
    }
  }
  return { base, milestones };
}

export function weightMilestoneLabel(milestone: WeightMilestone): string {
  const direction = milestone.direction === "up" ? "Up" : "Down";
  return milestone.kind === "challenge"
    ? `${direction} for ${milestone.to.toLowerCase()} title`
    : `${direction} to ${milestone.to}`;
}

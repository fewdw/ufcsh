import type { Opposition } from "./api";

export type OppositionFilter = "all" | "win" | "loss";

/** Each meeting keeps its own attribution, including rematches. Filter the
 * opponent's result, independently of the selected fighter's result. */
export function oppositionRows(data: Opposition, outcome: OppositionFilter) {
  return [...data.rows].sort((a, b) => b.date.localeCompare(a.date)).flatMap(meeting => meeting.history
    .filter(bout => outcome === "all" ? bout.outcome === "win" || bout.outcome === "loss" : bout.outcome === outcome)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(bout => ({ meeting, bout })));
}

/** Show each opponent once, retaining separate results and evidence cutoffs
 * for rematches. The first appearance is the most recent meeting. */
export function oppositionGroups(data: Opposition, outcome: OppositionFilter) {
  type Row = ReturnType<typeof oppositionRows>[number];
  const groups = new Map<string, { opponent: Row["meeting"]["opponent"]; meetings: { meeting: Row["meeting"]; bouts: Row["bout"][] }[] }>();
  for (const { meeting, bout } of oppositionRows(data, outcome)) {
    const key = meeting.opponent.id ?? meeting.opponent.name;
    let group = groups.get(key);
    if (!group) {
      group = { opponent: meeting.opponent, meetings: [] };
      groups.set(key, group);
    }
    let entry = group.meetings.at(-1);
    if (entry?.meeting.fight_id !== meeting.fight_id) {
      entry = { meeting, bouts: [] };
      group.meetings.push(entry);
    }
    entry.bouts.push(bout);
  }
  return [...groups.values()];
}

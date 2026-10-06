import type { Opposition, OppositionBout, OppositionRecord, Standing } from "./api";

export type OppositionFilter = "all" | "win" | "loss";

/** Each opponent once, most recent meeting first, with every meeting the
 *  filter (the selected fighter's result) keeps. */
export function oppositionGroups(data: Opposition, outcome: OppositionFilter) {
  const groups = new Map<string, { opponent: OppositionBout["opponent"]; meetings: OppositionBout[] }>();
  for (const meeting of data.rows) {
    if (outcome !== "all" && meeting.outcome !== outcome) continue;
    const key = meeting.opponent.id ?? meeting.opponent.name;
    let group = groups.get(key);
    if (!group) groups.set(key, group = { opponent: meeting.opponent, meetings: [] });
    group.meetings.push(meeting);
  }
  return [...groups.values()];
}

export function recordText(record: OppositionRecord): string {
  return `${record.wins}-${record.losses}${record.draws ? `-${record.draws}` : ""}${record.ncs ? ` (${record.ncs} NC)` : ""}`;
}

const BELT: Record<NonNullable<Standing["belt"]>, { short: string; title: string }> = {
  champion: { short: "Champ", title: "UFC champion going in" },
  interim: { short: "Interim", title: "UFC interim champion going in" },
  former: { short: "Former champ", title: "Had held a UFC belt before this fight" },
  future: { short: "Future champ", title: "Went on to win a UFC belt" },
};

/** The chips beside a name: rank then, and any belt. */
export function standingChips(standing: Standing | null): { kind: "rank" | NonNullable<Standing["belt"]>; short: string; title: string }[] {
  if (!standing) return [];
  return [
    ...(standing.rank ? [{ kind: "rank" as const, short: `#${standing.rank}`, title: `Ranked #${standing.rank} at ${standing.division} on the last list before the fight` }] : []),
    ...(standing.belt ? [{ kind: standing.belt, ...BELT[standing.belt] }] : []),
  ];
}

import type { OpponentTag, Opposition, OppositionBout, OppositionRecord } from "./api";

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

export function tagText(tag: OpponentTag): { short: string; title: string } {
  switch (tag.kind) {
    case "champion": return { short: "Champ", title: "UFC champion going in" };
    case "interim": return { short: "Interim", title: "UFC interim champion going in" };
    case "rank": return { short: `#${tag.rank}`, title: `Ranked #${tag.rank} at ${tag.division} on the last list before the fight` };
    case "former": return { short: "Former champ", title: "Had held a UFC belt before this fight" };
    case "future": return { short: "Future champ", title: "Went on to win a UFC belt" };
  }
}

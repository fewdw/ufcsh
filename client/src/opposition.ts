import type { OpponentTag, Opposition, OppositionBout, OppositionRecord } from "./api";

export type OppositionFilter = "all" | "win" | "loss";

/** Each opponent once, most recent meeting first, with every meeting the
 *  filter keeps (the selected fighter's result) and, for each, the wins and
 *  losses the opponent had going in. Draws and no contests are left out. */
export function oppositionGroups(data: Opposition, outcome: OppositionFilter) {
  type Meeting = { meeting: OppositionBout; bouts: OppositionBout["history"] };
  const groups = new Map<string, { opponent: OppositionBout["opponent"]; outside: boolean; meetings: Meeting[] }>();
  for (const meeting of data.rows) {
    if (outcome !== "all" && meeting.outcome !== outcome) continue;
    const key = meeting.opponent.id ?? meeting.opponent.source_url ?? meeting.opponent.name;
    let group = groups.get(key);
    if (!group) groups.set(key, group = { opponent: meeting.opponent, outside: true, meetings: [] });
    // Purple only when every meeting was outside the UFC.
    group.outside &&= meeting.promotion === "outside";
    group.meetings.push({ meeting, bouts: meeting.history.filter(bout => bout.outcome === "win" || bout.outcome === "loss") });
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

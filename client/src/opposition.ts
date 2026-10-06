import type { OpponentTag, Opposition, OppositionRecord } from "./api";

export type OppositionFilter = "all" | "win" | "loss";

/** Every bout, newest first; the filter is the selected fighter's result. */
export function oppositionRows(data: Opposition, outcome: OppositionFilter) {
  return data.rows.filter(row => outcome === "all" || row.outcome === outcome);
}

export function recordText(record: OppositionRecord): string {
  return `${record.wins}-${record.losses}${record.draws ? `-${record.draws}` : ""}${record.ncs ? ` (${record.ncs} NC)` : ""}`;
}

export function tagText(tag: OpponentTag): { short: string; title: string } {
  switch (tag.kind) {
    case "champion": return { short: "Champ", title: "UFC champion going in" };
    case "interim": return { short: "Interim", title: "UFC interim champion going in" };
    case "rank": return { short: `#${tag.rank}`, title: `Ranked #${tag.rank} at ${tag.division} going in` };
    case "former": return { short: "Former champ", title: "Had held a UFC belt before this fight" };
    case "future": return { short: "Future champ", title: "Went on to win a UFC belt" };
  }
}

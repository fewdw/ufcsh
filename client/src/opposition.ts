import type { Opposition } from "./api";

/** Each meeting keeps its own attribution, including rematches. Filter the
 * opponent's result, independently of the selected fighter's result. */
export function oppositionRows(data: Opposition, outcome: "win" | "loss") {
  return [...data.rows].sort((a, b) => b.date.localeCompare(a.date)).flatMap(meeting => meeting.history
    .filter(bout => bout.outcome === outcome)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(bout => ({ meeting, bout })));
}

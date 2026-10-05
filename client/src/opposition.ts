import type { Opposition } from "./api";

/** Each meeting keeps its own attribution, including rematches. Filter the
 * opponent's result, independently of the selected fighter's result. */
export function oppositionRows(data: Opposition, outcome: "win" | "loss") {
  return data.rows.flatMap(meeting => meeting.history
    .filter(bout => bout.outcome === outcome)
    .map(bout => ({ meeting, bout })))
    .sort((a, b) => b.bout.date.localeCompare(a.bout.date));
}

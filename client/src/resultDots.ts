export type FormResult = {
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  /** False for a bout fought outside the UFC, which is drawn as a diamond. */
  ufc?: boolean;
};

/**
 * One bout as a single mark, carrying three things on three separate channels
 * so none of them has to be guessed from another:
 *
 *   colour — the result: won, lost, drew, no contest.
 *   fill   — how it ended: solid for a finish, hollow for a decision, and
 *            faded when the source never said.
 *   shape  — the promotion: a circle in the UFC, a rounded square outside it.
 *
 * Every dot also says all three in words, in its own title and in the label of
 * the row it belongs to, so nothing here depends on seeing the difference.
 */
export function resultDot(result: FormResult) {
  const finish = result.method === "KO/TKO" || result.method === "SUB";
  const decision = Boolean(result.method && /dec$/i.test(result.method));
  const outside = result.ufc === false;
  const label = result.outcome === "win" ? "Win" : result.outcome === "loss" ? "Loss" : result.outcome === "draw" ? "Draw" : result.outcome === "nc" ? "No contest" : "Unknown result";
  const color = result.outcome === "win" ? "border-emerald-500 bg-emerald-500" : result.outcome === "loss" ? "border-rose-500 bg-rose-500" : result.outcome === "draw" ? "border-amber-500 bg-amber-500" : "border-zinc-400 bg-zinc-400";
  // A square with softened corners reads as its own shape beside a circle at
  // eight pixels, where a rotated one only reads as a jagged dot.
  const shape = outside ? "rounded-[3px]" : "rounded-full";
  const unknown = !finish && !decision && result.outcome !== "draw" && result.outcome !== "nc";
  return {
    label: `${label}${result.method ? ` · ${result.method}` : " · method unknown"}${outside ? " · outside the UFC" : ""}`,
    className: `shrink-0 border-[1.5px] ${color} ${decision ? "!bg-transparent" : ""} ${unknown ? "opacity-60" : ""} ${shape}`,
    kind: finish ? "finish" : decision ? "decision" : "other",
    outside,
  };
}

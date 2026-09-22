export type FormResult = {
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  /** False for a bout fought outside the UFC, which is drawn as a square. */
  ufc?: boolean;
};

/** One bout as a dot: colour is the result, fill how it ended (solid finish,
 * hollow decision, faded unknown), shape the promotion (circle UFC, square
 * outside). Each dot also states all three in text. */
export function resultDot(result: FormResult) {
  const method = result.method?.trim().toUpperCase() ?? "";
  const finish = /^(?:KO\/TKO|KO|K\.O\.?|TKO|SUB|(?:TECH(?:NICAL|INAL)\s+)?SUBMISSION)(?:\s|\(|$)/.test(method);
  const decision = /(?:^|-)DEC$|^(?:TECHNICAL\s+)?DECISION(?:\s|\(|$)/.test(method);
  const outside = result.ufc === false;
  const label = result.outcome === "win" ? "Win" : result.outcome === "loss" ? "Loss" : result.outcome === "draw" ? "Draw" : result.outcome === "nc" ? "No contest" : "Unknown result";
  const color = result.outcome === "win" ? "border-emerald-500 bg-emerald-500" : result.outcome === "loss" ? "border-rose-500 bg-rose-500" : result.outcome === "draw" ? "border-amber-500 bg-amber-500" : "border-zinc-400 bg-zinc-400";
  // A square with softened corners reads as its own shape beside a circle at
  // eight pixels, where a rotated one only reads as a jagged dot.
  const shape = outside ? "rounded-[3px]" : "rounded-full";
  const unknown = !finish && !decision && result.outcome !== "draw" && result.outcome !== "nc";
  return {
    shortMethod: decision ? (/^(?:U|S|M)-DEC$/.test(method) ? method : "DEC")
      : finish ? (/SUB/.test(method) ? "SUB" : "KO/TKO") : result.method,
    label: `${label}${result.method ? ` · ${result.method}` : " · method unknown"}${outside ? " · outside the UFC" : ""}`,
    className: `shrink-0 border-[1.5px] ${color} ${decision ? "!bg-transparent" : ""} ${unknown ? "opacity-60" : ""} ${shape}`,
    kind: finish ? "finish" : decision ? "decision" : "other",
    outside,
  };
}

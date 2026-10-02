export type FormResult = {
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  /** False for a bout fought outside the UFC, which is drawn as a square. */
  ufc?: boolean;
};

/** A no contest's reason in a word, first match wins. Records spell the same
 * cause dozens of ways ("Accidental Knee to the Groin", "Yvel Kicked in
 * Groin"); the full text stays in each dot's label. */
const NC_REASONS: [RegExp, string][] = [
  [/drug test/i, "Doping"],
  [/overturn/i, "Overturned"],
  [/weight/i, "Weight"],
  [/groin/i, "Groin"],
  [/\beye\b|thumb/i, "Eye poke"],
  [/head\s?butt|clash of heads/i, "Headbutt"],
  [/rain/i, "Rain"],
  [/\bfell\b/i, "Fell"],
  [/ring broke|cage|surface/i, "Ring"],
  [/riot/i, "Riot"],
  [/double/i, "Double KO"],
  [/judging|scoring/i, "Judging"],
  [/timekeeping/i, "Timing"],
  [/referee|premature/i, "Referee"],
  [/illegal|soccer|back of (?:the )?head|spine|after (?:the )?bell|grounded/i, "Foul"],
  [/\bcut\b/i, "Cut"],
  [/injur/i, "Injury"],
];

/** A no contest's method as one word; a cause no rule knows is dropped, since
 * the NC mark already says what happened. Short UFC codes such as CNC stay. */
function ncReason(method: string | null) {
  if (!method) return null;
  const reason = NC_REASONS.find(([pattern]) => pattern.test(method));
  if (reason) return reason[1];
  return /^(?:no contest|nc|nd|no decision)\b/i.test(method) ? null : method;
}

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
    shortMethod: result.outcome === "nc" ? ncReason(result.method) : decision ? (/^(?:U|S|M)-DEC$/.test(method) ? method : "DEC")
      : finish ? (/SUB/.test(method) ? "SUB" : "KO/TKO") : result.method,
    label: `${label}${result.method ? ` · ${result.method}` : " · method unknown"}${outside ? " · outside the UFC" : ""}`,
    className: `shrink-0 border-[1.5px] ${color} ${decision ? "!bg-transparent" : ""} ${unknown ? "opacity-60" : ""} ${shape}`,
    kind: finish ? "finish" : decision ? "decision" : "other",
    outside,
  };
}

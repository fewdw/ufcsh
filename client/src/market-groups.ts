import type { ExtraMarket } from "./polymarket-types.ts";

const GROUPS = [
  "Fight outcome",
  "Total rounds",
  "Finish timing",
  "Round winners",
  "Other",
] as const;
export function groupMarkets(markets: ExtraMarket[]) {
  const groups = new Map<string, ExtraMarket[]>();
  for (const market of markets) {
    const group =
      market.question === "Will the fight end in a decision or draw?" ||
      market.type === "ufc_go_the_distance" ||
      market.type === "ufc_method_of_victory" ||
      market.type === "ufc_method_of_finish"
        ? GROUPS[0]
        : market.type === "totals"
          ? GROUPS[1]
          : market.type === "ufc_round_of_finish"
            ? GROUPS[2]
            : market.type === "ufc_round_of_victory"
              ? GROUPS[3]
              : GROUPS[4];
    const rows = groups.get(group) ?? [];
    rows.push(market);
    groups.set(group, rows);
  }
  return GROUPS.flatMap((label) =>
    groups.has(label) ? [{ label, markets: groups.get(label)! }] : [],
  );
}

/** Only shorten known question grammar; preserve unfamiliar source wording. */
export function marketLabel(question: string) {
  return question
    .replace(/^Will the fight end in a decision or draw\?$/, "Decision or draw")
    .replace(/^Will the fight be won by (.+)\?$/, "$1")
    .replace(/^Will (.+) win by (.+)\?$/, "$1 · $2")
    .replace(/^Will (.+) win in Round (\d+)\?$/, "$1 · round $2")
    .replace(/^Will the fight end before Round (\d+)\?$/, "Before round $1")
    .replace(/^O\/U (\d+(?:\.\d+)?) Rounds$/, "$1 rounds");
}

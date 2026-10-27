import { Moneyline, moneylineLeg } from "./MatchupOdds";

export default function OddsPair({ f1, f2, f1Name = "left fighter", f2Name = "right fighter", fightId }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  f1Name?: string;
  f2Name?: string;
  /** Present only for a fight still open for betting; enables click-to-parlay. */
  fightId?: string;
}) {
  // A side with no line yet still holds a dash, so every row lines up.
  const fightLabel = `${f1Name} vs ${f2Name}`;
  // Plain prices on the row itself, split by a hairline; the hover tint and
  // the parlay ring say they can be pressed.
  const price = `min-w-14 rounded-md px-2 py-1 text-sm font-semibold leading-5 tabular-nums${fightId ? " hover:bg-zinc-100" : ""}`;
  return (
    <div className="flex items-center justify-center gap-1 text-center">
      <Moneyline leg={moneylineLeg(fightId, fightLabel, 1, f1Name, f1)} value={f1 || "-"} name={f1Name} className={`${price} ${f1 ? "text-zinc-900" : "text-zinc-300"}`} />
      <span className="h-3.5 w-px bg-zinc-200" aria-hidden="true" />
      <Moneyline leg={moneylineLeg(fightId, fightLabel, 2, f2Name, f2)} value={f2 || "-"} name={f2Name} className={`${price} ${f2 ? "text-zinc-900" : "text-zinc-300"}`} />
    </div>
  );
}

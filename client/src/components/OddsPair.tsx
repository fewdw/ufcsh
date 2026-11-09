import { Moneyline, moneylineLeg } from "./MatchupOdds";

export default function OddsPair({ f1, f2, f1Name = "left fighter", f2Name = "right fighter", fightId }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  f1Name?: string;
  f2Name?: string;
  /** Present only for a fight still open for betting; enables click-to-parlay. */
  fightId?: string;
}) {
  // No line on either side: a quiet note the box's height, so rows still line
  // up without a column of empty "– | –" boxes. One missing side keeps its dash.
  if (!f1 && !f2) return <div className="grid h-6 w-full place-items-center text-[11px] text-zinc-400 @3xl:h-9">No odds yet</div>;
  const fightLabel = `${f1Name} vs ${f2Name}`;
  // The favourite's price leads; the other side steps back a shade.
  const n1 = Number(f1), n2 = Number(f2);
  const tone = (own: number, other: number, value: string | null | undefined) =>
    !value ? "text-zinc-300" : Number.isFinite(own) && Number.isFinite(other) && own > other ? "text-zinc-500" : "";
  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-stretch text-center">
      <Moneyline leg={moneylineLeg(fightId, fightLabel, 1, f1Name, f1)} value={f1 || "-"} name={f1Name} fill="left" className={`${tone(n1, n2, f1)} rounded-md px-1.5 py-0.5 font-display text-[15px] font-semibold leading-5 tabular-nums transition-colors hover:bg-zinc-100 @3xl:px-2 @3xl:py-1 @3xl:text-[22px] @3xl:leading-7`} />
      <span className="odds-pair-divider h-4 self-center" aria-hidden="true" />
      <Moneyline leg={moneylineLeg(fightId, fightLabel, 2, f2Name, f2)} value={f2 || "-"} name={f2Name} fill="right" className={`${tone(n2, n1, f2)} rounded-md px-1.5 py-0.5 font-display text-[15px] font-semibold leading-5 tabular-nums transition-colors hover:bg-zinc-100 @3xl:px-2 @3xl:py-1 @3xl:text-[22px] @3xl:leading-7`} />
    </div>
  );
}

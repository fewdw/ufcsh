import { Link } from "react-router-dom";
import type { FightOdds } from "../api";
import { kalshiRead } from "../marketQuote";
import { percentPair } from "../methodOdds";
import { useNow } from "../useNow";
import KalshiLogo from "./KalshiLogo";

/** Kalshi's chances for a bout still to come, in the same pill Polymarket's
 *  sit in, for a reader who chose Kalshi. Nothing while its read is stale. */
export default function KalshiTeaser({ fightId, kalshi, f1Name, f2Name }: {
  fightId: string; kalshi: NonNullable<FightOdds>["kalshi"] | undefined; f1Name: string; f2Name: string;
}) {
  const now = useNow(true, 60_000);
  const chances = kalshiRead(kalshi, false, now).chances;
  if (!chances) return null;
  const [one, two] = percentPair(chances);
  return (
    <Link
      to={`/fights/${fightId}?tab=odds`}
      aria-label={`Kalshi: ${f1Name} ${one}%, ${f2Name} ${two}%`}
      className="matchup-polymarket inline-flex w-fit max-w-full flex-nowrap items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200 px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      <KalshiLogo />
      <span className="font-semibold tabular-nums text-blue-700 dark:text-blue-400">{one}%</span>
      <span aria-hidden="true">/</span>
      <span className="font-semibold tabular-nums text-red-700 dark:text-red-400">{two}%</span>
    </Link>
  );
}

import { Link } from "react-router-dom";
import { useApi, type Matchup } from "../api";
import { signedPercent } from "../bets";
import { topSplit, type BettingCard } from "../bettingHub";
import { lastName } from "../format";
import FanAvatar from "./FanAvatar";
import { PANEL_SHELL, PanelHeading } from "./FightStats";

const METHOD_SHORT = { ko: "KO", submission: "Sub", decision: "Dec" } as const;
const STATE_TONE: Record<string, string> = { won: "text-emerald-600", lost: "text-rose-600" };

/** What the best play-money bettors and predictors have on this bout: shown
 *  only once one of them has made a call. */
export default function TopBettors({ fight }: { fight: Matchup }) {
  const { data } = useApi<BettingCard>(fight.event?.id && /^[a-f0-9]{16}$/.test(fight.event.id) ? `/api/betting/events/${fight.event.id}` : null, 60_000);
  const bout = data?.bouts.find(entry => entry.fightId === fight.id);
  if (!bout || (!bout.bettors.picks.length && !bout.predictors.length)) return null;
  const split = topSplit(bout);
  const name = (side: 1 | 2) => side === 1 ? bout.f1.name : bout.f2.name;
  return <section className={`${PANEL_SHELL} overflow-hidden`}>
    <PanelHeading title="Top bettors and predictors" subtitle={split ? split.title : `Top ${data!.top} by return and accuracy`}
      aside={<Link to={`/betting?event=${fight.event.id}`} className="text-xs font-medium text-zinc-500 underline">Whole card</Link>} />
    <ul className="divide-y divide-zinc-100">
      {bout.bettors.picks.map(pick => <li key={`${pick.betId}${pick.selection}`} className="flex items-center gap-2 px-4 py-2 sm:px-5">
        <span className="w-4 shrink-0 text-right text-[10px] font-semibold tabular-nums text-zinc-400">{pick.rank}</span>
        <FanAvatar src={pick.scorer.imageUrl} name={pick.scorer.displayName} />
        <Link to={`/profiles/${pick.scorer.handle}?tab=bets`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800 hover:underline">{pick.scorer.displayName}</Link>
        <span className="min-w-0 truncate text-xs text-zinc-700" title={pick.selection}>{pick.selection} <span className="tabular-nums text-zinc-500">{pick.price}</span></span>
        <span className="hidden shrink-0 text-[11px] tabular-nums text-zinc-400 sm:inline" title={`${pick.scorer.displayName}'s return on stake`}>{pick.legs > 1 ? `${pick.legs}-leg parlay` : `$${pick.stake.toFixed(2)}`} · {signedPercent(pick.roi)}</span>
        {pick.state === "won" || pick.state === "lost" ? <span className={`shrink-0 text-[10px] font-bold uppercase ${STATE_TONE[pick.state]}`}>{pick.state}</span> : null}
      </li>)}
      {bout.predictors.map(pick => <li key={pick.scorer.publicId} className="flex items-center gap-2 px-4 py-2 sm:px-5">
        <span className="w-4 shrink-0 text-right text-[10px] font-semibold tabular-nums text-zinc-400">{pick.rank}</span>
        <FanAvatar src={pick.scorer.imageUrl} name={pick.scorer.displayName} />
        <Link to={`/profiles/${pick.scorer.handle}?tab=predictions`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800 hover:underline">{pick.scorer.displayName}</Link>
        <span className="shrink-0 text-xs text-zinc-700">Predicts {lastName(name(pick.side))}{pick.method ? ` · ${METHOD_SHORT[pick.method]}` : ""}{pick.round ? ` R${pick.round}` : ""}</span>
        <span className="hidden shrink-0 text-[11px] tabular-nums text-zinc-400 sm:inline">right {pick.accuracy}%</span>
        {pick.state === "won" || pick.state === "lost" ? <span className={`shrink-0 text-[10px] font-bold uppercase ${STATE_TONE[pick.state]}`}>{pick.state}</span> : null}
      </li>)}
    </ul>
  </section>;
}

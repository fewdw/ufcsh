import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import type { Matchup } from "../api";
import { apiCache, useApi } from "../api";
import { lastName } from "../format";
import { cardWinner, decimalScore, fightFinish } from "../scoring";
import type { FanCard, ScoreSummary } from "../scoring";
import { PANEL_SHELL, PanelHeading, sectionLabel } from "./FightStats";
import ProgressiveImage from "./ProgressiveImage";

const ScoreEditor = lazy(() => import("./ScoreEditor"));

/** The community's card and the reader's own card. Nothing else: the numbers
 *  and the seven buttons that produce them are the whole feature. */
export default function FightScoring({ fight }: { fight: Matchup }) {
  const { data, error, retry } = useApi<ScoreSummary>(`/api/fights/${fight.id}/scores`, 5_000);
  if (!data)
    return (
      <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
        {error ? <>Scores could not be loaded. <button className="underline" onClick={retry}>Retry</button></> : "Loading scores…"}
      </section>
    );
  const { eligibility, totals } = data;
  const live = eligibility.state === "live";
  const verdict = totals.completeCards > 0;
  // A stopped fight's remaining rounds were never fought: the finish is the
  // last line of the card, in place of rows that could never carry a score.
  const finish = fightFinish(fight, eligibility);
  const rows = eligibility.state === "completed" ? eligibility.available : eligibility.scheduled;
  return (
    <>
      <section className={PANEL_SHELL}>
        <PanelHeading
          title="Community scorecard"
          subtitle={`${totals.scorers.toLocaleString()} ${totals.scorers === 1 ? "scorer" : "scorers"}`}
          aside={live ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Live
            </span>
          ) : undefined}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-5 pt-5 pb-4 text-center">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-f1">{fight.f1.name}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-f1-ink">{decimalScore(totals.avg1)}</p>
          </div>
          <span aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-f2">{fight.f2.name}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-f2-ink">{decimalScore(totals.avg2)}</p>
          </div>
        </div>
        {verdict && totals.distributionCards > 0 ? (
          <div className="px-5 pb-5 text-center">
          <p className="flex items-baseline justify-center gap-2.5 text-lg font-semibold tabular-nums"
            aria-label={`${totals.f1} cards for ${fight.f1.name}, ${totals.draws} even, ${totals.f2} for ${fight.f2.name}`}>
            <span className="text-f1-ink">{totals.f1}</span>
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span className="text-zinc-500">{totals.draws}</span>
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span className="text-f2-ink">{totals.f2}</span>
          </p>
          {totals.distributionCards < totals.completeCards ? <p className="mt-1 text-[9px] text-zinc-400">Outcome split from {totals.distributionCards.toLocaleString()} ufc.sh {totals.distributionCards === 1 ? "card" : "cards"}</p> : null}
          </div>
        ) : null}
        <div className="divide-y divide-zinc-100 border-t border-zinc-100">
          {Array.from({ length: rows }, (_, index) => {
            const n = index + 1;
            const row = data.rounds.find(item => item.round === n);
            const open = n <= eligibility.available;
            return (
              <div key={n} className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-5 py-2.5 text-sm tabular-nums ${open ? "" : "opacity-40"}`}>
                <span className={`text-left ${row && row.total1 >= row.total2 ? "font-semibold text-f1-ink" : "text-zinc-500"}`}>{decimalScore(row?.total1)}</span>
                <span className={sectionLabel}>R{n}</span>
                <span className={`text-right ${row && row.total2 >= row.total1 ? "font-semibold text-f2-ink" : "text-zinc-500"}`}>{decimalScore(row?.total2)}</span>
              </div>
            );
          })}
          {finish ? (
            <p className="px-5 py-2.5 text-center text-xs">
              <span className={`font-semibold ${finish.side === 1 ? "text-f1-ink" : "text-f2-ink"}`}>{finish.name}</span>
              <span className="text-zinc-400"> · {finish.method} · R{finish.round}{finish.time ? ` · ${finish.time}` : ""}</span>
            </p>
          ) : null}
        </div>
        {eligibility.reason ? <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">{eligibility.reason}</p> : null}
      </section>
      {data.cards.length ? <FanCards fight={fight} cards={data.cards} localCards={totals.localCards} totalScorers={totals.scorers} /> : null}
      {eligibility.available > 0 ? (
        <Suspense fallback={<div className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`}>Loading your scorecard…</div>}>
          <ScoreEditor fight={fight} eligibility={eligibility} onSaved={() => { void apiCache.loadAfterWrite(`/api/fights/${fight.id}/scores`); }} />
        </Suspense>
      ) : null}
    </>
  );
}

/** The cards behind the average, newest first. Each one opens its scorer's
 *  public profile: every other fight they have scored. */
function FanCards({ fight, cards, localCards, totalScorers }: { fight: Matchup; cards: FanCard[]; localCards: number; totalScorers: number }) {
  return (
    <section className={PANEL_SHELL}>
      <PanelHeading
        title="Fan scorecards"
        subtitle={`${cards.length < localCards ? `${cards.length} of ` : ""}${localCards.toLocaleString()}${totalScorers > localCards ? ` · ${totalScorers.toLocaleString()} total` : ""}`}
      />
      <ul className="grid grid-flow-col auto-cols-[minmax(10.5rem,1fr)] overflow-x-auto border-t border-zinc-100 sm:auto-cols-[minmax(12rem,1fr)] xl:grid-cols-5 xl:auto-cols-auto xl:overflow-visible">
        {cards.map(card => {
          const winner = cardWinner(card);
          return (
            <li key={card.scorer.publicId} className="min-w-0 border-r border-zinc-100 last:border-r-0">
              <Link to={`/profiles/${card.scorer.handle}?tab=scorecards`} className="block min-w-0 px-4 py-3 transition-colors hover:bg-zinc-50">
                <span className="flex min-w-0 items-center gap-2">
                  {card.scorer.imageUrl
                    ? <ProgressiveImage src={card.scorer.imageUrl} alt="" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 rounded-full bg-zinc-100 object-cover ring-1 ring-zinc-200" />
                    : <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-full bg-zinc-100 ring-1 ring-zinc-200" />}
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-700">{card.scorer.displayName}</span>
                  <span className="ml-auto flex shrink-0 items-baseline gap-1 text-sm tabular-nums">
                    <span className={winner === 1 ? "font-semibold text-f1-ink" : "text-zinc-400"}>{card.total1}</span>
                    <span className="text-zinc-300" aria-hidden="true">–</span>
                    <span className={winner === 2 ? "font-semibold text-f2-ink" : "text-zinc-400"}>{card.total2}</span>
                  </span>
                </span>
                <span className={`mt-2 block truncate ${sectionLabel}`}>
                  {winner === 0 ? "Even card" : `${lastName(winner === 1 ? fight.f1.name : fight.f2.name)} ahead`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

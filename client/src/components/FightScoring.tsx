import { Fragment } from "react";
import { Lock } from "lucide-react";
import type { Matchup } from "../api";
import { apiCache, useApi } from "../api";
import { decimalScore, fightFinish } from "../scoring";
import type { ScoreSummary } from "../scoring";
import { PANEL_SHELL, PanelHeading, sectionLabel } from "./FightStats";
// Part of the matchup page's own code: a lazily loaded editor held the Score
// tab on a fallback for at least React's 300 ms reveal throttle.
import ScoreEditor from "./ScoreEditor";
import { lastName } from "../format";


/** The community card and the reader's scoring controls. Result uses
 *  communityOnly to show existing scores without the editor.
 *
 *  Blind scoring, automatic and only while a bout is live: the round being
 *  fought is hidden from everyone (the server leaves it out) until it ends. */
export default function FightScoring({ fight, communityOnly = false }: { fight: Matchup; communityOnly?: boolean }) {
  const { data, error, retry } = useApi<ScoreSummary>(`/api/fights/${fight.id}/scores`, 5_000);
  // Result includes existing community scores, while Score keeps the full
  // loading/error state and the controls for creating a card.
  if (communityOnly && (!data || data.totals.scorers === 0)) return null;
  if (!data)
    return (
      <section className={`appear-late ${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
        {error ? <>Scores could not be loaded. <button className="underline" onClick={retry}>Retry</button></> : "Loading scores…"}
      </section>
    );
  const { eligibility, totals } = data;
  const live = eligibility.state === "live";
  // A stopped fight's remaining rounds were never fought: the finish is the
  // last line of the card, in place of rows that could never carry a score.
  const finish = fightFinish(fight, eligibility);
  const rows = eligibility.state === "completed" ? eligibility.available : eligibility.scheduled;
  const closed = Math.min(data.closed ?? eligibility.available, eligibility.available);
  // The newest open round of a live bout, still private to each scorer.
  const fighting = live && eligibility.available > closed ? closed + 1 : null;
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
        {/* One line per fighter, a column per round and the total last, the
            way the fight list reads a card. The scores sit centred in the panel:
            an empty column the width of the names balances them on the right. */}
        <div className="@container overflow-x-auto">
          <div className="grid px-4 pb-3 pt-2 tabular-nums @[32rem]:px-5"
            style={{ gridTemplateColumns: `minmax(4.5rem, 1fr) repeat(${rows + (finish ? 1 : 0)}, minmax(2.25rem, 3.5rem)) minmax(3rem, 4.5rem) minmax(0, 1fr)` }}>
            <span />
            {Array.from({ length: rows }, (_, index) => (
              <span key={index} className={`self-end py-1 text-center ${sectionLabel} !text-[9px] !tracking-normal ${index < eligibility.available ? "" : "opacity-50"}`}>R{index + 1}</span>
            ))}
            {finish ? (
              <span className={`self-end py-1 text-center ${sectionLabel} !text-[9px] !tracking-normal`}>
                R{finish.round}{finish.time ? <span className="block font-normal">{finish.time}</span> : null}
              </span>
            ) : null}
            <span className={`self-end py-1 text-center ${sectionLabel} !text-[9px] !tracking-normal`}>Total</span>
            <span />
            {([1, 2] as const).map((side) => {
              const fighter = side === 1 ? fight.f1 : fight.f2;
              const ink = side === 1 ? "text-f1-ink" : "text-f2-ink";
              const lead = (mine: number | null | undefined, theirs: number | null | undefined) =>
                mine != null && theirs != null && mine > theirs ? `font-semibold ${ink}` : "text-zinc-400";
              const total = side === 1 ? [totals.avg1, totals.avg2] : [totals.avg2, totals.avg1];
              return (
                <Fragment key={side}>
                  <span className={`flex min-w-0 items-center border-t border-zinc-100 py-2 pr-2 text-sm font-medium ${side === 1 ? "text-f1" : "text-f2"}`} title={fighter.name}>
                    <span className="truncate @[36rem]:hidden">{lastName(fighter.name)}</span>
                    <span className="hidden truncate @[36rem]:inline">{fighter.name}</span>
                  </span>
                  {Array.from({ length: rows }, (_, index) => {
                    const round = index + 1;
                    const row = data.rounds.find(item => item.round === round);
                    const [mine, theirs] = side === 1 ? [row?.total1, row?.total2] : [row?.total2, row?.total1];
                    const cell = `flex items-center justify-center border-t border-zinc-100 py-2 text-xs @[32rem]:text-sm`;
                    if (round === fighting) return (
                      <span key={index} className={cell} title={`Round ${round} stays hidden from everyone until it ends`}>
                        <Lock className="h-3.5 w-3.5 text-zinc-300" aria-label="Hidden until the round ends" />
                      </span>
                    );
                    return (
                      <span key={index} className={`${cell} ${lead(mine, theirs)} ${index < eligibility.available ? "" : "opacity-50"}`}>
                        {decimalScore(mine)}
                      </span>
                    );
                  })}
                  {finish ? (
                    <span className={`flex items-center justify-center border-t border-zinc-100 py-2 text-xs @[32rem]:text-sm ${finish.side === side ? `font-semibold ${ink}` : "text-zinc-300"}`}>
                      {finish.side === side ? finish.method : "—"}
                    </span>
                  ) : null}
                  <span className={`flex items-center justify-center border-t border-zinc-100 py-2 text-base @[32rem]:text-lg ${lead(total[0], total[1])}`}>
                    {decimalScore(total[0])}
                  </span>
                  <span className="border-t border-zinc-100" />
                </Fragment>
              );
            })}
          </div>
        </div>
        {eligibility.reason ? <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">{eligibility.reason}</p> : null}
        {fighting ? (
          <p className="flex items-start gap-1.5 border-t border-zinc-100 px-4 py-3 text-xs leading-5 text-zinc-500 @[32rem]:px-5">
            <Lock className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />Round {fighting} stays hidden from everyone until it ends, so nobody's card follows the crowd.
          </p>
        ) : null}
      </section>
      {!communityOnly && eligibility.available > 0 ? (
        <ScoreEditor fight={fight} eligibility={eligibility} onSaved={() => { void apiCache.loadAfterWrite(`/api/fights/${fight.id}/scores`); }} />
      ) : null}
    </>
  );
}

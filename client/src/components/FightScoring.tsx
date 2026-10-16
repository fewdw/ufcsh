import { Fragment, useCallback, useState } from "react";
import { EyeOff, Lock } from "lucide-react";
import type { Matchup } from "../api";
import { apiCache, useApi } from "../api";
import { accountsEnabled } from "../auth";
import { storeLocal } from "../preferences";
import { useSessionUser } from "../profile";
import { blindRounds, decimalScore, fightFinish } from "../scoring";
import type { ScoreSummary } from "../scoring";
import { useSettings, type BlindScoring } from "../settings";
import { PANEL_SHELL, PanelHeading, sectionLabel } from "./FightStats";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
// Part of the matchup page's own code: a lazily loaded editor held the Score
// tab on a fallback for at least React's 300 ms reveal throttle.
import ScoreEditor from "./ScoreEditor";
import { lastName } from "../format";


const BLIND_OPTIONS: { id: BlindScoring; label: string; title: string }[] = [
  { id: "live", label: "Live fights", title: "Hide the community's rounds you haven't scored while a fight is live" },
  { id: "always", label: "All fights", title: "Hide the community's rounds you haven't scored on every fight, including replays" },
  { id: "off", label: "Off", title: "Always show the community's closed rounds" },
];

/** How far the reader has chosen to see the community's card on a bout,
 *  kept per bout so a later round is hidden again until it is scored. */
const revealKey = (fightId: string) => `ufcsh:reveal:${fightId}`;
function readRevealed(fightId: string): number {
  try { return Number(localStorage.getItem(revealKey(fightId))) || 0; } catch { return 0; }
}

/** The community card and the reader's scoring controls. Result uses
 *  communityOnly to show existing scores without the editor.
 *
 *  Blind scoring: the round being fought is hidden from everyone (the server
 *  leaves it out), and a signed-in scorer sees a closed round only once
 *  they've scored it or chosen Reveal, so their card is their own. */
export default function FightScoring({ fight, communityOnly = false }: { fight: Matchup; communityOnly?: boolean }) {
  const { data, error, retry } = useApi<ScoreSummary>(`/api/fights/${fight.id}/scores`, 5_000);
  const { settings, update } = useSettings();
  const { userId } = useSessionUser();
  // Both belong to one bout: moving to another starts from its own.
  const [card, setCard] = useState<{ id: string; rounds: number[] } | null>(null);
  const scored = card?.id === fight.id ? card.rounds : null;
  const onCard = useCallback((rounds: number[]) => setCard({ id: fight.id, rounds }), [fight.id]);
  const [shown, setShown] = useState(() => ({ id: fight.id, through: readRevealed(fight.id) }));
  const revealed = shown.id === fight.id ? shown.through : readRevealed(fight.id);
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
  // Blind scoring is for someone who can score here: signed in, on the Score tab.
  const scorer = accountsEnabled && userId != null && !communityOnly && eligibility.available > 0;
  const blind = scorer && (settings.blindScoring === "always" || (settings.blindScoring === "live" && live));
  const hidden = blindRounds({ blind, closed, scored, revealedThrough: revealed });
  const reveal = () => { setShown({ id: fight.id, through: closed }); storeLocal(revealKey(fight.id), String(closed)); };
  const hiddenMark = <EyeOff className="h-3.5 w-3.5 text-zinc-300" aria-label="Hidden until you score it" />;
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
                    if (hidden.includes(round)) return <span key={index} className={cell} title={`Score round ${round}, or reveal, to see the community's`}>{hiddenMark}</span>;
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
                  {hidden.length ? (
                    <span className="flex items-center justify-center border-t border-zinc-100 py-2" title="The total would give away the rounds you haven't scored">{hiddenMark}</span>
                  ) : (
                    <span className={`flex items-center justify-center border-t border-zinc-100 py-2 text-base @[32rem]:text-lg ${lead(total[0], total[1])}`}>
                      {decimalScore(total[0])}
                    </span>
                  )}
                  <span className="border-t border-zinc-100" />
                </Fragment>
              );
            })}
          </div>
        </div>
        {eligibility.reason ? <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">{eligibility.reason}</p> : null}
        {fighting || scorer ? (
          <div className="space-y-2 border-t border-zinc-100 px-4 py-3 text-xs leading-5 text-zinc-500 @container @[32rem]:px-5">
            {fighting ? <p className="flex items-start gap-1.5"><Lock className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />Round {fighting} stays hidden from everyone until it ends.</p> : null}
            {hidden.length ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-start gap-1.5"><EyeOff className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />Rounds you haven't scored stay hidden, so your card is your own.</span>
                <button type="button" onClick={reveal} className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">Reveal</button>
              </p>
            ) : null}
            {scorer ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Blind scoring</span>
                <div className={segmentedGroup} role="group" aria-label="Blind scoring">
                  {BLIND_OPTIONS.map((option) => (
                    <button key={option.id} type="button" title={option.title} aria-pressed={settings.blindScoring === option.id}
                      onClick={() => update("blindScoring", option.id)}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${settings.blindScoring === option.id ? segmentedSelected : segmentedIdle}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
      {!communityOnly && eligibility.available > 0 ? (
        <ScoreEditor fight={fight} eligibility={eligibility} onCard={onCard}
          onSaved={() => { void apiCache.loadAfterWrite(`/api/fights/${fight.id}/scores`); }} />
      ) : null}
    </>
  );
}

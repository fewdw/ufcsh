import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Matchup } from "../api";
import { accountsEnabled, useAccount } from "../auth";
import { lastName } from "../format";
import type { MyScorecard, RoundScore, ScoreSummary } from "../scoring";
import { fightFinish, scoreTotal } from "../scoring";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import { BUTTON_PRIMARY_LARGE, BUTTON_QUIET } from "../ui";

const primary = BUTTON_PRIMARY_LARGE;
const quiet = BUTTON_QUIET;
/** The ten-point must, the first fighter's widest round on the left through to
 *  the second's, so the buttons run the way the fighters do everywhere else and
 *  the draw sits in the center. A deduction ends each side. */
const CHOICES: [number, number][] = [[10, 8], [10, 9], [10, 10], [9, 10], [8, 10]];
/** Seven controls have to fit the narrowest phone without a score breaking
 *  over two lines, so the five scores share what is left after the two
 *  deductions, which are given a fixed, smaller width of their own. */
const CELL = "rounded-xl py-2.5 text-center tabular-nums transition disabled:opacity-40";
// `min-w-fit` is what keeps "10–10" whole: the five share the row evenly, but
// none of them is ever squeezed narrower than the score printed on it.
const SCORE_CELL = `${CELL} min-w-fit flex-1 basis-0 whitespace-nowrap px-0.5 text-[11px] min-[380px]:text-xs sm:px-1 sm:text-sm`;
const DEDUCT_CELL = `${CELL} w-8 shrink-0 px-0.5 min-[380px]:w-9 sm:w-14`;
type Props = { fight: Matchup; eligibility: ScoreSummary["eligibility"]; onSaved: () => void };

/** The account itself lives in the header; this is the same session, scoped to
 *  one matchup. */
export default function ScoreEditor(props: Props) {
  if (!accountsEnabled) return null;
  return <Gate {...props} />;
}

function Gate(props: Props) {
  const { isLoaded, user, signIn } = useAccount();
  if (!isLoaded || !user)
    return (
      // Laid out like the Predict tab's signed-out panel: its heading, then
      // the one thing to do.
      <section className={PANEL_SHELL}>
        <PanelHeading title="Your scorecard" />
        <div className="px-4 py-4 text-center">
          {isLoaded
            ? <button type="button" className={primary} onClick={signIn}>Sign in to score</button>
            : <span className="appear-late text-sm text-zinc-400">Loading…</span>}
        </div>
      </section>
    );
  return (
    <section className={PANEL_SHELL}>
      <Editor key={`${props.fight.id}:${user.id}`} {...props} userId={user.id} />
    </section>
  );
}

function Editor({ fight, eligibility, onSaved, userId }: Props & { userId: string }) {
  const { getToken } = useAuth();
  const [saved, setSaved] = useState<MyScorecard | null>(null);
  const [rounds, setRounds] = useState<RoundScore[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const storageKey = `ufc-score:${userId}:${fight.id}`;
  const url = `/api/fights/${fight.id}/scores/mine`;
  const dirty = saved !== null && JSON.stringify(rounds) !== JSON.stringify(saved.rounds);
  const request = useCallback(async (method = "GET", body?: unknown, signal?: AbortSignal) => {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    const timeout = AbortSignal.timeout(20_000);
    const response = await fetch(url, { method, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409 && mounted.current) setConflict(true);
      throw new Error(data.error ?? "Unable to save. Please retry.");
    }
    return data as MyScorecard;
  }, [getToken, url]);
  const load = useCallback(async (signal?: AbortSignal, restore = true) => {
    setLoading(true); setError("");
    try {
      const card = await request("GET", undefined, signal);
      if (!mounted.current || signal?.aborted) return;
      setSaved(card); setRounds(card.rounds); setConflict(false);
      if (restore) {
        // An interrupted session (a redirect, a reload) keeps its unsaved work;
        // the Save button carrying "Unsaved" is what says so.
        try {
          const draft = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
          if (draft?.revision === card.revision && Array.isArray(draft.rounds)) setRounds(draft.rounds);
        } catch { /* Storage is optional. */ }
      }
    } catch (err) { if (mounted.current && !signal?.aborted) setError(err instanceof Error ? err.message : "Unable to load your scorecard."); }
    finally { if (mounted.current && !signal?.aborted) setLoading(false); }
  }, [request, storageKey]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [load]);
  useEffect(() => {
    if (!saved || loading) return;
    try { if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ revision: saved.revision, rounds })); else sessionStorage.removeItem(storageKey); } catch { /* Private browsing may disable storage. */ }
  }, [dirty, rounds, saved, storageKey, loading]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const updateRound = (n: number, update: Partial<RoundScore>) => setRounds(previous => {
    const old = previous.find(r => r.round === n);
    return [...previous.filter(r => r.round !== n), { round: n, f1: 10, f2: 9, deduct1: 0, deduct2: 0, ...old, ...update }].sort((a, b) => a.round - b.round);
  });
  /** Choosing the score already on the card takes that round back off it. */
  const clearRound = (n: number) => setRounds(previous => previous.filter(r => r.round !== n));
  const submit = async (remove = false) => {
    if (!saved || busy) return;
    setBusy(true); setError("");
    try {
      const card = await request(remove ? "DELETE" : "PUT", { revision: saved.revision, rounds: rounds.filter(r => r.round <= eligibility.available) });
      if (!mounted.current) return;
      setSaved(card); setRounds(card.rounds); setConflict(false);
      onSaved();
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Unable to save. Please retry."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const finish = fightFinish(fight, eligibility);
  // Nothing past a stoppage can be scored, so nothing past it is offered.
  const openRounds = eligibility.state === "completed" ? eligibility.available : eligibility.scheduled;
  const scored = rounds.filter(r => r.round <= eligibility.available);
  const total1 = scoreTotal(scored, 1), total2 = scoreTotal(scored, 2);
  const consecutive = scored.every((r, index) => r.round === index + 1);
  const complete = eligibility.state !== "completed" || scored.length === eligibility.available;
  return (
    <>
      <PanelHeading
        title="Your scorecard"
        aside={saved?.scorer ? (
          // Every other fight this reader has scored, at the address anyone can open.
          <Link to={`/profiles/${saved.scorer.handle}?tab=scorecards`} className="text-xs font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">
            All your scorecards
          </Link>
        ) : undefined}
      />
      {loading ? <p className="appear-late p-5 text-sm text-zinc-500">Loading…</p> : !saved ? (
        <p role="alert" className="p-5 text-sm text-rose-600">
          {error} <button className="underline" onClick={() => void load(undefined, false)}>Retry</button>
        </p>
      ) : (
        <div className="p-4 sm:p-5">
          <fieldset disabled={busy || conflict} className="min-w-0">
            <legend className="sr-only">Round scores</legend>
            <div className="divide-y divide-zinc-100">
              {Array.from({ length: openRounds }, (_, index) => {
                const n = index + 1;
                const r = rounds.find(value => value.round === n);
                const open = n <= eligibility.available;
                // A deduction ends each fighter's side of the round, in their
                // colour, and applies only once that round has been scored.
                const deduct = (side: 1 | 2) => {
                  const value = !r ? 0 : side === 1 ? r.deduct1 : r.deduct2;
                  const name = lastName(side === 1 ? fight.f1.name : fight.f2.name);
                  const tone = side === 1 ? "bg-f1-soft text-f1-ink" : "bg-f2-soft text-f2-ink";
                  return (
                    <button type="button" disabled={!open || !r}
                      aria-label={`Point deduction for ${name} in round ${n}: ${value}. Select to deduct a point.`}
                      title={`Point deduction — ${name}`}
                      onClick={() => updateRound(n, side === 1 ? { deduct1: (value + 1) % 3 } : { deduct2: (value + 1) % 3 })}
                      className={`${DEDUCT_CELL} ${value ? `${tone} text-sm font-semibold` : "bg-zinc-100 text-[10px] font-semibold uppercase tracking-tight text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"}`}>
                      {value ? `−${value}` : <>
                        <span className="hidden sm:inline">Deduct</span>
                        <span className="text-xs sm:hidden" aria-hidden="true">−</span>
                      </>}
                    </button>
                  );
                };
                return (
                  <div key={n} className={`py-3 ${open ? "" : "opacity-40"}`} role="group" aria-label={`Round ${n}`}>
                    <div className="flex gap-1 sm:gap-1.5">
                      {deduct(1)}
                      {CHOICES.map(([a, b]) => {
                        const on = r?.f1 === a && r?.f2 === b;
                        const tone = a === b ? "bg-zinc-300 text-zinc-900" : a > b ? "bg-f1-soft text-f1-ink" : "bg-f2-soft text-f2-ink";
                        return (
                          <button key={`${a}-${b}`} type="button" aria-pressed={on} disabled={!open}
                            aria-label={`Round ${n}: ${lastName(fight.f1.name)} ${a}, ${lastName(fight.f2.name)} ${b}`}
                            onClick={() => on ? clearRound(n) : updateRound(n, { f1: a, f2: b })}
                            className={`${SCORE_CELL} ${on ? `${tone} font-semibold shadow-sm` : "bg-zinc-100 font-medium text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"}`}>
                            {a}<span className="mx-px opacity-40 sm:mx-0.5">–</span>{b}
                          </button>
                        );
                      })}
                      {deduct(2)}
                    </div>
                  </div>
                );
              })}
              {finish ? (
                <div className="py-3" role="group" aria-label={`Round ${finish.round}`}>
                  <p className="text-center text-[13px]">
                    <span className={`font-semibold ${finish.side === 1 ? "text-f1-ink" : "text-f2-ink"}`}>{finish.name}</span>
                    <span className="text-zinc-400"> · {finish.method}{finish.time ? ` · ${finish.time}` : ""}</span>
                  </p>
                </div>
              ) : null}
            </div>
          </fieldset>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3">
            <p className="flex items-baseline gap-2 tabular-nums">
              {scored.length ? <>
                <span className="text-lg font-semibold text-f1-ink">{total1}</span>
                <span className="text-zinc-300">–</span>
                <span className="text-lg font-semibold text-f2-ink">{total2}</span>
                {/* Who the card has in front, which is the point of keeping one. */}
                {total1 === total2 ? null : (
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${total1 > total2 ? "text-f1-ink" : "text-f2-ink"}`}>
                    {lastName(total1 > total2 ? fight.f1.name : fight.f2.name)}
                  </span>
                )}
              </> : null}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-1">
              {/* Nothing that cannot be pressed right now is on the card. */}
              {!busy && !conflict && rounds.length > 0 ? <button type="button" className={quiet} onClick={() => setRounds([])}>Reset</button> : null}
              {!busy && !conflict && saved.rounds.length > 0 ? <button type="button" className={quiet} onClick={() => void submit(true)}>Remove</button> : null}
              <button type="button" className={primary} disabled={busy || conflict || !dirty || !scored.length || !consecutive || !complete}
                title={!consecutive ? "Score earlier rounds first" : !complete ? "Score every round" : undefined}
                onClick={() => void submit()}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
          {eligibility.state === "live" && eligibility.available < eligibility.scheduled ? <p className="mt-2 text-[11px] text-zinc-400">Rounds open as the feed reports them.</p> : null}
          {error ? (
            <p role="alert" className="mt-2 text-right text-[11px] text-rose-600">
              {error} {conflict ? <button className="underline" disabled={busy} onClick={() => void load(undefined, false)}>Reload</button> : null}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

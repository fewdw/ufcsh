import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useApi, type Matchup } from "../api";
import { accountsEnabled, useAccount } from "../auth";
import { recallMine, rememberMine, useSessionUser } from "../profile";
import { lastName } from "../format";
import { METHOD_LABEL, predictionLabel, predictionPoints, sharePct } from "../predictions";
import type { MyPrediction, PredictionDistribution, PredictionMethod, PredictionSummary } from "../predictions";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import { BUTTON_PRIMARY_LARGE } from "../ui";

const METHOD_SHORT: Record<PredictionMethod, string> = { ko: "KO", submission: "Sub", decision: "Dec" };
/** A method or round choice: a full-width cell in an even grid. */
const option = "rounded-xl border px-2 py-2 text-center text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 sm:text-[13px]";
const optionIdle = "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50";
/** Defined in index.css: ink on paper, inverted in the dark theme. */
const optionOn = "pick-option-on";
const primary = BUTTON_PRIMARY_LARGE;

export default function FightPredictions({ fight }: { fight: Matchup }) {
  const { data, error, retry } = useApi<PredictionSummary>(`/api/fights/${fight.id}/predictions`, 3_000);
  if (!data) return <section className={`appear-late ${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {error ? <>{error} <button className="underline" onClick={retry}>Retry</button></> : "Loading predictions…"}
  </section>;
  return <>
    {data.total ? <CommunityPicks distribution={data.distribution} scheduledRounds={data.scheduledRounds} /> : null}
    {accountsEnabled ? <PredictionGate key={fight.id} fight={fight} status={data} onSaved={retry} />
      : <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`}>Sign-in must be configured to save predictions.</section>}
  </>;
}

type Share = { key: string; label: string; short?: string; count: number; color: string; counterClockwise?: boolean };

const SECTION_LABEL = "mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400";
/** Each corner's colour, darkest for a knockout down to lightest for no
 *  method named: the method pie reads by fighter and by how at once. */
const SHADES: Record<string, [string, string]> = {
  ko: ["#1e40af", "#991b1b"], submission: ["#3b82f6", "#ef4444"],
  decision: ["#93c5fd", "#fca5a5"], none: ["#dbeafe", "#fee2e2"],
};
const picksWord = (count: number) => `${count} ${count === 1 ? "pick" : "picks"}`;

/** A full pie from twelve o'clock: red's slices run clockwise from the top,
 *  blue's counter-clockwise, so the two corners meet at twelve and the split
 *  reads like a tug of war. Slices are parted by a hairline of the panel's
 *  own colour. */
function Pie({ entries, total, size = 76 }: { entries: Share[]; total: number; size?: number }) {
  const shown = entries.filter(entry => entry.count > 0);
  const c = size / 2;
  const r = c - 1;
  const TOP = -Math.PI / 2;
  let clockwise = TOP;
  let counter = TOP;
  const point = (at: number) => `${(c + r * Math.cos(at)).toFixed(2)} ${(c + r * Math.sin(at)).toFixed(2)}`;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img"
    aria-label={shown.map(entry => `${entry.label} ${sharePct(entry.count, total)}%`).join(", ")}>
    {shown.length === 1
      ? <circle cx={c} cy={c} r={r} fill={shown[0].color}><title>{`${shown[0].label}: ${picksWord(shown[0].count)} (100%)`}</title></circle>
      : shown.map(entry => {
        const sweep = (entry.count / total) * Math.PI * 2;
        let from: number;
        if (entry.counterClockwise) { counter -= sweep; from = counter; } else { from = clockwise; clockwise += sweep; }
        const large = sweep > Math.PI ? 1 : 0;
        return <path key={entry.key} d={`M ${c} ${c} L ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(from + sweep)} Z`}
          fill={entry.color} strokeWidth={1.5} strokeLinejoin="round" className="stroke-white dark:stroke-[#18181b]">
          <title>{`${entry.label}: ${picksWord(entry.count)} (${sharePct(entry.count, total)}%)`}</title>
        </path>;
      })}
  </svg>;
}

/** A small key under a chart: swatches, a short name, the share. */
function Key({ rows }: { rows: { key: string; swatches: string[]; label: string; value: string; ink?: string; muted?: boolean }[] }) {
  return <ul className="mt-2 w-full space-y-0.5 text-[11px] leading-4" aria-hidden="true">
    {rows.map(row => <li key={row.key} className={`flex min-w-0 items-center gap-1 ${row.muted ? "text-zinc-400" : "text-zinc-600"}`}>
      <span className="flex shrink-0 -space-x-0.5">{row.swatches.map(color => <span key={color} className="h-2 w-2 rounded-full ring-1 ring-white dark:ring-[#18181b]" style={{ backgroundColor: color }} />)}</span>
      <span className="min-w-0 truncate">{row.label}</span>
      <span className={`ml-auto shrink-0 font-semibold tabular-nums ${row.ink ?? "text-zinc-900"}`}>{row.value}</span>
    </li>)}
  </ul>;
}

/** Rounds are ordered, so they stand side by side: a pair of bars for each,
 *  blue's and red's, with the round's share of all picks over the pair. */
function RoundBars({ rounds, total }: { rounds: { key: string; label: string; short: string; count: number; sides: number[] }[]; total: number }) {
  const most = Math.max(1, ...rounds.flatMap(round => round.sides));
  return <div className="flex h-[76px] items-end justify-center gap-1.5" role="img"
    aria-label={rounds.map(round => `${round.label} ${sharePct(round.count, total)}%`).join(", ")}>
    {rounds.map(round => <div key={round.key} className="flex h-full flex-col items-center justify-end gap-0.5" title={`${round.label}: ${picksWord(round.count)}`}>
      {round.count ? <span className="text-[9px] font-semibold leading-none tabular-nums text-zinc-700">{sharePct(round.count, total)}</span> : null}
      <div className="flex h-full items-end gap-px">
        {round.sides.map((count, index) => <span key={index} className="block w-[7px] rounded-t-[2px]"
          style={{ height: `${count ? Math.max(6, (count / most) * 100) : 3}%`, backgroundColor: count ? (index === 0 ? "var(--color-f1)" : "var(--color-f2)") : "var(--color-plot-axis)" }} />)}
      </div>
    </div>)}
  </div>;
}

/** Who wins, how and when, side by side in one row. */
function CommunityPicks({ distribution, scheduledRounds }: { distribution: PredictionDistribution; scheduledRounds: number | null }) {
  const total = distribution.total;
  const [f1, f2] = distribution.fighters;
  const fighters: Share[] = distribution.fighters.map((entry, index) => ({
    key: entry.fighterId || `f${index}`, label: entry.name, count: entry.count,
    color: index === 0 ? "var(--color-f1)" : "var(--color-f2)", counterClockwise: index === 0,
  }));
  const order = ["ko", "submission", "decision", null] as const;
  const methodName = (method: PredictionMethod | null) => method ? METHOD_LABEL[method] : "No method";
  // Each corner's calls from twelve o'clock, knockout nearest the top: the
  // same halves as the winner pie.
  const calls: Share[] = distribution.fighters.flatMap((side, index) => order.map(method => ({
    key: `${index}-${method ?? "none"}`, label: `${side.name} · ${methodName(method)}`,
    count: side.methods?.find(entry => entry.method === method)?.count ?? 0,
    color: SHADES[method ?? "none"][index], counterClockwise: index === 0,
  })));
  const methods = distribution.methods;
  // "D" gathers every pick that names no round: decisions and open finishes.
  const rounds = distribution.rounds.map(entry => ({
    key: entry.round == null ? "none" : `r${entry.round}`,
    label: entry.round == null ? "Decision or no round named" : `Round ${entry.round}`,
    short: entry.round == null ? "D" : `${entry.round}`,
    count: entry.count,
    sides: distribution.fighters.map(side => side.rounds?.find(pick => pick.round === entry.round)?.count ?? 0),
  }));
  const roundsKnown = scheduledRounds === 3 || scheduledRounds === 5;
  const byFighter = Boolean(f1?.methods && f2?.methods);

  return (
    <section className={PANEL_SHELL}>
      <PanelHeading title="Community picks" divider={false} aside={<span className="text-xs tabular-nums text-zinc-500">{picksWord(total)}</span>} />
      <div className={`grid gap-3 px-4 pb-4 sm:gap-6 sm:px-5 ${roundsKnown ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="flex min-w-0 flex-col items-center">
          <h3 className={SECTION_LABEL}>Winner</h3>
          <Pie entries={fighters} total={total} />
          <Key rows={fighters.map((entry, index) => ({
            key: entry.key, swatches: [entry.color], label: lastName(entry.label),
            value: `${sharePct(entry.count, total)}%`, ink: index === 0 ? "text-f1-ink" : "text-f2-ink", muted: !entry.count,
          }))} />
        </div>
        <div className="flex min-w-0 flex-col items-center">
          <h3 className={SECTION_LABEL}>Method</h3>
          <Pie entries={byFighter ? calls : methods.map(entry => ({ key: entry.method ?? "none", label: methodName(entry.method), count: entry.count, color: SHADES[entry.method ?? "none"][0] }))} total={total} />
          <Key rows={methods.filter(entry => entry.method || entry.count).map(entry => ({
            key: entry.method ?? "none", swatches: byFighter ? SHADES[entry.method ?? "none"] : [SHADES[entry.method ?? "none"][0]],
            label: entry.method ? METHOD_SHORT[entry.method] : "Any", value: `${sharePct(entry.count, total)}%`, muted: !entry.count,
          }))} />
        </div>
        {roundsKnown ? <div className="flex min-w-0 flex-col items-center">
          <h3 className={SECTION_LABEL}>Round %</h3>
          <RoundBars rounds={rounds} total={total} />
          <div className="mt-1 flex justify-center gap-1.5 text-[10px] leading-none text-zinc-500" aria-hidden="true">
            {rounds.map(entry => <span key={entry.key} className="w-[15px] text-center">{entry.short}</span>)}
          </div>
        </div> : null}
      </div>
    </section>
  );
}

type EditorProps = { fight: Matchup; status: PredictionSummary; onSaved: () => void };
function PredictionGate(props: EditorProps) {
  const { signIn } = useAccount();
  // The account this browser last saw stands in until Clerk answers, so the
  // pick is on screen at once; with none, the reader is taken as signed out.
  const { userId } = useSessionUser();
  if (!userId) return <section className={PANEL_SHELL}>
    <PredictionHeading open={props.status.open} />
    <div className="px-4 py-4 text-center">
      <button type="button" className={primary} onClick={signIn}>Sign in to {props.status.open ? "predict" : "view your pick"}</button>
    </div>
  </section>;
  return <PredictionEditor key={`${props.fight.id}:${userId}`} {...props} userId={userId} />;
}

/** The one place the open/closed state is stated. */
function PredictionHeading({ open }: { open: boolean }) {
  return <PanelHeading title="Your prediction" divider={false} aside={
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${open ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
      {open ? "Open" : "Closed"}
    </span>
  } />;
}

function PredictionEditor({ fight, status, onSaved, userId }: EditorProps & { userId: string }) {
  const { getToken } = useAuth();
  // The last pick seen here is shown at once and fetched again behind it.
  const [seed] = useState(() => recallMine<MyPrediction>(userId, `prediction:${fight.id}`));
  const [saved, setSaved] = useState<MyPrediction | null>(seed);
  const [fighterId, setFighter] = useState(seed?.pick?.fighterId ?? "");
  const [method, setMethod] = useState<PredictionMethod | null>(seed?.pick?.method ?? null);
  const [round, setRound] = useState<number | null>(seed?.pick?.round ?? null);
  /** Set once the reader changes a choice: a refresh then leaves it alone. */
  const edited = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(true);
  const request = useCallback(async (verb = "GET", body?: unknown, signal?: AbortSignal) => {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    const timeout = AbortSignal.timeout(20_000);
    const response = await fetch(`/api/fights/${fight.id}/predictions/mine`, {
      method: verb, cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409 && mounted.current) { setConflict(true); onSaved(); }
      throw new Error(data.error ?? "Unable to save prediction.");
    }
    return data as MyPrediction;
  }, [fight.id, getToken, onSaved]);
  const accept = (data: MyPrediction, keepEdits = false) => {
    setSaved(data); setConflict(false);
    rememberMine(userId, `prediction:${fight.id}`, data);
    if (keepEdits && edited.current) return;
    edited.current = false;
    setFighter(data.pick?.fighterId ?? ""); setMethod(data.pick?.method ?? null); setRound(data.pick?.round ?? null);
  };
  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try { const data = await request("GET", undefined, signal); if (mounted.current && !signal?.aborted) accept(data, true); }
    catch (err) { if (mounted.current && !signal?.aborted) setError(err instanceof Error ? err.message : "Unable to load prediction."); }
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [load, status.open, fight.status]);
  const submit = async (remove = false) => {
    if (!saved || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await request(remove ? "DELETE" : "PUT", { revision: saved.revision, fighterId, method, round,
        matchupKey: `${fight.event.id}:${fight.f1.id}:${fight.f2.id}` });
      if (!mounted.current) return;
      accept(data); setMessage(remove ? "Prediction removed." : "Prediction saved."); onSaved();
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Unable to save prediction."); }
    finally { if (mounted.current) setBusy(false); }
  };

  // One rule decides every control: a closed fight edits nothing, ever.
  const open = status.open && saved?.open !== false;
  const dirty = fighterId !== (saved?.pick?.fighterId ?? "") || method !== (saved?.pick?.method ?? null) || round !== (saved?.pick?.round ?? null);
  const rules = status.rules;
  const onOffer = fighterId ? rules.entry + rules.fighter + (method ? rules.method : 0) + (method && round ? rules.round : 0) : rules.entry;
  const roundsKnown = status.scheduledRounds === 3 || status.scheduledRounds === 5;

  return <section className={PANEL_SHELL}>
    <PredictionHeading open={open} />
    <div className="px-4 pb-4 sm:px-5">
      {!saved ? (
        <p role="status" className="appear-late text-sm text-zinc-500">
          {error ? <>{error} <button className="underline" onClick={() => void load()}>Retry</button></> : "Loading your pick…"}
        </p>
      ) : <>
        {saved.pick ? <SavedPick pick={predictionLabel(saved.pick)} result={saved.result} open={open} /> : null}

        {!open ? (
          !saved.pick ? <p className="text-sm text-zinc-500">You didn’t pick this fight.</p> : null
        ) : <>
          <fieldset disabled={busy || conflict} className="min-w-0 space-y-3">
            <legend className="sr-only">Your fight prediction</legend>

            <div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Winner">
                {status.fighters.map((item, index) => {
                  const picked = fighterId === item.fighterId;
                  return (
                    <button key={item.fighterId} type="button" aria-pressed={picked}
                      onClick={() => { setFighter(picked ? "" : item.fighterId); edited.current = true; setMessage(""); }}
                      className={`min-w-0 rounded-xl border px-3 py-2.5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
                        picked
                          ? index === 0 ? "border-f1 bg-f1-soft text-f1-ink" : "border-f2 bg-f2-soft text-f2-ink"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                      }`}>
                      <span className="block break-words text-sm font-semibold leading-snug">{item.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Three ways it can end, a row of equal buttons under the two
                fighters. Optional: pressing the chosen one again clears it. */}
            <div>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Method (optional)">
                {(["ko", "submission", "decision"] as const).map(value => {
                  const picked = method === value;
                  return (
                    <button key={value} type="button" aria-pressed={picked}
                      onClick={() => { const next = picked ? null : value; setMethod(next); if (next == null || next === "decision") setRound(null); edited.current = true; setMessage(""); }}
                      className={`${option} ${picked ? optionOn : optionIdle}`}>
                      {METHOD_LABEL[value]}
                    </button>
                  );
                })}
              </div>
            </div>

            {method === "ko" || method === "submission" ? (
              <div>
                {roundsKnown ? (
                  <div role="group" aria-label="Round (optional)" className={`grid gap-2 ${status.scheduledRounds === 5 ? "grid-cols-5" : "grid-cols-3"}`}>
                    {Array.from({ length: status.scheduledRounds! }, (_unused, index) => index + 1).map(value => {
                      const picked = round === value;
                      return (
                        <button key={value} type="button" aria-pressed={picked}
                          onClick={() => { setRound(picked ? null : value); edited.current = true; setMessage(""); }}
                          className={`${option} ${picked ? optionOn : optionIdle}`}>
                          R{value}
                        </button>
                      );
                    })}
                  </div>
                ) : <p className="text-xs text-zinc-500">Opens when the bout length is confirmed.</p>}
              </div>
            ) : null}
          </fieldset>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || conflict || !fighterId || (!!saved.pick && !dirty)}
              className={primary} onClick={() => void submit()}>
              {busy ? "Saving…" : saved.pick ? "Update pick" : "Save pick"}
            </button>
            <p className="text-xs tabular-nums text-zinc-500"><span className="font-semibold text-zinc-900">{onOffer}</span> pts</p>
            {saved.pick && saved.removable ? (
              <button type="button" disabled={busy || conflict} onClick={() => void submit(true)}
                className="ml-auto text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-40">
                Remove
              </button>
            ) : null}
          </div>
        </>}

        {error ? <p role="alert" className="mt-3 text-xs text-rose-600">{error} <button className="underline" onClick={() => void load()}>Reload</button></p> : null}
        {message ? <p role="status" className="mt-3 text-xs text-emerald-700">{message}</p> : null}
      </>}
    </div>
  </section>;
}

/** The saved call, and what it was worth once the fight is settled. */
function SavedPick({ pick, result, open }: { pick: string; result: MyPrediction["result"]; open: boolean }) {
  const state = result?.state;
  const tone = state === "won" ? "text-emerald-600" : state === "lost" ? "text-zinc-500" : "text-zinc-400";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2 ${open ? "mb-3" : ""}`}>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Your pick</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-zinc-900">{pick}</p>
        {result?.reason ? <p className="mt-1 text-xs text-zinc-500">{result.reason}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        {result?.points != null ? <>
          <p className={`text-lg font-semibold tabular-nums ${tone}`}>{predictionPoints(result.points)} <span className="text-xs font-medium text-zinc-400">pts</span></p>
          {state === "won" || state === "lost" ? (
            <p className="mt-0.5 text-[11px] tabular-nums text-zinc-400">
              {result.entry} picked{result.fighter ? ` · ${result.fighter} winner` : ""}{result.method ? ` · ${result.method} method` : ""}{result.round ? ` · ${result.round} round` : ""}
            </p>
          ) : null}
        </> : <p className="text-xs text-zinc-500">{open ? "You can still change this" : "Awaiting the result"}</p>}
      </div>
    </div>
  );
}

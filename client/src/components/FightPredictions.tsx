import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useApi, type Matchup } from "../api";
import { accountsEnabled, useAccount } from "../auth";
import { recallMine, rememberMine, useSessionUser } from "../profile";
import { METHOD_LABEL, predictionLabel, predictionPoints, sharePct } from "../predictions";
import type { MyPrediction, PredictionDistribution, PredictionMethod, PredictionSummary } from "../predictions";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import { BUTTON_PRIMARY_LARGE } from "../ui";

const METHOD_COLOR: Record<string, string> = {
  ko: "var(--color-pick-ko)", submission: "var(--color-pick-sub)",
  decision: "var(--color-pick-dec)", none: "var(--color-pick-none)",
};
/** Spelled out in full so Tailwind keeps the theme variables it would otherwise drop. */
const ROUND_COLOR = ["var(--color-round-1)", "var(--color-round-2)", "var(--color-round-3)", "var(--color-round-4)", "var(--color-round-5)"];
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

type Share = { key: string; label: string; short?: string; count: number; color: string };

const SECTION_LABEL = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400";

/** A full pie, the first answer starting at nine o'clock and running
 *  clockwise, the rest following on. Slices are parted by a hairline of the
 *  panel's own colour. */
function Pie({ entries, total, size = 88 }: { entries: Share[]; total: number; size?: number }) {
  const shown = entries.filter(entry => entry.count > 0);
  const c = size / 2;
  const r = c - 1;
  let angle = Math.PI;
  const point = (at: number) => `${(c + r * Math.cos(at)).toFixed(2)} ${(c + r * Math.sin(at)).toFixed(2)}`;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img"
    aria-label={entries.map(entry => `${entry.label} ${sharePct(entry.count, total)}%`).join(", ")}>
    {shown.length === 1
      ? <circle cx={c} cy={c} r={r} fill={shown[0].color}><title>{`${shown[0].label}: ${shown[0].count} (100%)`}</title></circle>
      : shown.map(entry => {
        const from = angle;
        angle += (entry.count / total) * Math.PI * 2;
        const large = angle - from > Math.PI ? 1 : 0;
        return <path key={entry.key} d={`M ${c} ${c} L ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(angle)} Z`}
          fill={entry.color} strokeWidth={2} strokeLinejoin="round" className="stroke-white dark:stroke-[#18181b]">
          <title>{`${entry.label}: ${entry.count} ${entry.count === 1 ? "pick" : "picks"} (${sharePct(entry.count, total)}%)`}</title>
        </path>;
      })}
  </svg>;
}

/** One question as a pie with its answers listed beside it. */
function SharePie({ title, entries, total, counts = false, ink }: { title: string; entries: Share[]; total: number; counts?: boolean; ink?: string[] }) {
  return <div className="min-w-0 px-4 py-3">
    <h3 className={SECTION_LABEL}>{title}</h3>
    <div className="flex flex-col items-center gap-2.5 @[22rem]:flex-row @[22rem]:items-center @[22rem]:gap-3">
      <Pie entries={entries} total={total} />
      <ul className="w-full min-w-0 space-y-0.5 text-[11px] leading-4" aria-hidden="true">
        {entries.map((entry, index) => <li key={entry.key} className={`flex min-w-0 items-center gap-1.5 ${entry.count ? "text-zinc-600" : "text-zinc-400"}`}
          title={`${entry.label}: ${entry.count} ${entry.count === 1 ? "pick" : "picks"}`}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="min-w-0 truncate">{entry.short ?? entry.label}</span>
          <span className={`ml-auto shrink-0 font-semibold tabular-nums ${ink?.[index] ?? "text-zinc-900"}`}>
            {sharePct(entry.count, total)}%{counts ? ` (${entry.count})` : ""}
          </span>
        </li>)}
      </ul>
    </div>
  </div>;
}

/** Rounds are ordered, so they stand as bars side by side, each with its
 *  share over it and its name under it. */
function ShareColumns({ title, entries, total }: { title: string; entries: Share[]; total: number }) {
  const most = Math.max(1, ...entries.map(entry => entry.count));
  return <div className="min-w-0 px-4 py-3">
    <h3 className={SECTION_LABEL}>{title}</h3>
    <div className="flex items-end gap-0.5" role="img"
      aria-label={entries.map(entry => `${entry.label} ${sharePct(entry.count, total)}%`).join(", ")}>
      {entries.map(entry => <div key={entry.key} className="flex min-w-0 flex-1 flex-col items-center gap-1"
        title={`${entry.label}: ${entry.count} ${entry.count === 1 ? "pick" : "picks"}`}>
        <span className={`text-[11px] font-semibold tabular-nums ${entry.count ? "text-zinc-900" : "text-zinc-400"}`}>{sharePct(entry.count, total)}%</span>
        <div className="flex h-16 w-full items-end justify-center">
          <span className="block w-full max-w-9 rounded-t" style={{ height: entry.count ? `${Math.max(4, (entry.count / most) * 100)}%` : 2, backgroundColor: entry.count ? entry.color : "var(--color-plot-axis)" }} />
        </div>
        <span className={`text-[11px] ${entry.count ? "text-zinc-600" : "text-zinc-400"}`}>{entry.short ?? entry.label}</span>
      </div>)}
    </div>
  </div>;
}

/** Who wins and how as pies, when as bars: small samples stay readable. */
function CommunityPicks({ distribution, scheduledRounds }: { distribution: PredictionDistribution; scheduledRounds: number | null }) {
  const total = distribution.total;
  const fighters: Share[] = distribution.fighters.map((entry, index) => ({
    key: entry.fighterId || `f${index}`, label: entry.name, count: entry.count,
    color: index === 0 ? "var(--color-f1)" : "var(--color-f2)",
  }));
  const methods: Share[] = distribution.methods.map(entry => ({
    key: entry.method ?? "none",
    label: entry.method ? METHOD_LABEL[entry.method] : "No method named",
    short: entry.method ? METHOD_LABEL[entry.method] : "Any",
    count: entry.count, color: METHOD_COLOR[entry.method ?? "none"],
  }));
  const rounds: Share[] = distribution.rounds.map(entry => ({
    key: entry.round == null ? "none" : `r${entry.round}`,
    label: entry.round == null ? "No round named" : `Round ${entry.round}`,
    short: entry.round == null ? "Any" : `R${entry.round}`,
    count: entry.count,
    color: entry.round == null ? "var(--color-pick-none)" : ROUND_COLOR[Math.min(entry.round, 5) - 1],
  }));
  const roundsKnown = scheduledRounds === 3 || scheduledRounds === 5;

  return (
    <section className={PANEL_SHELL}>
      <PanelHeading title="Community picks" aside={<span className="text-xs tabular-nums text-zinc-500">{total.toLocaleString()} {total === 1 ? "pick" : "picks"}</span>} />
      <div className={`grid grid-cols-2 divide-x divide-zinc-100 ${roundsKnown ? "sm:grid-cols-3" : ""}`}>
        <div className="@container min-w-0"><SharePie title="Winner" entries={fighters} total={total} counts ink={["text-f1-ink", "text-f2-ink"]} /></div>
        <div className="@container min-w-0"><SharePie title="Method" entries={methods} total={total} /></div>
        {roundsKnown ? <div className="col-span-2 border-t border-zinc-100 sm:col-span-1 sm:border-t-0"><ShareColumns title="Finish round" entries={rounds} total={total} /></div> : null}
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
  return <PanelHeading title="Your prediction" aside={
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
    <div className="px-4 py-3 sm:px-5 sm:py-4">
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
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Winner</p>
              <div className="grid grid-cols-2 gap-2">
                {status.fighters.map((item, index) => {
                  const picked = fighterId === item.fighterId;
                  return (
                    <button key={item.fighterId} type="button" aria-pressed={picked}
                      onClick={() => { setFighter(picked ? "" : item.fighterId); edited.current = true; setMessage(""); }}
                      className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
                        picked
                          ? index === 0 ? "border-f1 bg-f1-soft text-f1-ink" : "border-f2 bg-f2-soft text-f2-ink"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                      }`}>
                      <span className="block break-words text-sm font-semibold leading-snug">{item.name}</span>
                      <span className={`mt-0.5 block text-[11px] ${picked ? "opacity-80" : "text-zinc-400"}`}>
                        {picked ? "Your pick" : "Pick to win"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Three ways it can end, a row of equal buttons under the two
                fighters. Optional: pressing the chosen one again clears it. */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Method <span className="font-medium normal-case tracking-normal text-zinc-400">optional · +{rules.method}</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
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
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Round <span className="font-medium normal-case tracking-normal text-zinc-400">optional · +{rules.round}</span>
                </p>
                {roundsKnown ? (
                  <div className={`grid gap-2 ${status.scheduledRounds === 5 ? "grid-cols-5" : "grid-cols-3"}`}>
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

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
            <button type="button" disabled={busy || conflict || !fighterId || (!!saved.pick && !dirty)}
              className={primary} onClick={() => void submit()}>
              {busy ? "Saving…" : saved.pick ? "Update pick" : "Save pick"}
            </button>
            <p className="text-xs tabular-nums text-zinc-500">
              Worth <span className="font-semibold text-zinc-900">{onOffer}</span> pts if it lands
              <span className="text-zinc-400"> · {rules.entry} just for picking</span>
            </p>
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

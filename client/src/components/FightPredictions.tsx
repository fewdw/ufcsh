import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useApi, type Matchup } from "../api";
import { accountsEnabled, useAccount } from "../auth";
import { METHOD_LABEL, predictionLabel, predictionPoints, sharePct } from "../predictions";
import type { FanPrediction, MyPrediction, PredictionDistribution, PredictionMethod, PredictionSummary } from "../predictions";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import ProgressiveImage from "./ProgressiveImage";

const METHOD_COLOR: Record<string, string> = {
  ko: "var(--color-pick-ko)", submission: "var(--color-pick-sub)",
  decision: "var(--color-pick-dec)", none: "var(--color-pick-none)",
};
/** Spelled out in full so Tailwind keeps the theme variables it would otherwise drop. */
const ROUND_COLOR = ["var(--color-round-1)", "var(--color-round-2)", "var(--color-round-3)", "var(--color-round-4)", "var(--color-round-5)"];
const chip = "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-40";
const chipIdle = "bg-zinc-50 text-zinc-600 hover:bg-zinc-100";
const chipOn = "bg-zinc-900 text-white";
const primary = "rounded-full bg-zinc-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-40";

export default function FightPredictions({ fight }: { fight: Matchup }) {
  const { data, error, retry } = useApi<PredictionSummary>(`/api/fights/${fight.id}/predictions`, 3_000);
  if (!data) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {error ? <>{error} <button className="underline" onClick={retry}>Retry</button></> : "Loading predictions…"}
  </section>;
  return <>
    {data.total ? <CommunityPicks distribution={data.distribution} scheduledRounds={data.scheduledRounds} /> : null}
    {data.recent.length ? <FanPredictions predictions={data.recent} total={data.total} /> : null}
    {accountsEnabled ? <PredictionGate key={fight.id} fight={fight} status={data} onSaved={retry} />
      : <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`}>Sign-in must be configured to save predictions.</section>}
  </>;
}

type Share = { key: string; label: string; short?: string; count: number; color: string };

/** One question the community answered, as a single split bar with every
 *  answer's share and count named under it: the whole spread reads at once. */
function ShareBar({ title, entries, total }: { title: string; entries: Share[]; total: number }) {
  const shown = entries.filter(entry => entry.count > 0);
  return <div className="min-w-0 px-4 py-2.5">
    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
    <div className="flex h-2 gap-px overflow-hidden rounded-full bg-zinc-100" role="img"
      aria-label={entries.map(entry => `${entry.label} ${sharePct(entry.count, total)}%`).join(", ")}>
      {shown.map(entry => <span key={entry.key} className="h-full" style={{ width: `${(entry.count / total) * 100}%`, backgroundColor: entry.color }} title={`${entry.label} · ${entry.count}`} />)}
    </div>
    <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-4" aria-hidden="true">
      {entries.map(entry => <li key={entry.key} className={`flex min-w-0 items-center gap-1 ${entry.count ? "text-zinc-600" : "text-zinc-400"}`} title={`${entry.label}: ${entry.count} ${entry.count === 1 ? "pick" : "picks"}`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
        <span className="truncate">{entry.short ?? entry.label}</span>
        <span className="font-semibold tabular-nums text-zinc-900">{sharePct(entry.count, total)}%</span>
      </li>)}
    </ul>
  </div>;
}

/** The winner question is a head-to-head: each name at its own end of the
 *  bar, in its corner's colour. */
function WinnerSplit({ fighters, total }: { fighters: Share[]; total: number }) {
  const [f1, f2] = fighters;
  if (!f1 || !f2) return <ShareBar title="Winner" entries={fighters} total={total} />;
  return <div className="min-w-0 px-4 py-2.5">
    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Winner</h3>
    <div className="flex items-baseline justify-between gap-3 text-xs leading-4">
      <span className="min-w-0"><span className="font-semibold tabular-nums text-f1-ink">{sharePct(f1.count, total)}%</span> <span className="text-zinc-600">{f1.label}</span></span>
      <span className="min-w-0 text-right"><span className="text-zinc-600">{f2.label}</span> <span className="font-semibold tabular-nums text-f2-ink">{sharePct(f2.count, total)}%</span></span>
    </div>
    <div className="mt-1 flex h-2 gap-px overflow-hidden rounded-full bg-zinc-100" role="img"
      aria-label={`${f1.label} ${f1.count}, ${f2.label} ${f2.count}`}>
      <span style={{ width: `${(f1.count / total) * 100}%`, backgroundColor: f1.color }} />
      <span style={{ width: `${(f2.count / total) * 100}%`, backgroundColor: f2.color }} />
    </div>
    <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-zinc-400">
      <span>{f1.count} {f1.count === 1 ? "pick" : "picks"}</span><span>{f2.count} {f2.count === 1 ? "pick" : "picks"}</span>
    </div>
  </div>;
}

/** Compact bars keep a small sample honest; one pick no longer becomes a
 * wall of oversized rings or a screen of rows. */
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
      <PanelHeading title="How the community picked" aside={<span className="text-xs tabular-nums text-zinc-500">{total.toLocaleString()} {total === 1 ? "pick" : "picks"}</span>} />
      <div className={`grid divide-y divide-zinc-100 sm:divide-x sm:divide-y-0 ${roundsKnown ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <WinnerSplit fighters={fighters} total={total} />
        <ShareBar title="Method" entries={methods} total={total} />
        {roundsKnown ? <ShareBar title="Finish round" entries={rounds} total={total} /> : null}
      </div>
    </section>
  );
}

function FanPredictions({ predictions, total }: { predictions: FanPrediction[]; total: number }) {
  return <section className={PANEL_SHELL}>
    <PanelHeading title="Fan predictions" subtitle={`${predictions.length < total ? `${predictions.length} newest of ` : ""}${total.toLocaleString()}`} />
    <div className="grid grid-flow-col auto-cols-[minmax(11rem,1fr)] overflow-x-auto border-t border-zinc-100 sm:auto-cols-[minmax(12rem,1fr)] xl:grid-cols-5 xl:auto-cols-auto xl:overflow-visible">
      {predictions.map(row => <Link key={row.scorer.publicId} to={`/profiles/${row.scorer.handle}?tab=predictions`}
        className="min-w-0 border-r border-zinc-100 px-3 py-2 last:border-r-0 hover:bg-zinc-50">
        <span className="flex min-w-0 items-center gap-2">
          {row.scorer.imageUrl
            ? <ProgressiveImage src={row.scorer.imageUrl} alt="" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 rounded-full bg-zinc-100 object-cover ring-1 ring-zinc-200" />
            : <span className="h-6 w-6 shrink-0 rounded-full bg-zinc-100 ring-1 ring-zinc-200" aria-hidden="true" />}
          <span className="min-w-0 truncate text-xs font-semibold text-zinc-700">{row.scorer.displayName}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-zinc-500">{predictionLabel(row.pick)}</span>
      </Link>)}
    </div>
  </section>;
}

type EditorProps = { fight: Matchup; status: PredictionSummary; onSaved: () => void };
function PredictionGate(props: EditorProps) {
  const { isLoaded, user, signIn } = useAccount();
  if (!isLoaded) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`}>Loading your account…</section>;
  if (!user) return <section className={PANEL_SHELL}>
    <PredictionHeading open={props.status.open} />
    <div className="px-4 py-4 text-center">
      <button type="button" className={primary} onClick={signIn}>Sign in to {props.status.open ? "predict" : "view your pick"}</button>
    </div>
  </section>;
  return <PredictionEditor key={`${props.fight.id}:${user.id}`} {...props} />;
}

/** The one place the open/closed state is stated. */
function PredictionHeading({ open }: { open: boolean }) {
  return <PanelHeading title="Your prediction" aside={
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${open ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
      {open ? "Open" : "Closed"}
    </span>
  } />;
}

function PredictionEditor({ fight, status, onSaved }: EditorProps) {
  const { getToken } = useAuth();
  const [saved, setSaved] = useState<MyPrediction | null>(null);
  const [fighterId, setFighter] = useState("");
  const [method, setMethod] = useState<PredictionMethod | null>(null);
  const [round, setRound] = useState<number | null>(null);
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
  const accept = (data: MyPrediction) => {
    setSaved(data); setFighter(data.pick?.fighterId ?? "");
    setMethod(data.pick?.method ?? null); setRound(data.pick?.round ?? null); setConflict(false);
  };
  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try { const data = await request("GET", undefined, signal); if (mounted.current && !signal?.aborted) accept(data); }
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
        <p role="status" className="text-sm text-zinc-500">
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
                      onClick={() => { setFighter(item.fighterId); setMessage(""); }}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
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

            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="min-w-0">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Method <span className="font-medium normal-case tracking-normal text-zinc-300">optional · +{rules.method}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {([null, "ko", "submission", "decision"] as const).map(value => (
                    <button key={value ?? "any"} type="button" aria-pressed={method === value}
                      onClick={() => { setMethod(value); if (value == null || value === "decision") setRound(null); setMessage(""); }}
                      className={`${chip} ${method === value ? chipOn : chipIdle}`}>
                      {value ? METHOD_LABEL[value] : "Any"}
                    </button>
                  ))}
                </div>
              </div>

              {method === "ko" || method === "submission" ? (
                <div className="min-w-0">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Round <span className="font-medium normal-case tracking-normal text-zinc-300">optional · +{rules.round}</span>
                  </p>
                  {roundsKnown ? (
                    <div className="flex flex-wrap gap-1.5">
                      {[null, ...Array.from({ length: status.scheduledRounds! }, (_unused, index) => index + 1)].map(value => (
                        <button key={value ?? "any"} type="button" aria-pressed={round === value}
                          onClick={() => { setRound(value); setMessage(""); }}
                          className={`${chip} min-w-[2.75rem] text-center ${round === value ? chipOn : chipIdle}`}>
                          {value ? `R${value}` : "Any"}
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-xs text-zinc-500">Opens when the bout length is confirmed.</p>}
                </div>
              ) : null}
            </div>
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

import { useAuth } from "@clerk/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDateShortWithYear } from "../format";
import { predictionLabel, predictionPoints } from "../predictions";
import type { PredictionRate, ProfilePredictions as PredictionsData } from "../predictions";
import { ConfirmRemove, RemoveX } from "./ConfirmRemove";
import { Donut, type Slice } from "./Donut";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import { fetchPage, LIST_META, LIST_ROW, LIST_ROW_END, LIST_TITLE, LIST_VALUE, LoadMore, useInfiniteList } from "./InfiniteList";

const RIGHT = "var(--color-pick-right)";
const WRONG = "var(--color-pick-wrong)";

/** One accuracy ring: how often this part of a call was right. Three sit
 *  in a row at every width, each small enough to leave room for the list. */
function Accuracy({ title, rate, empty }: { title: string; rate: PredictionRate; empty: string }) {
  const slices: Slice[] = [
    // Drawn clockwise from 12, so wrong goes first and the right share ends
    // at the top: read from 12 o'clock, green runs counter-clockwise.
    { key: "wrong", label: "Wrong", value: rate.wrong, color: WRONG },
    { key: "right", label: "Right", value: rate.right, color: RIGHT },
  ];
  return (
    <figure className="flex min-w-0 flex-col items-center text-center">
      <figcaption className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</figcaption>
      {rate.total ? <>
        <Donut slices={slices} total={rate.total} size={72} thickness={8}
          centerValue={rate.pct == null ? undefined : `${Math.round(rate.pct)}%`} />
        <p className="mt-1.5 text-xs leading-4 tabular-nums text-zinc-500">
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">{rate.right}</span> of {rate.total}
        </p>
      </> : <p className="flex h-[72px] items-center text-xs text-zinc-400">{empty}</p>}
    </figure>
  );
}

/** Which parts of a settled call landed: W(inner), M(ethod), R(ound). */
function Mark({ label, right }: { label: string; right: boolean }) {
  return <span aria-hidden="true" title={`${{ W: "Winner", M: "Method", R: "Round" }[label]} ${right ? "right" : "wrong"}`}
    className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold ${right ? "bg-emerald-100 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
    {label}{right ? "✓" : "✗"}
  </span>;
}

export default function ProfilePredictions({ handle, mine }: { handle: string; mine: boolean }) {
  const { getToken } = useAuth();
  type Row = PredictionsData["predictions"][number];
  const list = useInfiniteList({
    resetKey: handle,
    load: offset => fetchPage<PredictionsData>(`/api/profiles/${encodeURIComponent(handle)}/predictions?offset=${offset}`, {}, "Predictions could not be loaded."),
    items: page => page.predictions,
    itemKey: row => row.fightId,
    refreshMs: 15_000,
  });
  const [confirming, setConfirming] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const remove = async (row: Row) => {
    if (busy) return;
    setBusy(true); setRemoveError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch(`/api/fights/${row.fightId}/predictions/mine`, {
        method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision: row.revision }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "That prediction could not be removed.");
      setConfirming(null);
    } catch (problem) {
      setRemoveError(problem instanceof Error ? problem.message : "That prediction could not be removed.");
    } finally {
      setBusy(false);
      void list.reload();
    }
  };
  const data = list.first;
  if (!data) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {list.error ? <>{list.error} <button className="underline" onClick={() => void list.retry()}>Retry</button></> : "Loading predictions…"}
  </section>;
  const { accuracy, totals } = data;
  return <>
    <section className={PANEL_SHELL}>
      <PanelHeading title="Prediction accuracy"
        subtitle={`${data.total.toLocaleString()} ${data.total === 1 ? "pick" : "picks"}`}
        aside={<span className="whitespace-nowrap text-sm font-semibold tabular-nums text-zinc-900">
          {totals.points.toLocaleString()} <span className="text-xs font-medium text-zinc-400">pts</span>
        </span>} />
      <div className="grid grid-cols-3 gap-2 px-3 py-3 sm:px-5">
        <Accuracy title="Winner" rate={accuracy.fighter} empty="None settled" />
        <Accuracy title="Method" rate={accuracy.method} empty="None called" />
        <Accuracy title="Round" rate={accuracy.round} empty="None called" />
      </div>
      {totals.pending || totals.void ? (
        <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 sm:px-5">
          {totals.pending ? `${totals.pending} awaiting a result` : ""}
          {totals.pending && totals.void ? " · " : ""}
          {totals.void ? `${totals.void} void` : ""}
        </p>
      ) : null}
    </section>

    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="All predictions" subtitle={data.total ? data.total.toLocaleString() : undefined} />
      {!data.total ? <p className="px-5 py-10 text-center text-sm text-zinc-500">{mine ? "You haven’t made a prediction yet. Open an upcoming fight and use its Predict tab." : "This fan hasn’t made any predictions yet."}</p> : <ul className="divide-y divide-zinc-100">
        {list.items.map(row => {
          // A pick can be taken back until the fight has a result.
          const removable = mine && row.result.state === "pending";
          return <li key={row.fightId} className="relative">
          <Link to={`/fights/${row.fightId}?tab=predict`} className={`block ${LIST_ROW} transition-colors hover:bg-zinc-50 ${LIST_ROW_END(removable)}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className={`min-w-0 ${LIST_TITLE}`}>{predictionLabel(row.pick)}</p>
              {row.result.points == null ? null : (
                <span className={`${LIST_VALUE} ${row.result.state === "won" ? "text-emerald-600" : row.result.state === "lost" ? "text-zinc-400" : "text-zinc-500"}`}>
                  {row.result.state === "void" ? "Void" : `${predictionPoints(row.result.points)} pts`}
                </span>
              )}
            </div>
            <div className={`mt-0.5 flex items-center justify-between gap-3 ${LIST_META}`}>
              <p className="min-w-0 truncate" title={`${row.pick.f1Name} vs ${row.pick.f2Name} · ${row.pick.eventName}`}><span className="text-zinc-700">{row.pick.f1Name} vs {row.pick.f2Name}</span> · {row.pick.eventName} · {formatDateShortWithYear(row.pick.eventDate)}</p>
              {row.result.state === "won" || row.result.state === "lost" ? (
                <p className="flex shrink-0 gap-1.5 tabular-nums" aria-label={[`Winner ${row.result.fighter ? "right" : "wrong"}`, row.pick.method ? `Method ${row.result.method ? "right" : "wrong"}` : "", row.pick.round ? `Round ${row.result.round ? "right" : "wrong"}` : ""].filter(Boolean).join(", ")}>
                  <Mark label="W" right={Boolean(row.result.fighter)} />
                  {row.pick.method ? <Mark label="M" right={Boolean(row.result.method)} /> : null}
                  {row.pick.round ? <Mark label="R" right={Boolean(row.result.round)} /> : null}
                </p>
              ) : null}
            </div>
            {row.result.reason ? <p className={`mt-0.5 ${LIST_META}`}>{row.result.reason}</p> : null}
          </Link>
          {removable ? <RemoveX large label={`Remove your prediction for ${row.pick.f1Name} vs ${row.pick.f2Name}`} onClick={() => { setConfirming(row); setRemoveError(""); }} /> : null}
        </li>;
        })}
      </ul>}
      <LoadMore list={list} />
    </section>
    {confirming ? <ConfirmRemove
      title="Remove this prediction?"
      detail={`${predictionLabel(confirming.pick)} · ${confirming.pick.f1Name} vs ${confirming.pick.f2Name}`}
      busy={busy} error={removeError}
      onCancel={() => { setConfirming(null); setRemoveError(""); }}
      onConfirm={() => void remove(confirming)} /> : null}
  </>;
}

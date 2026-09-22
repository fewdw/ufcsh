import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api";
import { formatDateShortWithYear } from "../format";
import { predictionLabel, predictionPoints } from "../predictions";
import type { PredictionRate, ProfilePredictions as PredictionsData } from "../predictions";
import { DonutFigure, type Slice } from "./Donut";
import { PANEL_SHELL, PanelHeading } from "./FightStats";

const RIGHT = "var(--color-pick-right)";
const WRONG = "var(--color-pick-wrong)";

/** One accuracy donut: how often this part of a call was right. */
function Accuracy({ title, rate, empty }: { title: string; rate: PredictionRate; empty: string }) {
  const slices: Slice[] = [
    { key: "right", label: "Right", value: rate.right, color: RIGHT },
    { key: "wrong", label: "Wrong", value: rate.wrong, color: WRONG },
  ];
  return (
    <DonutFigure title={title} slices={slices} total={rate.total} empty={empty}
      centerValue={rate.pct == null ? undefined : `${Math.round(rate.pct)}%`}
      centerLabel={`${rate.right} of ${rate.total}`} />
  );
}

export default function ProfilePredictions({ handle, mine }: { handle: string; mine: boolean }) {
  const [offset, setOffset] = useState(0);
  const { data, error, retry } = useApi<PredictionsData>(`/api/profiles/${encodeURIComponent(handle)}/predictions?offset=${offset}`, 15_000);
  if (!data) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {error ? <>{error} <button className="underline" onClick={retry}>Retry</button></> : "Loading predictions…"}
  </section>;
  const { accuracy, totals } = data;
  return <>
    <section className={PANEL_SHELL}>
      <PanelHeading title="Prediction accuracy"
        subtitle={`${data.total.toLocaleString()} ${data.total === 1 ? "pick" : "picks"}`}
        aside={<span className="text-right">
          <span className="block text-lg font-semibold tabular-nums text-zinc-900">{totals.points.toLocaleString()}</span>
          <span className="block text-[10px] font-medium uppercase tracking-wide text-zinc-400">points</span>
        </span>} />
      <div className="grid gap-8 px-5 py-6 sm:grid-cols-2 xl:grid-cols-3">
        <Accuracy title="Winner" rate={accuracy.fighter} empty={mine ? "No settled picks yet." : "No settled picks yet."} />
        <Accuracy title="Method" rate={accuracy.method} empty="No method called yet." />
        <Accuracy title="Finish round" rate={accuracy.round} empty="No round called yet." />
      </div>
      {totals.pending || totals.void ? (
        <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
          {totals.pending ? `${totals.pending} awaiting a result` : ""}
          {totals.pending && totals.void ? " · " : ""}
          {totals.void ? `${totals.void} void` : ""}
        </p>
      ) : null}
    </section>

    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="All predictions" subtitle={data.total ? `${offset + 1}–${Math.min(offset + data.pageSize, data.total)} of ${data.total.toLocaleString()}` : undefined} />
      {!data.total ? <p className="px-5 py-10 text-center text-sm text-zinc-500">{mine ? "You haven’t made a prediction yet. Open an upcoming fight and use its Predict tab." : "This fan hasn’t made any predictions yet."}</p> : <ul className="divide-y divide-zinc-100">
        {data.predictions.map(row => <li key={row.fightId}>
          <Link to={`/fights/${row.fightId}?tab=predict`} className="block px-4 py-4 transition-colors hover:bg-zinc-50 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900">{predictionLabel(row.pick)}</p>
                <p className="mt-1 text-xs text-zinc-500">{row.pick.f1Name} vs {row.pick.f2Name}</p>
              </div>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${row.result.state === "won" ? "text-emerald-600" : row.result.state === "lost" ? "text-zinc-400" : "text-zinc-500"}`}>
                {row.result.points == null ? "Pending" : row.result.state === "void" ? "Void" : `${predictionPoints(row.result.points)} pts`}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">{row.pick.eventName} · {formatDateShortWithYear(row.pick.eventDate)}</p>
            {row.result.state === "won" || row.result.state === "lost" ? (
              <p className="mt-1 text-xs tabular-nums text-zinc-500">
                {row.result.fighter ? "Winner right" : "Winner wrong"}
                {row.pick.method ? ` · Method ${row.result.method ? "right" : "wrong"}` : ""}
                {row.pick.round ? ` · Round ${row.result.round ? "right" : "wrong"}` : ""}
              </p>
            ) : null}
            {row.result.reason ? <p className="mt-1 text-xs text-zinc-500">{row.result.reason}</p> : null}
          </Link>
        </li>)}
      </ul>}
      {data.total > data.pageSize ? <div className="flex justify-between border-t border-zinc-100 px-5 py-3 text-xs text-zinc-600">
        <button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - data.pageSize))} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Newer</button>
        <button disabled={offset + data.pageSize >= data.total} onClick={() => setOffset(value => value + data.pageSize)} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Older</button>
      </div> : null}
    </section>
  </>;
}

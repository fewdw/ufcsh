import { useEffect, useState } from "react";
import { useAdminResource } from "../admin";
import { relativeAge } from "../format";
import { DOT, Loading, SectionHead, ViewHead, whole } from "./adminKit";

/** Server `sync-status.ts`. */
export type SyncStatus = {
  generatedAt: number;
  sources: { name: string; at: number | null; everyMs: number; late: boolean }[];
  errors: { at: number; job: string; error: string }[];
  errorsLastDay: number;
  failingLastDay: { kind: string; count: number; lastAt: number }[];
};

const every = (value: number) => value >= 86_400_000 ? `${Math.round(value / 86_400_000)} d`
  : value >= 3_600_000 ? `${Math.round(value / 3_600_000)} h` : `${Math.round(value / 60_000)} min`;
const stamp = (at: number) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Where the data comes from and whether it is current: each source's last
 *  successful refresh, and the jobs that failed lately. Data that is wrong
 *  rather than late is on the Bugs board. */
export default function AdminSync() {
  const { data, error, loading } = useAdminResource<SyncStatus>("/api/admin/sync", 30_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  if (!data) return <Loading>{loading || !error ? "Loading sync status…" : `Couldn’t load sync status. ${error}`}</Loading>;
  return (
    <div className="flex flex-col gap-4">
      <ViewHead title="Sync" note="Each source's last successful refresh. A source is late after missing three refreshes in a row." />

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <tr><th className="px-4 py-2 font-semibold">Source</th><th className="px-3 py-2 font-semibold">Last refresh</th><th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Every</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.sources.map(source => (
              <tr key={source.name} className={source.late ? "bg-amber-50" : ""}>
                <td className="px-4 py-2">
                  <span className="flex items-center gap-1.5 font-medium text-zinc-900">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[source.at == null ? "idle" : source.late ? "warn" : "ok"]}`} />
                    {source.name}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-600" title={source.at ? stamp(source.at) : undefined}>
                  {source.at == null ? "Never recorded" : `${relativeAge(source.at, now)}${source.late ? " · late" : ""}`}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-zinc-500 sm:table-cell">{every(source.everyMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-2">
        <SectionHead title="Failed jobs, last 24 hours" note={data.errorsLastDay ? `${whole(data.errorsLastDay)} failures. Most retry on their own at the next pass.` : "None."} />
        {data.failingLastDay.length ? (
          <div className="flex flex-wrap gap-1.5">
            {data.failingLastDay.map(job => (
              <span key={job.kind} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700" title={`last ${stamp(job.lastAt)}`}>
                <b className="font-semibold text-zinc-900">{job.kind}</b> · {whole(job.count)}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title="Recent errors" note="The last 30, newest first." />
        {data.errors.length ? (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white text-xs">
            {data.errors.map(entry => (
              <li key={`${entry.at}-${entry.job}`} className="px-4 py-2">
                <p className="flex flex-wrap gap-x-2"><b className="font-semibold text-zinc-900">{entry.job}</b><span className="text-zinc-400" title={stamp(entry.at)}>{relativeAge(entry.at, now)}</span></p>
                <p className="mt-0.5 break-words font-mono text-[11px] text-zinc-600">{entry.error}</p>
              </li>
            ))}
          </ul>
        ) : <Loading>No sync errors recorded.</Loading>}
      </section>
    </div>
  );
}

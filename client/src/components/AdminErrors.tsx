import { useEffect, useState } from "react";
import { useAdminResource } from "../admin";
import { relativeAge } from "../format";
import { DOT, FailingUrlRow, Loading, SectionHead, stamp, ViewHead, whole, type FailingUrl } from "./adminKit";

/** Server `sync-status.ts`. */
export type SyncStatus = {
  generatedAt: number;
  sources: { name: string; at: number | null; everyMs: number; late: boolean }[];
  errors: { at: number; job: string; error: string }[];
  errorsLastDay: number;
  failingLastDay: { kind: string; count: number; lastAt: number }[];
};
export type Errors = {
  http: { since: number; serverErrors: FailingUrl[]; notFound: FailingUrl[]; totals: { serverErrors: number; notFound: number; notFoundFromSite: number } };
  sync: SyncStatus;
};

const every = (value: number) => value >= 86_400_000 ? `${Math.round(value / 86_400_000)} d`
  : value >= 3_600_000 ? `${Math.round(value / 3_600_000)} h` : `${Math.round(value / 60_000)} min`;

function List({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  return children.length
    ? <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">{children}</ul>
    : <p className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-400">{empty}</p>;
}

/** Everything that went wrong, most serious first: addresses the server failed
 *  to answer, sync jobs that failed, sources that stopped refreshing, and
 *  addresses that do not exist. Data that is wrong rather than failing is in
 *  Data → Bugs. */
export default function AdminErrors() {
  const { data, error, loading } = useAdminResource<Errors>("/api/admin/errors", 30_000);
  const [now, setNow] = useState(() => Date.now());
  const [allNotFound, setAllNotFound] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  if (!data) return <Loading>{loading || !error ? "Loading errors…" : `Couldn’t load errors. ${error}`}</Loading>;
  const { http, sync } = data;
  const late = sync.sources.filter(source => source.late);
  const notFound = allNotFound ? http.notFound : http.notFound.slice(0, 10);
  return (
    <div className="flex flex-col gap-5">
      <ViewHead title="Errors" note="The last 7 days, kept across restarts. Each address is listed once with how often it failed." />

      <section className="flex flex-col gap-2">
        <SectionHead title={`Server errors · ${whole(http.totals.serverErrors)}`} note="Addresses the server failed to answer (5xx), newest first. Open one to try it." />
        <List empty="No server errors in the last 7 days.">
          {http.serverErrors.map(row => <FailingUrlRow key={`${row.status} ${row.method} ${row.path}`} row={row} now={now} />)}
        </List>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title={`Failed sync jobs · ${whole(sync.errorsLastDay)} in 24 h`} note="Most retry on their own at the next pass; a source that keeps failing turns late below." />
        {sync.failingLastDay.length ? (
          <div className="flex flex-wrap gap-1.5">
            {sync.failingLastDay.map(job => (
              <span key={job.kind} className="border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700" title={`last ${stamp(job.lastAt)}`}>
                <b className="font-semibold text-zinc-900">{job.kind}</b> · {whole(job.count)}
              </span>
            ))}
          </div>
        ) : null}
        <List empty="No sync errors recorded.">
          {sync.errors.map(entry => (
            <li key={`${entry.at}-${entry.job}`} className="px-4 py-2 text-xs">
              <p className="flex flex-wrap gap-x-2"><b className="font-semibold text-zinc-900">{entry.job}</b><span className="text-zinc-400" title={stamp(entry.at)}>{relativeAge(entry.at, now)}</span></p>
              <p className="mt-0.5 break-words font-mono text-[11px] text-zinc-600">{entry.error}</p>
            </li>
          ))}
        </List>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title={late.length ? `Data sources · ${late.length} late` : "Data sources"} note="Each source's last successful refresh. Late after missing three refreshes in a row." />
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-zinc-100">
              {[...sync.sources].sort((a, b) => Number(b.late) - Number(a.late)).map(source => (
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
                  <td className="hidden px-3 py-2 text-right tabular-nums text-zinc-500 sm:table-cell">every {every(source.everyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionHead title={`Not found · ${whole(http.totals.notFoundFromSite)} from links on this site · ${whole(http.totals.notFound)} in all`} note="Addresses that do not exist (404). Links from this site first; the rest are mostly bots probing for other software." />
        <List empty="Nothing missing in the last 7 days.">
          {notFound.map(row => <FailingUrlRow key={`${row.status} ${row.method} ${row.path}`} row={row} now={now} />)}
        </List>
        {http.notFound.length > 10 ? (
          <button type="button" onClick={() => setAllNotFound(value => !value)} className="self-start text-xs font-medium text-zinc-600 underline">
            {allNotFound ? "Show fewer" : `Show all ${http.notFound.length}`}
          </button>
        ) : null}
      </section>
    </div>
  );
}

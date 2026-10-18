import { useEffect, useState } from "react";
import { useAdminResource } from "../admin";
import { relativeAge } from "../format";
import { Loading, ms, routeName, routePath, sameSite, SectionHead, stamp, ViewHead, whole } from "./adminKit";

/** Server `slow-log.ts`. */
type SlowAddress = {
  method: string; path: string; route: string; status: number; count: number;
  sumMs: number; maxMs: number; answerMs: number; firstAt: number; lastAt: number;
};
type SlowRoute = { route: string; count: number; sumMs: number; maxMs: number; answerMs: number; addresses: number; lastAt: number };
export type Slow = { since: number; thresholdMs: number; addresses: SlowAddress[]; routes: SlowRoute[] };

/** The part of a slow request spent getting its data, as a share. */
const dataShare = (row: { answerMs: number; sumMs: number }) => row.answerMs && row.sumMs ? `${Math.round(row.answerMs / row.sumMs * 100)}%` : "—";

function SlowRow({ row, now }: { row: SlowAddress; now: number }) {
  return (
    <li className="px-4 py-2 text-xs">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="rounded bg-zinc-100 px-1.5 font-semibold text-zinc-600" title={routePath(row.route)}>{routeName(row.route)}</span>
        {row.method !== "GET" ? <span className="font-semibold text-zinc-500">{row.method}</span> : null}
        {sameSite(row.path)
          ? <a href={row.path} target="_blank" rel="noreferrer" className="min-w-0 break-all font-mono text-[11px] text-zinc-900 hover:underline">{row.path}</a>
          : <span className="min-w-0 break-all font-mono text-[11px] text-zinc-900">{row.path}</span>}
        {row.status >= 400 ? <span className="rounded bg-rose-50 px-1.5 font-semibold tabular-nums text-rose-700">{row.status}</span> : null}
      </p>
      <p className="mt-0.5 tabular-nums text-zinc-500">
        <b className="font-semibold text-zinc-700">{whole(row.count)}×</b> · {ms(row.sumMs / row.count)} on average · slowest {ms(row.maxMs)}
        {row.answerMs ? <> · data {ms(row.answerMs / row.count)}</> : null}
        <span title={stamp(row.lastAt)}> · last {relativeAge(row.lastAt, now)}</span>
      </p>
    </li>
  );
}

/** Requests that kept a reader waiting, so a Speed warning on the Overview
 *  leads to the routes and exact addresses behind it. */
export default function AdminSlow() {
  const { data, error, loading } = useAdminResource<Slow>("/api/admin/slow", 30_000);
  const [now, setNow] = useState(() => Date.now());
  const [all, setAll] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  if (!data) return <Loading>{loading || !error ? "Loading slow requests…" : `Couldn’t load slow requests. ${error}`}</Loading>;
  const total = data.routes.reduce((sum, route) => sum + route.count, 0);
  const addresses = all ? data.addresses : data.addresses.slice(0, 25);
  return (
    <div className="flex flex-col gap-5">
      <ViewHead title="Slow requests"
        note={`Every request that took ${ms(data.thresholdMs)} or more, the last 7 days, kept across restarts. Admin pages and health checks are left out, as they are from Speed.`} />

      <section className="flex flex-col gap-2">
        <SectionHead title={`By route · ${whole(total)} slow`}
          note="Most reader time lost first. Data is the share spent getting the answer from the cache or building it in a query worker; the rest is the server itself." />
        {data.routes.length ? (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Route</th>
                  <th className="px-3 py-2 text-right font-medium">Slow</th>
                  <th className="px-3 py-2 text-right font-medium">Average</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Slowest</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Data</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Addresses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 tabular-nums">
                {data.routes.map(route => (
                  <tr key={route.route}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-zinc-900">{routeName(route.route)}</span>
                      <span className="block font-mono text-[10px] text-zinc-400">{routePath(route.route)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-700">{whole(route.count)}</td>
                    <td className="px-3 py-2 text-right text-zinc-700">{ms(route.sumMs / route.count)}</td>
                    <td className="hidden px-3 py-2 text-right text-zinc-600 sm:table-cell">{ms(route.maxMs)}</td>
                    <td className="hidden px-3 py-2 text-right text-zinc-600 sm:table-cell">{dataShare(route)}</td>
                    <td className="hidden px-3 py-2 text-right text-zinc-600 md:table-cell">{whole(route.addresses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-400">No slow requests in the last 7 days.</p>
        )}
      </section>

      {data.addresses.length ? (
        <section className="flex flex-col gap-2">
          <SectionHead title={`Addresses · ${whole(data.addresses.length)}`} note="Each address once, most reader time lost first. Open one to try it." />
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {addresses.map(row => <SlowRow key={`${row.method} ${row.path}`} row={row} now={now} />)}
          </ul>
          {data.addresses.length > 25 ? (
            <button type="button" onClick={() => setAll(value => !value)} className="self-start text-xs font-medium text-zinc-600 underline">
              {all ? "Show fewer" : `Show all ${data.addresses.length}`}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

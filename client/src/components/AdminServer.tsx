import { useEffect, useState } from "react";
import { useAdminResource } from "../admin";
import { relativeAge } from "../format";
import { BUTTON_PRIMARY } from "../ui";
import { bytes, Card, MinuteChart, ms, percent, routeName, routePath, uptime, whole, type Metrics, type Minute } from "./adminKit";

/** This server right now: the last hour minute by minute, every route, and
 *  the process behind them. Starts over when the server restarts. */
export default function AdminServer() {
  const { data, error, loading, reload } = useAdminResource<Metrics>("/api/admin/metrics", 10_000);
  const [now, setNow] = useState(() => Date.now());
  const [routeWindow, setRouteWindow] = useState<"lastFiveMinutes" | "lastHour">("lastFiveMinutes");
  const [routeSearch, setRouteSearch] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !data) return <div role="status" className="py-16 text-center text-sm text-zinc-400">Loading metrics…</div>;
  if (!data) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-sm text-zinc-500">
        <p>Couldn’t load metrics. {error}</p>
        <button type="button" onClick={() => void reload()} className="font-semibold text-zinc-900 underline">Retry</button>
      </div>
    );
  }

  const recent = data.http.lastFiveMinutes;
  const minutes = data.http.timeline;
  const lastFull = minutes.at(-2) ?? minutes.at(-1);
  const cacheTotal = data.cache.hits + data.cache.misses;
  const series = (pick: (minute: Minute) => number | null) => minutes.map(minute => ({ at: minute.at, value: pick(minute) }));
  const windowTotal = data.http[routeWindow].requests;
  const routeRows = data.http.routes
    .filter(route => `${routeName(route.route)} ${routePath(route.route)}`.toLowerCase().includes(routeSearch.toLowerCase()))
    .sort((a, b) => b[routeWindow].requests - a[routeWindow].requests || b.requests - a.requests);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Server</h2>
          <p className="text-xs text-zinc-500">
            Live from this server since it started {relativeAge(data.http.startedAt, now)} · Node {data.node.replace(/^v/, "")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className={error ? "text-rose-600" : ""}>{error ? `Refresh failed: ${error}` : `Updated ${Math.max(0, Math.round((now - data.generatedAt) / 1000))}s ago`}</span>
          <button type="button" onClick={() => void reload(true)} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-semibold text-zinc-700 hover:bg-zinc-50">Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="Client addresses" value={whole(recent.visitors)} hint={`distinct in 5 min · ${whole(data.http.lastHour.visitors)} this hour`} />
        <Card label="Requests / min" value={whole(lastFull?.requests ?? 0)} hint={`${whole(data.http.lastHour.requests)} this hour`} />
        <Card label="Response time (p95)" value={ms(recent.p95Ms)} hint={`median ${ms(recent.p50Ms)} · 5 min`} level={recent.p95Ms > 1000 ? "bad" : recent.p95Ms > 300 ? "warn" : "ok"} />
        <Card label="Server errors" value={percent(recent.errors, recent.requests)} hint={`${whole(recent.errors)} responses · ${whole(recent.throttled)} rate-limited`} level={recent.requests && recent.errors / recent.requests > 0.01 ? "warn" : "ok"} />
        <Card label="Event loop (p95)" value={ms(data.process.eventLoopP95Ms)} hint={`max ${ms(data.process.eventLoopMaxMs)} · last 15 s`} level={data.process.eventLoopP95Ms > 50 ? "warn" : "ok"} />
        <Card label="CPU" value={`${Math.round(data.process.cpuPercent)}%`} hint="of one core · last 15 s" />
        <Card label="Memory" value={bytes(data.process.rssBytes)} hint={`heap ${bytes(data.process.heapUsedBytes)} of ${bytes(data.process.heapTotalBytes)}`} />
        <Card label="Uptime" value={uptime(data.process.uptimeSeconds)} hint={`${whole(data.http.sinceStart.requests)} requests served`} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <MinuteChart title="Page views per minute" points={series(minute => minute.pageViews)} format={whole} tone="text-series-3" />
        <MinuteChart title="Requests per minute" points={series(minute => minute.requests)} format={whole} />
        <MinuteChart title="Client addresses per minute" points={series(minute => minute.visitors)} format={whole} tone="text-series-3" />
        <MinuteChart title="Response time (p95)" points={series(minute => minute.requests ? minute.p95Ms : null)} format={ms} kind="line" tone="text-series-4" />
        <MinuteChart title="Errors per minute" points={series(minute => minute.errors)} format={whole} tone="text-rose-500" />
        <MinuteChart title="Rate-limited per minute" points={series(minute => minute.throttled)} format={whole} tone="text-series-2" />
        <MinuteChart title="Event loop delay (p95)" points={series(minute => minute.eventLoopP95Ms)} format={ms} kind="line" tone="text-series-2" />
        <MinuteChart title="CPU" points={series(minute => minute.cpuPercent)} format={value => `${Math.round(value)}%`} kind="line" />
        <MinuteChart title="Memory" points={series(minute => minute.memoryBytes)} format={bytes} kind="line" tone="text-series-3" />
      </div>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Page views</h3>
            <p className="text-[11px] text-zinc-500">Counts page navigation in the app, including clicks that do not reload the browser. Routes are grouped; usernames and IDs are not stored.</p>
          </div>
          <div className="flex gap-4 text-right text-xs tabular-nums">
            <div><b className="block text-base text-zinc-900">{whole(data.http.pageViews.lastFiveMinutes)}</b><span className="text-zinc-500">last 5 min</span></div>
            <div><b className="block text-base text-zinc-900">{whole(data.http.pageViews.lastHour)}</b><span className="text-zinc-500">last hour</span></div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-xs">
            <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <tr><th className="px-4 py-2 font-semibold">Page</th><th className="px-3 py-2 text-right font-semibold">5 min</th><th className="px-3 py-2 text-right font-semibold">1 hour</th><th className="px-3 py-2 text-right font-semibold">Share of hour</th><th className="px-4 py-2 text-right font-semibold">Since restart</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums">
              {data.http.pageViews.routes.map(row => (
                <tr key={row.route}>
                  <td className="px-4 py-2"><b className="block font-medium text-zinc-900">{routeName(row.route)}</b><code className="text-[11px] text-zinc-500">{routePath(row.route)}</code></td>
                  <td className="px-3 py-2 text-right text-zinc-700">{whole(row.lastFiveMinutes)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-zinc-900">{whole(row.lastHour)}</td>
                  <td className="px-3 py-2 text-right text-zinc-600">{percent(row.lastHour, data.http.pageViews.lastHour)}</td>
                  <td className="px-4 py-2 text-right text-zinc-500">{whole(row.total)}</td>
                </tr>
              ))}
              {!data.http.pageViews.routes.length ? <tr><td colSpan={5} className="px-4 py-6 text-center text-zinc-400">No page views since this server started.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Requests by route</h3>
            <p className="text-[11px] text-zinc-500">Includes page loads, APIs and assets. 5xx means a server error; 404 means a missing route or item. Recent results include the current minute.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={routeSearch} onChange={event => setRouteSearch(event.target.value)} placeholder="Find a route" aria-label="Find a route" className="w-36 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400" />
            <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs" aria-label="Request time range">
              {([ ["lastFiveMinutes", "5 min"], ["lastHour", "1 hour"] ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setRouteWindow(key)} aria-pressed={routeWindow === key} className={`rounded-md px-2.5 py-1 font-medium ${routeWindow === key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[790px] text-xs">
            <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Route pattern</th>
                {["Requests", "Share", "p95", "4xx", "404", "429", "5xx", "≥1s", "Since restart"].map(label => <th key={label} className="px-3 py-2 text-right font-semibold">{label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 tabular-nums">
              {routeRows.map(route => {
                const recentRoute = route[routeWindow];
                const failing = recentRoute.requests && recentRoute.errors / recentRoute.requests > 0.01;
                const slow = recentRoute.p95Ms > 500;
                return (
                  <tr key={route.route} className={failing ? "bg-rose-50" : slow ? "bg-amber-50" : ""}>
                    <td className="px-4 py-2"><b className="block font-medium text-zinc-900">{routeName(route.route)}</b><code className="text-[11px] text-zinc-500">{routePath(route.route)}</code></td>
                    <td className="px-3 py-2 text-right font-semibold text-zinc-900">{whole(recentRoute.requests)}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{percent(recentRoute.requests, windowTotal)}</td>
                    <td className="px-3 py-2 text-right text-zinc-800">{recentRoute.requests ? ms(recentRoute.p95Ms) : "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{recentRoute.clientErrors || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{recentRoute.notFound || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{recentRoute.throttled || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{recentRoute.errors || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">{recentRoute.slow || "—"}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{whole(route.requests)}</td>
                  </tr>
                );
              })}
              {!routeRows.length ? <tr><td colSpan={10} className="px-4 py-6 text-center text-zinc-400">No routes match.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

        <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-900">Server internals</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            {([
              ["Response cache hit rate", percent(data.cache.hits, cacheTotal)],
              ["Cached responses", `${whole(data.cache.entries)} · ${bytes(data.cache.bytes)}`],
              ["Query workers", data.queries.workers ? `${data.queries.workers} · ${data.queries.pending} queued` : "In process"],
              ["Discussions in memory", whole(data.community.discussionsInMemory)],
              ["Last data refresh", data.sync.lastTickAt ? relativeAge(data.sync.lastTickAt, now) ?? "—" : "—"],
              ["Sync heartbeat", data.sync.heartbeatAt ? relativeAge(data.sync.heartbeatAt, now) ?? "—" : "—"],
            ] as const).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="truncate text-zinc-500">{label}</dt>
                <dd className="truncate font-semibold tabular-nums text-zinc-900">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

      <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
        <h3 className="text-sm font-semibold text-zinc-900">History and alerts</h3>
        <p className="mt-1">
          The live figures cover the last hour and start over when the server restarts; Admin → Traffic is saved
          hourly and kept. Fourteen days of CPU and disk for the whole machine, and alerts, live in Grafana.
        </p>
        <a href={data.grafanaUrl ?? "http://localhost:3001"} target="_blank" rel="noreferrer" className={`mt-2 ${BUTTON_PRIMARY}`}>
          Open Grafana
        </a>
        {!data.grafanaUrl ? (
          <p className="mt-1">
            First run <code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-800">ssh -L 3001:127.0.0.1:3001 ufcsh-vps</code> on your computer,
            then use the link above and open the <b>UFC production</b> dashboard.
          </p>
        ) : null}
      </section>
    </div>
  );
}

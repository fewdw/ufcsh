import { useEffect, useState } from "react";
import { useAdminResource } from "../admin";
import { relativeAge } from "../format";
import { BUTTON_PRIMARY } from "../ui";

type Summary = {
  requests: number; errors: number; clientErrors: number; notFound: number; throttled: number; slow: number;
  meanMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number;
};
type Minute = {
  at: number; requests: number; errors: number; throttled: number; p95Ms: number; visitors: number; pageViews: number;
  eventLoopP95Ms: number | null; cpuPercent: number | null; memoryBytes: number | null;
};
type Metrics = {
  generatedAt: number;
  ready: boolean;
  node: string;
  process: {
    uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; heapTotalBytes: number;
    eventLoopP50Ms: number; eventLoopP95Ms: number; eventLoopMaxMs: number; cpuPercent: number;
  };
  http: {
    startedAt: number;
    sinceStart: Summary;
    lastFiveMinutes: Summary & { visitors: number };
    lastHour: Summary & { visitors: number };
    routes: (Summary & { route: string; lastFiveMinutes: Summary; lastHour: Summary })[];
    pageViews: {
      total: number; lastFiveMinutes: number; lastHour: number;
      routes: { route: string; total: number; lastFiveMinutes: number; lastHour: number }[];
    };
    timeline: Minute[];
  };
  cache: { hits: number; misses: number; entries: number; bytes: number };
  queries: { pending: number; workers: number };
  sync: { lastTickAt: number | null; heartbeatAt: number | null; lastError: string | null };
  community: {
    commentsLastHour: number; commentsLastDay: number; commentersLastDay: number;
    openReports: number; heldComments: number; mutedAccounts: number; discussionsInMemory: number;
    accounts: number | null; accountsLastDay: number | null; predictionsLastDay: number | null;
  };
  grafanaUrl: string | null;
};

type Level = "ok" | "warn" | "bad" | "idle";
const TONE: Record<Level, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-rose-50 text-rose-700",
  idle: "bg-zinc-100 text-zinc-500",
};
const DOT: Record<Level, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", idle: "bg-zinc-400" };

const whole = (value: number) => Math.round(value).toLocaleString();
const ms = (value: number | null | undefined) => value == null ? "—"
  : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;
const percent = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(part / whole < 0.1 ? 2 : 1)}%` : "—";
function uptime(seconds: number) {
  const days = Math.floor(seconds / 86_400), hours = Math.floor(seconds % 86_400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** What needs a look, most serious first. The long-term alert rules live in
 *  deploy/observability. */
function checks(data: Metrics, now: number) {
  const recent = data.http.lastFiveMinutes;
  const errorRate = recent.requests ? recent.errors / recent.requests : 0;
  const heartbeatAge = data.sync.heartbeatAt ? now - data.sync.heartbeatAt : null;
  const tickAge = data.sync.lastTickAt ? now - data.sync.lastTickAt : null;
  const list: { level: Level; label: string; detail: string }[] = [
    { level: data.ready ? "ok" : "bad", label: "Server", detail: data.ready ? "Ready to serve" : "Not ready: query workers are starting or the server is stopping" },
    { level: errorRate > 0.05 ? "bad" : errorRate > 0.01 ? "warn" : "ok", label: "Server errors", detail: `${percent(recent.errors, recent.requests)} of requests returned a server error in the last 5 minutes` },
    { level: recent.p95Ms > 1000 ? "bad" : recent.p95Ms > 300 ? "warn" : "ok", label: "Speed", detail: `95% of requests answered within ${ms(recent.p95Ms)}` },
    { level: data.process.eventLoopP95Ms > 200 ? "bad" : data.process.eventLoopP95Ms > 50 ? "warn" : "ok", label: "Responsiveness", detail: `Event loop delay ${ms(data.process.eventLoopP95Ms)} (p95)` },
    { level: data.queries.pending > 100 ? "bad" : data.queries.pending > 20 ? "warn" : "ok", label: "Query queue", detail: `${data.queries.pending} waiting` },
    heartbeatAt(heartbeatAge),
    { level: tickAge == null ? "idle" : tickAge > 15 * 60_000 ? "warn" : "ok", label: "Data refresh", detail: tickAge == null ? "No full refresh recorded yet" : `Last full refresh ${relativeAge(data.sync.lastTickAt, now)}` },
    { level: data.sync.lastError ? "warn" : "ok", label: "Upstream feeds", detail: data.sync.lastError ?? "No sync errors" },
    { level: data.community.openReports ? "warn" : "ok", label: "Moderation", detail: data.community.openReports ? `${data.community.openReports} reported ${data.community.openReports === 1 ? "comment" : "comments"} waiting in Comments` : "Nothing waiting" },
  ];
  return list;
}
function heartbeatAt(age: number | null): { level: Level; label: string; detail: string } {
  if (age == null) return { level: "idle", label: "Sync worker", detail: "No heartbeat (normal when sync runs inside the web server)" };
  return { level: age > 90_000 ? "bad" : "ok", label: "Sync worker", detail: age > 90_000 ? `Silent for ${Math.round(age / 60_000)} min` : "Heartbeat current" };
}

function Card({ label, value, hint, level }: { label: string; value: string; hint?: string; level?: Level }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
      <p className="flex items-center gap-1.5 truncate text-[11px] font-medium text-zinc-500">
        {level ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[level]}`} /> : null}
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-zinc-900">{value}</p>
      {hint ? <p className="truncate text-[11px] text-zinc-400">{hint}</p> : null}
    </div>
  );
}

/** An hour, minute by minute. Bars count things; a line tracks a level. */
function MinuteChart({ title, points, format, kind = "bar", tone = "text-series-1" }: {
  title: string; points: { at: number; value: number | null }[]; format: (value: number) => string;
  kind?: "bar" | "line"; tone?: string;
}) {
  const peak = Math.max(...points.map(point => point.value ?? 0), 0);
  const top = peak || 1;
  const latest = [...points].reverse().find(point => point.value != null)?.value ?? null;
  const width = 300, height = 64, step = width / points.length;
  const y = (value: number) => height - (value / top) * (height - 4);
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const line = points.map((point, index) => point.value == null ? null : `${(index + 0.5) * step},${y(point.value)}`).filter(Boolean).join(" ");
  return (
    <figure className="min-w-0 rounded-xl border border-zinc-200 bg-white px-3 pb-2 pt-2.5">
      <figcaption className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate font-medium text-zinc-500">{title}</span>
        <span className="shrink-0 tabular-nums text-zinc-400">now <b className="font-semibold text-zinc-800">{latest == null ? "—" : format(latest)}</b> · peak {format(peak)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={`mt-1.5 h-16 w-full ${tone}`} role="img" aria-label={`${title}, last 60 minutes`}>
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-plot-axis" strokeWidth="1" />
        {kind === "line" && line ? <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /> : null}
        {points.map((point, index) => (
          <g key={point.at}>
            {kind === "bar" && point.value ? (
              <rect x={index * step + 0.6} width={Math.max(step - 1.2, 0.5)} y={y(point.value)} height={height - y(point.value)} rx="0.8" fill="currentColor" opacity="0.85" />
            ) : null}
            {/* The whole column answers a hover, not just the bar. */}
            <rect x={index * step} width={step} y="0" height={height} fill="transparent">
              <title>{`${time(point.at)}: ${point.value == null ? "no sample" : format(point.value)}`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <div className="mt-0.5 flex justify-between text-[10px] text-zinc-400">
        <span>{points.length ? time(points[0].at) : ""}</span><span>now</span>
      </div>
    </figure>
  );
}

const ROUTE_INFO: Record<string, { name: string; path: string }> = {
  page_home: { name: "Events home", path: "/" },
  page_event: { name: "Event pages", path: "/events/:eventId" },
  page_fight: { name: "Fight pages", path: "/fights/:fightId" },
  page_fighter: { name: "Fighter pages", path: "/fighters/:fighterId" },
  page_profile: { name: "Fan profiles", path: "/profiles/:username" },
  page_rankings: { name: "Rankings page", path: "/rankings" },
  page_stats: { name: "Stats page", path: "/stats" },
  page_labs: { name: "Labs page", path: "/labs" },
  page_admin: { name: "Admin page", path: "/admin" },
  page_sign_in: { name: "Sign in", path: "/sign-in/*" },
  page_sign_up: { name: "Sign up", path: "/sign-up/*" },
  page_other: { name: "Other pages and probes", path: "other page paths" },
  assets: { name: "Scripts & styles", path: "/assets/*" },
  images: { name: "Fighter images", path: "/api/images/:id" },
  events_list: { name: "Events data", path: "/api/events" },
  event_detail: { name: "Event data", path: "/api/events/:id" },
  fight_detail: { name: "Fight data", path: "/api/fights/:id" },
  fighter_detail: { name: "Fighter data", path: "/api/fighters/:id" },
  rankings: { name: "Rankings data", path: "/api/rankings" },
  search: { name: "Search", path: "/api/search" },
  live: { name: "Live scores", path: "/api/live" },
  labs: { name: "Labs data", path: "/api/labs/*" },
  stats: { name: "Stats data", path: "/api/stats" },
  previews: { name: "Fighter previews", path: "/api/previews/:id" },
  comments_list: { name: "Fight discussions", path: "/api/fights/:id/comments" },
  comments_thread: { name: "Comment threads", path: "/api/comments/:id/thread" },
  comments_actions: { name: "Comment actions", path: "/api/comments/:id/*" },
  comments_blocks: { name: "Comment blocks", path: "/api/comments/blocks/*" },
  profiles: { name: "Profile data", path: "/api/profiles/:username…" },
  predictions: { name: "Predictions", path: "/api/fights/:id/predictions/*" },
  scores_mine: { name: "Own scorecard", path: "/api/fights/:id/scores/mine" },
  scores_public: { name: "Public scorecards", path: "/api/fights/:id/scores" },
  bets: { name: "Bets", path: "/api/bets/*" },
  leaderboards: { name: "Leaderboards", path: "/api/leaderboards" },
  issue_reports: { name: "Issue reports", path: "/api/reports" },
  admin: { name: "Admin API", path: "/api/admin/*" },
  health: { name: "Health checks", path: "/healthz · /readyz" },
  monitoring: { name: "Monitoring API", path: "/api/metrics · /api/status" },
  pageview_beacon: { name: "Page view signals", path: "/api/pageview" },
  api_other: { name: "Other API", path: "/api/*" },
};

/** Live health for whoever runs the site: is it up, is it fast, is it
 *  busy, and is anything waiting on an administrator. */
export default function AdminHealth() {
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

  const status = checks(data, now);
  const overall: Level = status.some(check => check.level === "bad") ? "bad" : status.some(check => check.level === "warn") ? "warn" : "ok";
  const recent = data.http.lastFiveMinutes;
  const minutes = data.http.timeline;
  const lastFull = minutes.at(-2) ?? minutes.at(-1);
  const cacheTotal = data.cache.hits + data.cache.misses;
  const series = (pick: (minute: Minute) => number | null) => minutes.map(minute => ({ at: minute.at, value: pick(minute) }));
  const windowTotal = data.http[routeWindow].requests;
  const routeRows = data.http.routes
    .filter(route => `${ROUTE_INFO[route.route]?.name ?? route.route} ${ROUTE_INFO[route.route]?.path ?? route.route}`.toLowerCase().includes(routeSearch.toLowerCase()))
    .sort((a, b) => b[routeWindow].requests - a[routeWindow].requests || b.requests - a.requests);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-zinc-900">Health</h2>
          <p className="text-xs text-zinc-500">
            Live from this server since it started {relativeAge(data.http.startedAt, now)} · Node {data.node.replace(/^v/, "")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className={error ? "text-rose-600" : ""}>{error ? `Refresh failed: ${error}` : `Updated ${Math.max(0, Math.round((now - data.generatedAt) / 1000))}s ago`}</span>
          <button type="button" onClick={() => void reload(true)} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-semibold text-zinc-700 hover:bg-zinc-50">Refresh</button>
        </div>
      </div>

      <section className={`rounded-xl px-4 py-3 ${TONE[overall]}`} aria-live="polite">
        <p className="text-sm font-semibold">
          {overall === "ok" ? "Everything looks healthy." : overall === "warn" ? "Running, with something worth a look." : "Something needs attention now."}
        </p>
        <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {status.map(check => (
            <li key={check.label} className="flex min-w-0 items-start gap-1.5">
              <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[check.level]}`} />
              <span className="min-w-0"><b className="font-semibold">{check.label}</b> <span className="opacity-80">{check.detail}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="Visitor IPs" value={whole(recent.visitors)} hint={`distinct in 5 min · ${whole(data.http.lastHour.visitors)} this hour`} />
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
        <MinuteChart title="Visitor IPs per minute" points={series(minute => minute.visitors)} format={whole} tone="text-series-3" />
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
                  <td className="px-4 py-2"><b className="block font-medium text-zinc-900">{ROUTE_INFO[row.route]?.name ?? row.route}</b><code className="text-[11px] text-zinc-500">{ROUTE_INFO[row.route]?.path ?? row.route}</code></td>
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
                    <td className="px-4 py-2"><b className="block font-medium text-zinc-900">{ROUTE_INFO[route.route]?.name ?? route.route}</b><code className="text-[11px] text-zinc-500">{ROUTE_INFO[route.route]?.path ?? route.route}</code></td>
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

      <div className="grid gap-2 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-900">Community</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            {([
              ["Comments, last hour", data.community.commentsLastHour],
              ["Comments, last 24 h", data.community.commentsLastDay],
              ["Commenters, last 24 h", data.community.commentersLastDay],
              ["Reported, waiting", data.community.openReports],
              ["Held for review", data.community.heldComments],
              ["Muted accounts", data.community.mutedAccounts],
              ["Accounts", data.community.accounts],
              ["New accounts, 24 h", data.community.accountsLastDay],
              ["Predictions, 24 h", data.community.predictionsLastDay],
            ] as const).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="truncate text-zinc-500">{label}</dt>
                <dd className="font-semibold tabular-nums text-zinc-900">{value == null ? "—" : whole(value)}</dd>
              </div>
            ))}
          </dl>
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
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
        <h3 className="text-sm font-semibold text-zinc-900">History and alerts</h3>
        <p className="mt-1">
          This page is live and covers the last hour; it starts over when the server restarts. Fourteen days of history,
          CPU and disk for the whole machine, and alerts live in Grafana.
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

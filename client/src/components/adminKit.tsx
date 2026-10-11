/* oxlint-disable react/only-export-components -- the admin views share these
   small pieces and formatters from one place. */
/** Pieces every admin view draws with: stat cards, minute and day charts,
 *  share bars, route names and number formats. */

export type Summary = {
  requests: number; errors: number; clientErrors: number; notFound: number; throttled: number; slow: number;
  meanMs: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number;
};
export type Minute = {
  at: number; requests: number; errors: number; throttled: number; p95Ms: number; visitors: number; pageViews: number;
  eventLoopP95Ms: number | null; cpuPercent: number | null; memoryBytes: number | null;
};
export type Metrics = {
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

export type Level = "ok" | "warn" | "bad" | "idle";
export const TONE: Record<Level, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-rose-50 text-rose-700",
  idle: "bg-zinc-100 text-zinc-500",
};
export const DOT: Record<Level, string> = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", idle: "bg-zinc-400" };

export const whole = (value: number) => Math.round(value).toLocaleString();
export const ms = (value: number | null | undefined) => value == null ? "—"
  : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
export const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;
export const percent = (part: number, whole: number) => whole ? `${(part / whole * 100).toFixed(part / whole < 0.1 ? 2 : 1)}%` : "—";
export function uptime(seconds: number) {
  const days = Math.floor(seconds / 86_400), hours = Math.floor(seconds % 86_400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function Card({ label, value, hint, level }: { label: string; value: string; hint?: string; level?: Level }) {
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
export const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export function MinuteChart({ title, points, format, kind = "bar", tone = "text-series-1", time = clock, span = "last 60 minutes", total }: {
  title: string; points: { at: number; value: number | null }[]; format: (value: number) => string;
  kind?: "bar" | "line"; tone?: string; time?: (at: number) => string; span?: string;
  /** Shown in place of the latest value, for charts of a longer window. */
  total?: string;
}) {
  const peak = Math.max(...points.map(point => point.value ?? 0), 0);
  const top = peak || 1;
  const latest = [...points].reverse().find(point => point.value != null)?.value ?? null;
  const width = 300, height = 64, step = width / Math.max(points.length, 1);
  const y = (value: number) => height - (value / top) * (height - 4);
  const line = points.map((point, index) => point.value == null ? null : `${(index + 0.5) * step},${y(point.value)}`).filter(Boolean).join(" ");
  return (
    <figure className="min-w-0 rounded-xl border border-zinc-200 bg-white px-3 pb-2 pt-2.5">
      <figcaption className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate font-medium text-zinc-500">{title}</span>
        <span className="shrink-0 tabular-nums text-zinc-400">{total ? "total" : "now"} <b className="font-semibold text-zinc-800">{total ?? (latest == null ? "—" : format(latest))}</b> · peak {format(peak)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={`mt-1.5 h-16 w-full ${tone}`} role="img" aria-label={`${title}, ${span}`}>
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
        <span>{points.length ? time(points[0].at) : ""}</span><span>{total ? (points.length ? time(points.at(-1)!.at) : "") : "now"}</span>
      </div>
    </figure>
  );
}

export const ROUTE_INFO: Record<string, { name: string; path: string }> = {
  page_home: { name: "Events home", path: "/" },
  page_event: { name: "Event pages", path: "/events/:eventId" },
  page_fight: { name: "Fight pages", path: "/fights/:fightId" },
  page_fighter: { name: "Fighter pages", path: "/fighters/:fighterId" },
  page_profile: { name: "Fan profiles", path: "/profiles/:username" },
  page_rankings: { name: "Rankings page", path: "/rankings" },
  page_stats: { name: "Stats page", path: "/stats" },
  page_judge: { name: "Judge pages", path: "/judges/:slug" },
  page_referee: { name: "Referee pages", path: "/referees/:slug" },
  page_officials: { name: "Officials directory", path: "/officials" },
  page_venues: { name: "Venues directory", path: "/venues" },
  page_venue: { name: "Venue pages", path: "/venues/:slug" },
  page_locations: { name: "Locations directory", path: "/locations" },
  page_location: { name: "Location pages", path: "/locations/:slug" },
  page_roster: { name: "Roster page", path: "/roster" },
  page_news: { name: "News page", path: "/news" },
  page_graphic: { name: "Graphic builder", path: "/graphic" },
  page_info: { name: "Info page", path: "/info" },
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
  stats: { name: "Stats data", path: "/api/stats" },
  fighter_stats: { name: "Fighter rankings", path: "/api/fighters/:id/stats" },
  officials: { name: "Officials data", path: "/api/judges|referees/*" },
  venues: { name: "Venues data", path: "/api/venues/*" },
  locations: { name: "Locations data", path: "/api/locations/*" },
  share_images: { name: "Share images", path: "/og/*" },
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

export const routeName = (route: string) => ROUTE_INFO[route]?.name ?? route;
export const routePath = (route: string) => ROUTE_INFO[route]?.path ?? route;

export const day = (at: number, year = false) => new Date(at).toLocaleDateString([], { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

export type TrafficRange = "24h" | "7d" | "30d" | "90d" | "all";
export const RANGES: [TrafficRange, string][] = [["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]];
type Breakdown = { total: number; rows: { value: string; count: number }[] };
type PeopleDay = { day: number; visitors: number; returning: number };
export type Traffic = {
  range: TrafficRange; since: number; until: number; bucketMs: number; firstRecordedAt: number | null;
  totals: Summary & { pageViews: number };
  /** Distinct client addresses a day, from every request: crawlers included. */
  dailyVisitors: { days: number; average: number; peak: number; peakDay: number | null };
  series: { at: number; requests: number; errors: number; throttled: number; pageViews: number; p95Ms: number | null; visitors: number; people: number; returning: number }[];
  routes: (Summary & { route: string; pageViews: number })[];
  community: { accounts: number; comments: number; bets: number };
  /** Browsers that ran the app and sent a page view (server `visitors.ts`). */
  people: {
    firstRecordedAt: number | null;
    unique: number | null;
    daily: { days: number; average: number; peak: number; peakDay: number | null };
    windows: { today: PeopleDay; yesterday: PeopleDay; last7Days: number; last30Days: number };
    breakdown: { source: Breakdown; landing: Breakdown; device: Breakdown; country: Breakdown };
  };
};

/** A section's title, an optional line under it, and controls on the right. */
export function SectionHead({ title, note, children }: { title: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {note ? <p className="text-[11px] text-zinc-500">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** A view's heading: its name, what it covers, and anything on the right. */
export function ViewHead({ title, note, children }: { title: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h2>
        {note ? <p className="text-xs text-zinc-500">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Shares of one whole, largest first: a label, a bar and the count. */
export function ShareList({ title, data, label = value => value, empty = "Nothing recorded yet." }: {
  title: string; data: Breakdown; label?: (value: string) => string; empty?: string;
}) {
  const top = data.rows[0]?.count ?? 0;
  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
      <h4 className="flex items-baseline justify-between text-[11px] font-medium text-zinc-500">
        <span>{title}</span><span className="tabular-nums text-zinc-400">{whole(data.total)}</span>
      </h4>
      {data.rows.length ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {data.rows.map(row => (
            <li key={row.value} className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1 text-xs"
              title={`${label(row.value)}: ${whole(row.count)} (${percent(row.count, data.total)})`}>
              <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded-md bg-series-1/15" style={{ width: `${top ? row.count / top * 100 : 0}%` }} />
              <span className="relative min-w-0 truncate text-zinc-800">{label(row.value)}</span>
              <span className="relative shrink-0 tabular-nums text-zinc-500">{whole(row.count)} · {percent(row.count, data.total)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="py-4 text-center text-xs text-zinc-400">{empty}</p>}
    </section>
  );
}

export function Loading({ children = "Loading…" }: { children?: React.ReactNode }) {
  return <div role="status" className="rounded-xl border border-zinc-200 bg-white py-10 text-center text-sm text-zinc-400">{children}</div>;
}

export const countryName = (code: string) => {
  try { return new Intl.DisplayNames([], { type: "region" }).of(code) ?? code; } catch { return code; }
};

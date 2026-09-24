/** Browser page views use fixed route patterns, never a visitor's username or a fight ID. */
export function pageRouteGroup(pathname: string): string | null {
  if (pathname === "/") return "page_home";
  if (/^\/events\/[^/]+$/.test(pathname)) return "page_event";
  if (/^\/fights\/[^/]+$/.test(pathname)) return "page_fight";
  if (/^\/fighters\/[^/]+$/.test(pathname)) return "page_fighter";
  if (/^\/profiles\/[^/]+$/.test(pathname)) return "page_profile";
  if (pathname === "/rankings") return "page_rankings";
  if (pathname === "/stats") return "page_stats";
  if (pathname === "/labs") return "page_labs";
  if (/^\/judges\/[^/]+$/.test(pathname)) return "page_judge";
  if (/^\/referees\/[^/]+$/.test(pathname)) return "page_referee";
  if (pathname === "/officials") return "page_officials";
  if (pathname === "/venues") return "page_venues";
  if (/^\/venues\/[^/]+$/.test(pathname)) return "page_venue";
  if (pathname === "/info") return "page_info";
  if (pathname === "/admin" || pathname === "/admin/bugs") return "page_admin";
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return "page_sign_in";
  if (pathname === "/sign-up" || pathname.startsWith("/sign-up/")) return "page_sign_up";
  return null;
}

/** Bounded, anonymous labels keep metrics useful even when URLs contain IDs or usernames. */
export function routeGroup(pathname: string): string {
  if (/^\/api\/fights\/[a-f0-9]{16}\/scores\/mine$/i.test(pathname)) return "scores_mine";
  if (/^\/api\/fights\/[a-f0-9]{16}\/scores$/i.test(pathname)) return "scores_public";
  if (/^\/api\/fights\/[a-f0-9]{16}\/predictions(\/mine)?$/i.test(pathname)) return "predictions";
  if (/^\/api\/fights\/[a-f0-9]{16}\/comments$/i.test(pathname)) return "comments_list";
  if (pathname === "/api/comments/blocks" || pathname.startsWith("/api/comments/blocks/")) return "comments_blocks";
  if (/^\/api\/comments\/[0-9a-f-]{36}\/thread$/i.test(pathname)) return "comments_thread";
  if (pathname.startsWith("/api/comments/")) return "comments_actions";
  if (pathname === "/api/bets" || pathname.startsWith("/api/bets/")) return "bets";
  if (pathname === "/api/leaderboards") return "leaderboards";
  if (pathname === "/api/reports") return "issue_reports";
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/images/")) return "images";
  if (pathname.startsWith("/api/profiles/")) return "profiles";
  if (pathname === "/api/pageview") return "pageview_beacon";
  if (pathname.startsWith("/api/previews/")) return "previews";
  if (pathname === "/api/stats") return "stats";
  if (/^\/api\/fighters\/[a-f0-9]{16}\/stats$/i.test(pathname)) return "fighter_stats";
  if (/^\/api\/fights\/[a-f0-9]{16}\/context$/i.test(pathname)) return "fight_context";
  if (pathname === "/api/officials" || /^\/api\/(judges|referees)\//.test(pathname)) return "officials";
  if (pathname === "/api/venues" || pathname.startsWith("/api/venues/")) return "venues";
  if (pathname.startsWith("/og/")) return "share_images";
  if (/^\/api\/fights\/[a-f0-9]{16}$/i.test(pathname)) return "fight_detail";
  if (/^\/api\/fighters\/[a-f0-9]{16}$/i.test(pathname)) return "fighter_detail";
  if (/^\/api\/events\/[a-f0-9]{16}$/i.test(pathname)) return "event_detail";
  if (pathname === "/api/events") return "events_list";
  if (pathname === "/api/live") return "live";
  if (pathname === "/api/rankings") return "rankings";
  if (pathname === "/api/search") return "search";
  if (pathname.startsWith("/api/labs")) return "labs";
  if (pathname === "/healthz" || pathname === "/readyz") return "health";
  if (pathname === "/api/status" || pathname === "/api/metrics") return "monitoring";
  if (pathname.startsWith("/api/")) return "api_other";
  if (pathname.startsWith("/assets/")) return "assets";
  return pageRouteGroup(pathname) ?? "page_other";
}

const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];
type Duration = { count: number; sum: number; buckets: number[] };
export type MetricValues = {
  cacheHits: number; cacheMisses: number; cacheEntries: number; cacheBytes: number;
  queriesPending: number; memoryBytes: number; uptimeSeconds: number;
  eventLoopP95Ms: number; eventLoopMaxMs: number; ready: boolean;
  lastTickMs: number; heartbeatMs: number; syncError: boolean;
};

/** Finer latency steps, in milliseconds, for the admin dashboard's estimates. */
const MS_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];
type Latency = { count: number; errors: number; clientErrors: number; notFound: number; throttled: number; slow: number; sumMs: number; maxMs: number; steps: number[] };
const emptyLatency = (): Latency => ({ count: 0, errors: 0, clientErrors: 0, notFound: 0, throttled: 0, slow: 0, sumMs: 0, maxMs: 0, steps: MS_STEPS.map(() => 0) });
/** Process health sampled once a minute beside that minute's traffic. */
export type MinuteGauges = { eventLoopP95Ms: number; cpuPercent: number; memoryBytes: number };
type Minute = { at: number; traffic: Latency; routes: Map<string, Latency>; views: Map<string, number>; visitors: Set<string>; gauges?: MinuteGauges };
/** An hour of per-minute history is kept in memory; Grafana keeps the rest. */
const TIMELINE_MINUTES = 60;
/** Distinct visitors are counted per minute up to this many, then capped. */
const VISITORS_PER_MINUTE = 100_000;

function addLatency(entry: Latency, status: number, ms: number) {
  entry.count++;
  if (status >= 500) entry.errors++;
  if (status >= 400 && status < 500) entry.clientErrors++;
  if (status === 404) entry.notFound++;
  if (status === 429) entry.throttled++;
  if (ms >= 1000) entry.slow++;
  entry.sumMs += ms;
  entry.maxMs = Math.max(entry.maxMs, ms);
  const step = MS_STEPS.findIndex(upper => ms <= upper);
  if (step >= 0) entry.steps[step]++;
}

function mergeLatency(target: Latency, source: Latency) {
  target.count += source.count; target.errors += source.errors; target.clientErrors += source.clientErrors;
  target.notFound += source.notFound; target.throttled += source.throttled; target.slow += source.slow;
  target.sumMs += source.sumMs; target.maxMs = Math.max(target.maxMs, source.maxMs);
  source.steps.forEach((count, index) => { target.steps[index] += count; });
}

/** A percentile estimated from the step counts, interpolated inside the step
 *  it falls in. Beyond the last step, the slowest request seen stands in. */
export function estimatePercentile(entry: Latency, percentile: number): number {
  if (!entry.count) return 0;
  const target = entry.count * percentile;
  let seen = 0;
  for (let index = 0; index < MS_STEPS.length; index++) {
    const inStep = entry.steps[index];
    if (seen + inStep >= target && inStep > 0) {
      const lower = index ? MS_STEPS[index - 1] : 0;
      return Math.min(entry.maxMs, lower + (MS_STEPS[index] - lower) * ((target - seen) / inStep));
    }
    seen += inStep;
  }
  return entry.maxMs;
}

const summarise = (entry: Latency) => ({
  requests: entry.count, errors: entry.errors, clientErrors: entry.clientErrors,
  notFound: entry.notFound, throttled: entry.throttled, slow: entry.slow,
  meanMs: entry.count ? entry.sumMs / entry.count : 0,
  p50Ms: estimatePercentile(entry, 0.5), p95Ms: estimatePercentile(entry, 0.95), p99Ms: estimatePercentile(entry, 0.99),
  maxMs: entry.maxMs,
});

export class HttpObservability {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Duration>();
  private readonly routes = new Map<string, Latency>();
  private readonly pageViews = new Map<string, number>();
  private readonly minutes: Minute[] = [];
  private readonly now: () => number;
  readonly startedAt: number;
  constructor(now = Date.now) { this.now = now; this.startedAt = now(); }

  private minute(): Minute {
    const at = Math.floor(this.now() / 60_000) * 60_000;
    const last = this.minutes.at(-1);
    if (last?.at === at) return last;
    const next: Minute = { at, traffic: emptyLatency(), routes: new Map(), views: new Map(), visitors: new Set() };
    this.minutes.push(next);
    while (this.minutes.length > TIMELINE_MINUTES) this.minutes.shift();
    return next;
  }

  /** Process gauges for the minute in progress, from the server's sampler. */
  sample(gauges: MinuteGauges): void {
    this.minute().gauges = gauges;
  }

  recordPageView(pathname: string): boolean {
    const route = pageRouteGroup(pathname);
    if (!route) return false;
    this.pageViews.set(route, (this.pageViews.get(route) ?? 0) + 1);
    const views = this.minute().views;
    views.set(route, (views.get(route) ?? 0) + 1);
    return true;
  }

  /** `visitor` is the client address. It is only counted, never reported, and
   *  is forgotten with its minute an hour later. */
  record(method: string, pathname: string, status: number, seconds: number, visitor?: string): void {
    const route = routeGroup(pathname);
    const ms = seconds * 1000;
    const perRoute = this.routes.get(route) ?? emptyLatency();
    addLatency(perRoute, status, ms);
    this.routes.set(route, perRoute);
    const minute = this.minute();
    addLatency(minute.traffic, status, ms);
    const minuteRoute = minute.routes.get(route) ?? emptyLatency();
    addLatency(minuteRoute, status, ms);
    minute.routes.set(route, minuteRoute);
    if (visitor && route !== "health" && route !== "monitoring" && minute.visitors.size < VISITORS_PER_MINUTE) minute.visitors.add(visitor);
    const verb = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "OTHER";
    const code = Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : "0";
    const key = `${route}|${verb}|${code}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const duration = this.durations.get(route) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
    duration.count++;
    duration.sum += seconds;
    BUCKETS.forEach((upper, index) => { if (seconds <= upper) duration.buckets[index]++; });
    this.durations.set(route, duration);
  }

  /** Everything the admin dashboard draws: totals and per-route latency since
   *  the process started, and the last hour minute by minute. */
  snapshot() {
    const now = this.now();
    const current = Math.floor(now / 60_000) * 60_000;
    const byMinute = new Map(this.minutes.map(minute => [minute.at, minute]));
    const timeline = Array.from({ length: TIMELINE_MINUTES }, (_unused, index) => {
      const at = current - (TIMELINE_MINUTES - 1 - index) * 60_000;
      const minute = byMinute.get(at);
      const traffic = minute?.traffic ?? emptyLatency();
      return {
        at, requests: traffic.count, errors: traffic.errors, throttled: traffic.throttled,
        pageViews: minute ? [...minute.views.values()].reduce((sum, count) => sum + count, 0) : 0,
        p95Ms: estimatePercentile(traffic, 0.95), visitors: minute?.visitors.size ?? 0,
        ...(minute?.gauges ?? { eventLoopP95Ms: null, cpuPercent: null, memoryBytes: null }),
      };
    });
    const recent = (minutes: number) => {
      const since = current - (minutes - 1) * 60_000;
      const window = this.minutes.filter(minute => minute.at >= since);
      const traffic = emptyLatency();
      const visitors = new Set<string>();
      for (const minute of window) {
        mergeLatency(traffic, minute.traffic);
        for (const visitor of minute.visitors) visitors.add(visitor);
      }
      return { ...summarise(traffic), visitors: visitors.size };
    };
    const total = emptyLatency();
    for (const entry of this.routes.values()) mergeLatency(total, entry);
    const lastFiveMinutes = this.minutes.filter(minute => minute.at >= current - 4 * 60_000);
    const lastHourMinutes = this.minutes.filter(minute => minute.at >= current - 59 * 60_000);
    const windowRoutes = (window: Minute[]) => {
      const routes = new Map<string, Latency>();
      for (const minute of window) for (const [route, entry] of minute.routes) {
        const combined = routes.get(route) ?? emptyLatency();
        mergeLatency(combined, entry);
        routes.set(route, combined);
      }
      return routes;
    };
    const fiveRoutes = windowRoutes(lastFiveMinutes);
    const hourRoutes = windowRoutes(lastHourMinutes);
    const views = (window: Minute[]) => {
      const routes = new Map<string, number>();
      for (const minute of window) for (const [route, count] of minute.views) routes.set(route, (routes.get(route) ?? 0) + count);
      return routes;
    };
    const fiveViews = views(lastFiveMinutes);
    const hourViews = views(lastHourMinutes);
    return {
      startedAt: this.startedAt,
      sinceStart: summarise(total),
      lastFiveMinutes: recent(5),
      lastHour: recent(TIMELINE_MINUTES),
      routes: [...this.routes].map(([route, entry]) => ({
        route, ...summarise(entry),
        lastFiveMinutes: summarise(fiveRoutes.get(route) ?? emptyLatency()),
        lastHour: summarise(hourRoutes.get(route) ?? emptyLatency()),
      })).sort((a, b) => b.lastHour.requests - a.lastHour.requests || b.requests - a.requests),
      pageViews: {
        total: [...this.pageViews.values()].reduce((sum, count) => sum + count, 0),
        lastFiveMinutes: [...fiveViews.values()].reduce((sum, count) => sum + count, 0),
        lastHour: [...hourViews.values()].reduce((sum, count) => sum + count, 0),
        routes: [...this.pageViews].map(([route, total]) => ({
          route, total, lastFiveMinutes: fiveViews.get(route) ?? 0, lastHour: hourViews.get(route) ?? 0,
        })).sort((a, b) => b.lastHour - a.lastHour || b.total - a.total),
      },
      timeline,
    };
  }

  render(values: MetricValues): string {
    const lines: string[] = [];
    const metric = (name: string, value: number, labels = "") => lines.push(`${name}${labels} ${Number.isFinite(value) ? value : 0}`);
    lines.push("# HELP ufc_http_requests_total Completed HTTP requests by bounded route, method and status.");
    lines.push("# TYPE ufc_http_requests_total counter");
    for (const [key, count] of this.requests) {
      const [route, method, code] = key.split("|");
      metric("ufc_http_requests_total", count, `{route="${route}",method="${method}",code="${code}"}`);
    }
    lines.push("# HELP ufc_page_views_total Browser page navigations by bounded route pattern.");
    lines.push("# TYPE ufc_page_views_total counter");
    for (const [route, count] of this.pageViews) metric("ufc_page_views_total", count, `{route="${route}"}`);
    const visitors = this.snapshot().lastFiveMinutes.visitors;
    lines.push("# HELP ufc_http_request_duration_seconds Request duration measured until the response finished.");
    lines.push("# TYPE ufc_http_request_duration_seconds histogram");
    for (const [route, duration] of this.durations) {
      BUCKETS.forEach((upper, index) => metric("ufc_http_request_duration_seconds_bucket", duration.buckets[index], `{route="${route}",le="${upper}"}`));
      metric("ufc_http_request_duration_seconds_bucket", duration.count, `{route="${route}",le="+Inf"}`);
      metric("ufc_http_request_duration_seconds_sum", duration.sum, `{route="${route}"}`);
      metric("ufc_http_request_duration_seconds_count", duration.count, `{route="${route}"}`);
    }
    const gauges: Record<string, number> = {
      ufc_ready: Number(values.ready),
      ufc_cache_hits_total: values.cacheHits,
      ufc_cache_misses_total: values.cacheMisses,
      ufc_cache_entries: values.cacheEntries,
      ufc_cache_bytes: values.cacheBytes,
      ufc_queries_pending: values.queriesPending,
      ufc_process_resident_memory_bytes: values.memoryBytes,
      ufc_process_uptime_seconds: values.uptimeSeconds,
      ufc_event_loop_p95_ms: values.eventLoopP95Ms,
      ufc_event_loop_max_ms: values.eventLoopMaxMs,
      ufc_sync_last_tick_timestamp_seconds: values.lastTickMs / 1000,
      ufc_sync_heartbeat_timestamp_seconds: values.heartbeatMs / 1000,
      ufc_sync_error: Number(values.syncError),
      ufc_visitors_5m: visitors,
    };
    for (const [name, value] of Object.entries(gauges)) {
      lines.push(`# TYPE ${name} ${name.endsWith("_total") ? "counter" : "gauge"}`);
      metric(name, value);
    }
    return lines.join("\n") + "\n";
  }
}

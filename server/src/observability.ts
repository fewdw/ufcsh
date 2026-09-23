/** Bounded, anonymous labels keep metrics useful even when URLs contain IDs or usernames. */
export function routeGroup(pathname: string): string {
  if (/^\/api\/fights\/[a-f0-9]{16}\/scores\/mine$/i.test(pathname)) return "scores_mine";
  if (/^\/api\/fights\/[a-f0-9]{16}\/scores$/i.test(pathname)) return "scores_public";
  if (/^\/api\/fights\/[a-f0-9]{16}\/predictions(\/mine)?$/i.test(pathname)) return "predictions";
  if (/^\/api\/fights\/[a-f0-9]{16}\/comments$/i.test(pathname) || pathname.startsWith("/api/comments/")) return "comments";
  if (pathname === "/api/bets" || pathname.startsWith("/api/bets/")) return "bets";
  if (pathname === "/api/leaderboards") return "leaderboards";
  if (pathname === "/api/reports") return "issue_reports";
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/images/")) return "images";
  if (pathname.startsWith("/api/profiles/")) return "profiles";
  if (pathname.startsWith("/api/previews/")) return "previews";
  if (pathname === "/api/stats") return "stats";
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
  return "page";
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
type Latency = { count: number; errors: number; throttled: number; sumMs: number; maxMs: number; steps: number[] };
const emptyLatency = (): Latency => ({ count: 0, errors: 0, throttled: 0, sumMs: 0, maxMs: 0, steps: MS_STEPS.map(() => 0) });
/** Process health sampled once a minute beside that minute's traffic. */
export type MinuteGauges = { eventLoopP95Ms: number; cpuPercent: number; memoryBytes: number };
type Minute = { at: number; traffic: Latency; visitors: Set<string>; gauges?: MinuteGauges };
/** An hour of per-minute history is kept in memory; Grafana keeps the rest. */
const TIMELINE_MINUTES = 60;
/** Distinct visitors are counted per minute up to this many, then capped. */
const VISITORS_PER_MINUTE = 100_000;

function addLatency(entry: Latency, status: number, ms: number) {
  entry.count++;
  if (status >= 500) entry.errors++;
  if (status === 429) entry.throttled++;
  entry.sumMs += ms;
  entry.maxMs = Math.max(entry.maxMs, ms);
  const step = MS_STEPS.findIndex(upper => ms <= upper);
  if (step >= 0) entry.steps[step]++;
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
  requests: entry.count, errors: entry.errors, throttled: entry.throttled,
  meanMs: entry.count ? entry.sumMs / entry.count : 0,
  p50Ms: estimatePercentile(entry, 0.5), p95Ms: estimatePercentile(entry, 0.95), p99Ms: estimatePercentile(entry, 0.99),
  maxMs: entry.maxMs,
});

export class HttpObservability {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Duration>();
  private readonly routes = new Map<string, Latency>();
  private readonly minutes: Minute[] = [];
  private readonly now: () => number;
  readonly startedAt: number;
  constructor(now = Date.now) { this.now = now; this.startedAt = now(); }

  private minute(): Minute {
    const at = Math.floor(this.now() / 60_000) * 60_000;
    const last = this.minutes.at(-1);
    if (last?.at === at) return last;
    const next: Minute = { at, traffic: emptyLatency(), visitors: new Set() };
    this.minutes.push(next);
    while (this.minutes.length > TIMELINE_MINUTES) this.minutes.shift();
    return next;
  }

  /** Process gauges for the minute in progress, from the server's sampler. */
  sample(gauges: MinuteGauges): void {
    this.minute().gauges = gauges;
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
        traffic.count += minute.traffic.count; traffic.errors += minute.traffic.errors; traffic.throttled += minute.traffic.throttled;
        traffic.sumMs += minute.traffic.sumMs; traffic.maxMs = Math.max(traffic.maxMs, minute.traffic.maxMs);
        minute.traffic.steps.forEach((count, index) => { traffic.steps[index] += count; });
        for (const visitor of minute.visitors) visitors.add(visitor);
      }
      return { ...summarise(traffic), visitors: visitors.size };
    };
    const total = emptyLatency();
    for (const entry of this.routes.values()) {
      total.count += entry.count; total.errors += entry.errors; total.throttled += entry.throttled;
      total.sumMs += entry.sumMs; total.maxMs = Math.max(total.maxMs, entry.maxMs);
      entry.steps.forEach((count, index) => { total.steps[index] += count; });
    }
    return {
      startedAt: this.startedAt,
      sinceStart: summarise(total),
      lastFiveMinutes: recent(5),
      lastHour: recent(TIMELINE_MINUTES),
      routes: [...this.routes].map(([route, entry]) => ({ route, ...summarise(entry) })).sort((a, b) => b.requests - a.requests),
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

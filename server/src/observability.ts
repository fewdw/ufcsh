/** Bounded, anonymous labels keep metrics useful even when URLs contain IDs or usernames. */
export function routeGroup(pathname: string): string {
  if (/^\/api\/fights\/[a-f0-9]{16}\/scores\/mine$/i.test(pathname)) return "scores_mine";
  if (/^\/api\/fights\/[a-f0-9]{16}\/scores$/i.test(pathname)) return "scores_public";
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/images/")) return "images";
  if (pathname.startsWith("/api/profiles/")) return "profiles";
  if (pathname.startsWith("/api/predictions/")) return "predictions";
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

export class HttpObservability {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Duration>();

  record(method: string, pathname: string, status: number, seconds: number): void {
    const route = routeGroup(pathname);
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

  render(values: MetricValues): string {
    const lines: string[] = [];
    const metric = (name: string, value: number, labels = "") => lines.push(`${name}${labels} ${Number.isFinite(value) ? value : 0}`);
    lines.push("# HELP ufc_http_requests_total Completed HTTP requests by bounded route, method and status.");
    lines.push("# TYPE ufc_http_requests_total counter");
    for (const [key, count] of this.requests) {
      const [route, method, code] = key.split("|");
      metric("ufc_http_requests_total", count, `{route="${route}",method="${method}",code="${code}"}`);
    }
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
    };
    for (const [name, value] of Object.entries(gauges)) {
      lines.push(`# TYPE ${name} ${name.endsWith("_total") ? "counter" : "gauge"}`);
      metric(name, value);
    }
    return lines.join("\n") + "\n";
  }
}

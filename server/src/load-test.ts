import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Replays a realistic page mix against a running server and reports
 * throughput and latency percentiles per route. Usage:
 *   TRUSTED_PROXY_IPS=127.0.0.1 NO_SYNC=1 PORT=8001 npm start      (server under test)
 *   npm run load:test -- --url=http://localhost:8001 --concurrency=200 --seconds=30
 * Requests come from --users distinct visitors (default 10,000), each with its
 * own X-Real-IP, so with the server trusting loopback as its proxy they are
 * rate-limited individually as in production. --cold spreads requests over
 * many more distinct pages. --rate=4000 sends that many requests per second
 * regardless of how fast they are answered (10,000 visitors viewing a page
 * every ~20 s at ~8 requests per view is about 4,000/s).
 */

const argv = new Map(process.argv.slice(2).map(value => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const base = new URL(argv.get("url") ?? "http://localhost:8001");
const concurrency = Number(argv.get("concurrency") ?? 100);
const seconds = Number(argv.get("seconds") ?? 20);
const cold = argv.has("cold");
const users = Number(argv.get("users") ?? 10_000);
// Open-loop arrivals per second, as real visitors behave; without it each of
// --concurrency clients sends its next request as soon as the last returns.
const rate = argv.has("rate") ? Number(argv.get("rate")) : 0;

// Read-only and without db.ts, so the test never migrates or locks the database.
const dataDir = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const db = new DatabaseSync(path.join(dataDir, "ufc.db"), { readOnly: true });
const ids = (sql: string) => (db.prepare(sql).all() as { id: string }[]).map(row => row.id);
const limit = cold ? 2000 : 40;
const events = ids(`SELECT id FROM events ORDER BY date DESC LIMIT ${Math.min(limit, 400)}`);
const fights = ids(`SELECT f.id FROM fights f JOIN events e ON e.id = f.event_id ORDER BY e.date DESC LIMIT ${limit}`);
const fighters = ids(`SELECT f1_id AS id FROM fights f JOIN events e ON e.id = f.event_id WHERE f1_id != '' ORDER BY e.date DESC LIMIT ${limit}`);
db.close();

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const searches = ["jon", "silva", "ufc 300", "mcgregor", "pereira", "holloway", "khab"];
// Weighted roughly like real traffic: cards and matchups dominate.
const routes: [weight: number, name: string, make: () => string][] = [
  [14, "html", () => pick([`/events/${pick(events)}`, `/fights/${pick(fights)}`, `/fighters/${pick(fighters)}`, "/rankings"])],
  [12, "/api/events/:id", () => `/api/events/${pick(events)}`],
  [8, "/api/live", () => "/api/live"],
  [6, "/api/events", () => "/api/events"],
  [14, "/api/fights/:id", () => `/api/fights/${pick(fights)}`],
  [12, "/api/fighters/:id", () => `/api/fighters/${pick(fighters)}`],
  [10, "/api/previews/:id", () => `/api/previews/${pick(fighters)}`],
  [5, "/api/rankings", () => "/api/rankings"],
  [4, "/api/search", () => `/api/search?q=${encodeURIComponent(pick(searches))}`],
  [3, "/api/stats", () => "/api/stats"],
  [12, "/api/images/:id", () => `/api/images/${pick(fighters)}`],
];
const totalWeight = routes.reduce((sum, [weight]) => sum + weight, 0);
const chooseRoute = () => {
  let roll = Math.random() * totalWeight;
  for (const route of routes) if ((roll -= route[0]) < 0) return route;
  return routes[0];
};

const agent = new http.Agent({ keepAlive: true, maxSockets: rate > 0 ? Infinity : concurrency });
const results = new Map<string, { latencies: number[]; statuses: Map<number, number> }>();
const visitorIp = () => {
  const n = Math.floor(Math.random() * users);
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
};

function request(pathname: string): Promise<number> {
  return new Promise(resolve => {
    const req = http.get(new URL(pathname, base), {
      agent,
      headers: { "accept-encoding": "gzip", "x-real-ip": visitorIp() },
      timeout: 30_000,
    }, res => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(0));
  });
}

const deadline = Date.now() + seconds * 1000;
const started = performance.now();
async function one(): Promise<void> {
  const [, name, make] = chooseRoute();
  const t = performance.now();
  const status = await request(make());
  const entry = results.get(name) ?? { latencies: [] as number[], statuses: new Map<number, number>() };
  entry.latencies.push(performance.now() - t);
  entry.statuses.set(status, (entry.statuses.get(status) ?? 0) + 1);
  results.set(name, entry);
}
if (rate > 0) {
  const inFlight = new Set<Promise<void>>();
  let sent = 0;
  while (Date.now() < deadline) {
    const due = Math.floor(((performance.now() - started) / 1000) * rate);
    for (; sent < due; sent++) {
      const task: Promise<void> = one().finally(() => inFlight.delete(task));
      inFlight.add(task);
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await Promise.all(inFlight);
} else {
  await Promise.all(Array.from({ length: concurrency }, async () => { while (Date.now() < deadline) await one(); }));
}
const elapsed = (performance.now() - started) / 1000;
agent.destroy();

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const all: number[] = [];
const rows = [...results].sort(([a], [b]) => a.localeCompare(b)).map(([name, { latencies, statuses }]) => {
  const sorted = latencies.sort((a, b) => a - b);
  for (const value of sorted) all.push(value);
  return {
    route: name, requests: sorted.length,
    p50_ms: +percentile(sorted, 0.5).toFixed(1), p95_ms: +percentile(sorted, 0.95).toFixed(1), p99_ms: +percentile(sorted, 0.99).toFixed(1),
    statuses: [...statuses].map(([code, count]) => `${code}×${count}`).join(" "),
  };
});
all.sort((a, b) => a - b);
console.table(rows);
console.log(`${all.length} requests in ${elapsed.toFixed(1)}s = ${(all.length / elapsed).toFixed(0)} req/s ${rate > 0 ? `offered at ${rate}/s` : `at concurrency ${concurrency}`}; p50 ${percentile(all, 0.5).toFixed(1)} ms, p95 ${percentile(all, 0.95).toFixed(1)} ms, p99 ${percentile(all, 0.99).toFixed(1)} ms`);

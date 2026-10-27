import http from "node:http";
import { createSign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fight night against a running server: readers arrive over --ramp seconds,
 * open a live matchup and poll it as the client does (odds and picks every
 * 3 s, scores every 5 s, the card and /api/live every 15 s); at every --bell
 * seconds a round ends and --scorers of them save their scorecard within the
 * next 10 s. Every read reaches the server, as if Cloudflare cached nothing:
 * the worst case. Usage (never against production; loopback only):
 *
 *   openssl genpkey -algorithm RSA -out /tmp/k.pem && openssl pkey -in /tmp/k.pem -pubout -out /tmp/k.pub
 *   DATA_DIR=<archive copy> NO_SYNC=1 NODE_ENV=production PORT=8012 API_WORKERS=2 TRUSTED_PROXY_IPS=127.0.0.1 \
 *     CLERK_SECRET_KEY=sk_test_x CLERK_PUBLISHABLE_KEY=pk_test_bG9hZHRlc3QuY2xlcmsuYWNjb3VudHMuZGV2JA \
 *     CLERK_JWT_KEY="$(cat /tmp/k.pub)" CLERK_AUTHORIZED_PARTIES=http://localhost:8012 CLERK_TELEMETRY_DISABLED=1 \
 *     node src/production.ts
 *   DATA_DIR=<same copy> node src/fight-night-load.ts --url=http://127.0.0.1:8012 --readers=1000 --jwt-key=/tmp/k.pem
 *
 * The server checks the scorers' sessions against CLERK_JWT_KEY, a key made for
 * the run, so these tokens mean nothing to any real Clerk instance.
 */

const argv = new Map(process.argv.slice(2).map(value => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const base = new URL(argv.get("url") ?? "http://127.0.0.1:8012");
const readers = Number(argv.get("readers") ?? 1000);
const ramp = Number(argv.get("ramp") ?? 60);
const seconds = Number(argv.get("seconds") ?? 180);
const bell = Number(argv.get("bell") ?? 60);
const scorerShare = Number(argv.get("scorers") ?? 0.3);
const origin = argv.get("origin") ?? "http://localhost:8012";
const jwtKey = argv.has("jwt-key") ? readFileSync(argv.get("jwt-key")!, "utf8") : null;
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) throw new Error("Fight-night load runs against a local server only.");

// Read-only and without db.ts, so the run never migrates or locks the database.
const dataDir = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const db = new DatabaseSync(path.join(dataDir, "ufc.db"), { readOnly: true });
// The newest card with results stands in for the live one; its decisions can
// be scored in full, as live rounds are once they end.
const card = db.prepare(`SELECT e.id FROM events e JOIN fights f ON f.event_id = e.id
  WHERE f.method LIKE '%DEC%' ORDER BY e.date DESC LIMIT 1`).get() as { id: string };
const bouts = db.prepare(`SELECT id, method, scheduled_rounds FROM fights WHERE event_id = ? ORDER BY ord`).all(card.id) as
  { id: string; method: string | null; scheduled_rounds: number | null }[];
db.close();
const live = bouts.find(bout => /DEC/.test(bout.method ?? "")) ?? bouts[0];
const rounds = Array.from({ length: live.scheduled_rounds || 3 }, (_, i) => ({ round: i + 1, f1: 10, f2: 9, deduct1: 0, deduct2: 0 }));

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const results = new Map<string, { latencies: number[]; statuses: Map<number, number> }>();
const networkErrors = new Map<string, number>();
/** Why requests failed, by route, status and the server's message. */
const failures = new Map<string, number>();
const record = (name: string, ms: number, status: number) => {
  const entry = results.get(name) ?? { latencies: [], statuses: new Map<number, number>() };
  entry.latencies.push(ms);
  entry.statuses.set(status, (entry.statuses.get(status) ?? 0) + 1);
  results.set(name, entry);
};

function send(name: string, pathname: string, ip: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>(resolve => {
    const started = performance.now();
    const req = http.request(new URL(pathname, base), {
      agent, method: init.method ?? "GET", timeout: 30_000,
      // As Cloudflare asks the origin: compressed answers are sent as stored.
      headers: { "accept-encoding": "gzip", "x-real-ip": ip, ...init.headers },
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const body = (res.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString();
        record(name, performance.now() - started, res.statusCode ?? 0);
        if ((res.statusCode ?? 0) >= 400) {
          let message = "";
          try { message = (JSON.parse(body) as { error?: string }).error ?? ""; } catch { /* not JSON */ }
          const key = `${name} ${res.statusCode} ${message}`.trim();
          failures.set(key, (failures.get(key) ?? 0) + 1);
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", (error: NodeJS.ErrnoException) => {
      networkErrors.set(error.code ?? "unknown", (networkErrors.get(error.code ?? "unknown") ?? 0) + 1);
      record(name, performance.now() - started, 0);
      resolve({ status: 0, body: "" });
    });
    req.end(init.body);
  });
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(user: string): string {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT", kid: "ins_loadtest" })}.${b64({
    sub: user, sid: `sess_${user}`, azp: origin, iat: now - 5, nbf: now - 10, exp: now + 3600, v: 2,
  })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(jwtKey!).toString("base64url")}`;
}

const deadline = Date.now() + seconds * 1000;
/** Never past the end of the run, so the totals cover exactly --seconds. */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(ms, deadline - Date.now()))));
const jitter = (ms: number) => ms * (0.9 + Math.random() * 0.2);

async function poll(name: string, pathname: string, every: number, ip: string) {
  await sleep(Math.random() * every);
  while (Date.now() < deadline) {
    await send(name, pathname, ip);
    await sleep(jitter(every));
  }
}

async function reader(index: number) {
  await sleep((index / readers) * ramp * 1000);
  if (Date.now() >= deadline) return;
  const ip = `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
  // Most watch the bout on now; some are elsewhere on the card.
  const fight = Math.random() < 0.8 ? live.id : bouts[Math.floor(Math.random() * bouts.length)].id;
  await Promise.all([
    send("html", `/fights/${fight}`, ip), send("/api/live", "/api/live", ip), send("/api/events", "/api/events", ip),
    send("/api/fights/:id", `/api/fights/${fight}?ranking=media`, ip), send("/api/events/:id", `/api/events/${card.id}?ranking=media`, ip),
  ]);
  const polls = [
    poll("/api/live/odds", "/api/live/odds", 3_000, ip),
    poll("/api/fights/:id/predictions", `/api/fights/${fight}/predictions`, 3_000, ip),
    poll("/api/fights/:id/scores", `/api/fights/${fight}/scores`, 5_000, ip),
    poll("/api/events/:id", `/api/events/${card.id}?ranking=media`, 15_000, ip),
    poll("/api/live", "/api/live", 15_000, ip),
  ];
  if (jwtKey && fight === live.id && Math.random() < scorerShare) polls.push(scorer(index, ip));
  await Promise.all(polls);
}

/** Saves the card after each bell, at a random moment in the 10 s after it. */
async function scorer(index: number, ip: string) {
  const user = `user_load_${index}`;
  const headers = { authorization: `Bearer ${token(user)}`, origin, "content-type": "application/json" };
  // As the score editor does: start from the card already saved, if any.
  const mine = await send("GET scores/mine", `/api/fights/${live.id}/scores/mine`, ip, { headers });
  let revision = mine.status === 200 ? (JSON.parse(mine.body) as { revision: number }).revision : 0;
  const first = Date.now();
  for (let at = Math.ceil((first - started) / (bell * 1000)) * bell * 1000; started + at < deadline; at += bell * 1000) {
    await sleep(Math.max(0, started + at - Date.now()) + Math.random() * 10_000);
    if (Date.now() >= deadline) return;
    const saved = await send("PUT scores/mine", `/api/fights/${live.id}/scores/mine`, ip,
      { method: "PUT", headers, body: JSON.stringify({ revision, rounds }) });
    if (saved.status === 200) revision = (JSON.parse(saved.body) as { revision: number }).revision;
  }
}

const started = Date.now();
const before = await send("probe", "/readyz", "127.0.0.1");
if (before.status !== 200) throw new Error(`Server not ready (${before.status}).`);
results.clear();
console.log(`${readers} readers over ${ramp}s on ${live.id} (${bouts.length} bouts), ${seconds}s, bell every ${bell}s, ${jwtKey ? `${scorerShare * 100}% scoring` : "no scorers (no --jwt-key)"}`);
await Promise.all(Array.from({ length: readers }, (_, index) => reader(index)));
const elapsed = (Date.now() - started) / 1000;
agent.destroy();

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const all: number[] = [];
console.table([...results].sort(([a], [b]) => a.localeCompare(b)).map(([route, { latencies, statuses }]) => {
  const sorted = latencies.sort((a, b) => a - b);
  for (const value of sorted) all.push(value);
  return {
    route, requests: sorted.length, p50_ms: +percentile(sorted, 0.5).toFixed(1), p95_ms: +percentile(sorted, 0.95).toFixed(1),
    p99_ms: +percentile(sorted, 0.99).toFixed(1), max_ms: +sorted.at(-1)!.toFixed(0),
    statuses: [...statuses].map(([code, count]) => `${code}×${count}`).join(" "),
  };
}));
all.sort((a, b) => a - b);
console.log(`${all.length} requests in ${elapsed.toFixed(0)}s = ${(all.length / elapsed).toFixed(0)} req/s; p50 ${percentile(all, 0.5).toFixed(1)} ms, p95 ${percentile(all, 0.95).toFixed(1)} ms, p99 ${percentile(all, 0.99).toFixed(1)} ms`);
if (failures.size) console.log("Failures:", Object.fromEntries(failures));
if (networkErrors.size) console.log("Client network errors:", Object.fromEntries(networkErrors));

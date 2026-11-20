import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { DATA_DIR, db, getMeta, setMeta } from "./db.ts";
import { clearSyncErrors, OUTAGE_MS, outageReport, recentSyncError, recordSyncError, syncStatus } from "./sync-status.ts";
import { HttpRateLimitError } from "./http.ts";
import { syncNews } from "./news.ts";

test("sync errors are kept newest first, grouped by job, and sources say when they are late", () => {
  const saved = { errors: getMeta("sync_errors"), last: getMeta("last_sync_error"), tick: getMeta("last_tick_at") };
  try {
    setMeta("sync_errors", "not json");
    const now = Date.UTC(2026, 9, 11, 2);
    recordSyncError("live_stats 4f0f783503d5b5c4", new Error("fight detail failed validation"), now - 2 * 86_400_000);
    recordSyncError("fightodds", new Error("TimeoutError"), now - 60_000);
    recordSyncError("live_stats aaaaaaaaaaaaaaaa", new Error("timeout"), now - 30_000);
    assert.match(getMeta("last_sync_error")!, /live_stats aaaaaaaaaaaaaaaa: Error: timeout/);
    setMeta("last_tick_at", String(now - 60 * 60_000));
    const status = syncStatus(now);
    assert.deepEqual(status.errors.map(error => error.job), ["live_stats aaaaaaaaaaaaaaaa", "fightodds", "live_stats 4f0f783503d5b5c4"]);
    assert.equal(status.errorsLastDay, 2);
    assert.deepEqual(status.failingLastDay.map(job => [job.kind, job.count]), [["live_stats", 1], ["fightodds", 1]]);
    assert.equal(status.sources.find(source => source.name === "Scheduler pass")?.late, true);
    // Monitoring reads a failure as current for ten minutes, not until the
    // next rankings sync clears `last_sync_error`.
    assert.equal(recentSyncError(now), true);
    assert.equal(recentSyncError(now + 10 * 60_000), false);
  } finally {
    setMeta("sync_errors", saved.errors ?? "");
    setMeta("last_sync_error", saved.last ?? "");
    setMeta("last_tick_at", saved.tick ?? "");
  }
});


test("odds are late when the next card in fight week has no recent price from any source", t => {
  const eventId = "face000000000081", fightId = "face000000000082";
  t.after(() => {
    db.prepare("DELETE FROM odds WHERE fight_id = ?").run(fightId);
    db.prepare("DELETE FROM method_odds WHERE fight_id = ?").run(fightId);
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  const now = Date.parse("2198-12-30T12:00:00Z");
  const source = (name: string, at = now) => syncStatus(at).sources.find(entry => entry.name === name);
  const health = (at = now) => [source("Odds (next card)", at), source("Props (next card)", at)].map(entry => [entry?.at, entry?.late]);
  assert.equal(source("Odds (FightOdds.io)"), undefined, "no one source stands for odds");
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Odds health fixture', '2199-01-01', 0)").run(eventId);
  assert.deepEqual(health(), [[null, false], [null, false]], "a card with no bouts yet is not due");
  db.prepare("INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name) VALUES (?, ?, 0, 'Lightweight', 'x1', 'x2', 'X One', 'X Two')").run(fightId, eventId);
  assert.deepEqual(health(), [[null, true], [null, true]], "a booked card in fight week with no prices at all");
  assert.deepEqual(health(now - 10 * 86_400_000), [[null, false], [null, false]], "a card more than a week out is not due");
  db.prepare("INSERT INTO odds (fight_id, f1_close, f2_close, source_url, fetched_at) VALUES (?, '-150', '+130', 'https://www.bestfightodds.com/x', ?)").run(fightId, now - 60_000);
  db.prepare("INSERT INTO method_odds (fight_id, markets_json, source_url, fetched_at) VALUES (?, '{}', 'https://www.bestfightodds.com/x', ?)").run(fightId, now - 10 * 3_600_000);
  assert.deepEqual(health(), [[now - 60_000, false], [now - 10 * 3_600_000, true]]);
  db.prepare("UPDATE fights SET f1_outcome = 'win', f2_outcome = 'loss' WHERE id = ?").run(fightId);
  assert.deepEqual(health(), [[null, false], [null, false]], "a card whose bouts are all decided is priced no more");
});

test("sources show their last successful read: a failed read never refreshes one", async t => {
  const saved = { news: getMeta("news_read_at"), rows: db.prepare("SELECT * FROM news").all() as Record<string, unknown>[] };
  const fightId = "face000000000091";
  t.after(() => {
    setMeta("news_read_at", saved.news ?? "");
    db.exec("DELETE FROM news");
    for (const row of saved.rows) db.prepare(`INSERT INTO news (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`).run(...Object.values(row) as never[]);
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
  });
  const names = syncStatus().sources.map(source => source.name);
  assert.ok(!names.some(name => /FightOdds|Past odds/.test(name)), "nothing depends on FightOdds.io any more");
  const source = (name: string, now = Date.now()) => syncStatus(now).sources.find(entry => entry.name === name);

  setMeta("news_read_at", "");
  await syncNews(async () => { throw new Error("HTTP 503"); });
  assert.equal(source("News feeds")?.at, null, "every outlet failing is no read");
  await syncNews(async () => []);
  assert.ok((source("News feeds")?.at ?? 0) > Date.now() - 60_000, "an outlet answering is");

  // MMA Decisions: the newest decision whose page was read, not the hourly attempt.
  const newest = (db.prepare("SELECT max(deductions_checked_at) AS at FROM fights").get() as { at: number | null }).at ?? 0;
  const read = Math.max(newest, Date.parse("2199-01-01T00:00:00Z"));
  db.prepare("INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name, deductions_checked_at) VALUES (?, 'x', 0, 'Lightweight', 'x1', 'x2', 'X One', 'X Two', ?)").run(fightId, read);
  const mma = "Deductions and media scores (MMA Decisions)";
  assert.deepEqual([source(mma, read + 3_600_000)?.at, source(mma, read + 3_600_000)?.late], [read, false]);
  assert.equal(source(mma, read + 19 * 3_600_000)?.late, true, "three missed six-hourly re-reads");
});

test("a locked error archive logs the original failure without rejecting, then resumes saving", (t) => {
  const saved = { errors: getMeta("sync_errors"), last: getMeta("last_sync_error") };
  const writer = new DatabaseSync(path.join(DATA_DIR, "ufc.db"));
  const messages: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { messages.push(args); });
  let locked = false;
  try {
    writer.exec("BEGIN IMMEDIATE");
    locked = true;
    assert.doesNotThrow(() => recordSyncError("images", new Error("image refresh failed")));
    assert.equal(messages.length, 1);
    assert.match(messages[0].join(" "), /images.*image refresh failed.*database is locked/);
    assert.equal(getMeta("last_sync_error"), saved.last);
    writer.exec("ROLLBACK");
    locked = false;
    recordSyncError("images", new Error("image refresh failed"));
    assert.match(getMeta("last_sync_error")!, /images: Error: image refresh failed/);
    assert.equal(syncStatus().errors[0].job, "images");
  } finally {
    if (locked) writer.exec("ROLLBACK");
    writer.close();
    setMeta("sync_errors", saved.errors ?? "");
    setMeta("last_sync_error", saved.last ?? "");
  }
});

test("clearing forgets every record of one failure, or all of them, and a new one comes back", () => {
  const saved = { errors: getMeta("sync_errors"), last: getMeta("last_sync_error") };
  try {
    setMeta("sync_errors", "[]");
    const now = Date.UTC(2026, 9, 11, 2);
    recordSyncError("card_segments A", new Error("no sections"), now - 3000);
    recordSyncError("card_segments A", new Error("other"), now - 2000);
    recordSyncError("card_segments A", new Error("no sections"), now - 1000);
    clearSyncErrors({ job: "card_segments A", error: "Error: no sections" });
    assert.deepEqual(syncStatus(now).errors.map(error => error.error), ["Error: other"]);
    assert.match(getMeta("last_sync_error")!, /card_segments A: Error: other/);

    recordSyncError("fightodds", new Error("no sections"), now);
    clearSyncErrors();
    assert.equal(syncStatus(now).errors.length, 0);
    assert.equal(getMeta("last_sync_error"), "");
    assert.equal(recentSyncError(now), false);

    recordSyncError("card_segments A", new Error("no sections"), now + 1000);
    assert.equal(syncStatus(now + 1000).errors.length, 1);
  } finally {
    setMeta("sync_errors", saved.errors ?? "");
    setMeta("last_sync_error", saved.last ?? "");
  }
});

test("a source's passing failure waits to see whether it lasts; an answer in between starts the clock again", () => {
  const MIN = 60_000, t0 = 1_000_000_000;
  const busy = new Error("HTTP 502 for http://ufcstats.com/fight-details/x");
  assert.equal(outageReport("live a", busy, t0), false);
  assert.equal(outageReport("live a", busy, t0 + 10 * MIN), false);
  // A page still filling in is an answer: the source is up.
  outageReport("live a", null, t0 + 11 * MIN, true);
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN), false);
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN + OUTAGE_MS - 1), false);
  // Down for the whole window: reported once, then again only hours later.
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN + OUTAGE_MS), true);
  assert.equal(outageReport("live a", busy, t0 + 40 * MIN), false);
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN + OUTAGE_MS + 6 * 60 * MIN), true);
  // An hourly job is reported on its second failure in a row.
  assert.equal(outageReport("hourly", new Error("database is locked"), t0), false);
  assert.equal(outageReport("hourly", new Error("database is locked"), t0 + 60 * MIN), true);
  // A live feed still catching up with its event page is a lag, not a fault.
  const lag = new Error("Error: ufc.com event 1351 carried no fight card");
  assert.equal(outageReport("card_feed x", lag, t0), false);
  assert.equal(outageReport("card_feed x", lag, t0 + OUTAGE_MS), true);
});

test("a firewall block that goes on is reported once a day for its host, and a new block at once", () => {
  const HOUR = 3_600_000, t0 = 3_000_000_000;
  const block = (host: string, since: number, ray: string) =>
    new HttpRateLimitError(`https://${host}/gql`, t0 + 30 * HOUR, `Cloudflare blocked this server (Ray ID ${ray})`, 403, since);
  assert.equal(outageReport("blocked job", block("blocked-host.example", t0, "a5"), t0), true);
  assert.equal(outageReport("other job", block("blocked-host.example", t0, "a6"), t0 + HOUR), false, "the host was reported already");
  assert.equal(outageReport("blocked job", block("blocked-host.example", t0, "a7"), t0 + 6 * HOUR), false);
  assert.equal(outageReport("other job", block("blocked-host.example", t0, "a8"), t0 + 23 * HOUR), false);
  assert.equal(outageReport("other job", block("blocked-host.example", t0, "a9"), t0 + 24 * HOUR), true);
  assert.equal(outageReport("third job", block("another-host.example", t0, "b1"), t0 + 25 * HOUR), true, "another host is its own news");
  assert.equal(outageReport("blocked job", block("blocked-host.example", t0 + 26 * HOUR, "c1"), t0 + 26 * HOUR), true,
    "blocked again after the host answered");
  assert.equal(outageReport("plain 429", new HttpRateLimitError("https://limited.example/x", t0, "slow down"), t0), false, "a rate limit is still a passing moment");
});

test("a fault of our own is reported at once, then not again on every pass", () => {
  const t0 = 2_000_000_000;
  const broken = new Error("ufc.com events index carried no schedules");
  assert.equal(outageReport("schedules", broken, t0), true);
  assert.equal(outageReport("schedules", broken, t0 + 600_000), false);
  outageReport("schedules", null, t0 + 700_000, true);
  assert.equal(outageReport("schedules", broken, t0 + 800_000), true);
});

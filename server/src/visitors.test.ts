import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TrafficHistory } from "./traffic-history.ts";
import { deviceOf, isAutomated, sourceOf, Visitors, type Visit } from "./visitors.ts";

const DAY = 86_400_000;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";
const visit = (browser: string | null, extra: Partial<Visit> = {}): Visit =>
  ({ browser, address: "203.0.113.7", userAgent: IPHONE, country: "CA", entry: null, ...extra });

test("a browser counts once a day, across a restart, and bots never count", () => {
  const db = new DatabaseSync(":memory:");
  let clock = Date.UTC(2026, 9, 10, 18);
  const before = new TrafficHistory(db, () => clock);
  assert.ok(before.people.visit(visit("aaaaaaaaaaaaaaaaaaaaaa", { entry: { route: "page_fight", source: "Reddit" } })));
  assert.ok(before.people.visit(visit("bbbbbbbbbbbbbbbbbbbbbb", { userAgent: MAC, country: "US" })));
  assert.ok(!before.people.visit(visit("cccccccccccccccccccccc", { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" })));
  before.flush();

  // A deploy: a new process, the same salt, and the same browser again.
  clock += 2 * 3_600_000;
  const after = new TrafficHistory(db, () => clock);
  after.people.visit(visit("aaaaaaaaaaaaaaaaaaaaaa"));
  after.people.visit(visit(null, { address: "198.51.100.1", userAgent: MAC }));
  const day = after.summary("24h");
  assert.equal(day.people.windows.today.visitors, 3, "two before the restart, one new after it");
  assert.equal(day.series.reduce((sum, point) => sum + point.people, 0), 4, "hourly: the returning browser counts in both hours");
  assert.deepEqual(day.people.breakdown.device.rows, [{ value: "desktop", count: 2 }, { value: "phone", count: 1 }]);
  assert.deepEqual(day.people.breakdown.source.rows, [{ value: "Reddit", count: 1 }]);
  assert.deepEqual(day.people.breakdown.landing.rows, [{ value: "page_fight", count: 1 }]);
  assert.deepEqual(day.people.breakdown.country.rows.map(row => row.value), ["CA", "US"]);
  const stored = JSON.stringify(db.prepare("SELECT * FROM traffic_browsers").all());
  assert.ok(!stored.includes("aaaa") && !stored.includes("203.0.113"), "only salted hashes are stored");
});

test("returning visitors, complete-day averages, and ids deleted after five weeks", () => {
  const db = new DatabaseSync(":memory:");
  const start = Date.UTC(2026, 8, 1, 12);
  let clock = start;
  const history = new TrafficHistory(db, () => clock);
  for (let day = 0; day < 40; day++) {
    clock = start + day * DAY;
    history.record("page_home", 200, 5);
    history.people.visit(visit("regular0000000000000000"));
    history.people.visit(visit(`new${String(day).padStart(19, "0")}`, { address: `10.0.0.${day}` }));
    history.flush();
  }
  const month = history.summary("30d");
  assert.equal(month.people.windows.today.visitors, 2);
  assert.equal(month.people.windows.today.returning, 1);
  assert.equal(month.people.windows.last7Days, 8);
  assert.equal(month.people.daily.average, 2);
  assert.equal(month.people.unique, 31, "the regular and one new browser a day for 30 days");
  history.compact();
  const oldest = (db.prepare("SELECT MIN(start) AS first FROM traffic_browsers WHERE span = 'day'").get() as { first: number }).first;
  assert.equal(oldest, Math.floor(clock / DAY) * DAY - 35 * DAY, "hashed ids are deleted after 35 days");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM traffic_people").get() as { n: number }).n, 40, "daily totals stay");
  assert.equal(history.summary("all").people.unique, null, "unique across a window longer than ids are kept is unknown");
});

test("one address cannot invent visitors", () => {
  const visitors = new Visitors(new DatabaseSync(":memory:"), () => Date.UTC(2026, 9, 10));
  let counted = 0;
  for (let i = 0; i < 500; i++) if (visitors.visit(visit(`fake${String(i).padStart(18, "0")}`))) counted++;
  assert.equal(counted, 50);
});

test("devices, sources and automated agents", () => {
  assert.equal(deviceOf(IPHONE), "phone");
  assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/140.0 Safari/537.36"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0 Mobile Safari/537.36"), "phone");
  assert.equal(deviceOf(MAC), "desktop");
  assert.equal(sourceOf("www.google.ca"), "Google");
  assert.equal(sourceOf("out.reddit.com"), "Reddit");
  assert.equal(sourceOf("t.co"), "X / Twitter");
  assert.equal(sourceOf("mmafighting.com"), "mmafighting.com");
  assert.equal(sourceOf("localhost"), null);
  assert.equal(sourceOf("<script>"), null);
  for (const agent of ["", "curl/8.0", "Mozilla/5.0 (compatible; bingbot/2.0)", "Mozilla/5.0 HeadlessChrome/140.0", "facebookexternalhit/1.1", "Mozilla/5.0 (compatible; GPTBot/1.2)"]) {
    assert.ok(isAutomated(agent), agent);
  }
  assert.ok(!isAutomated(IPHONE));
  assert.ok(!isAutomated(MAC));
});

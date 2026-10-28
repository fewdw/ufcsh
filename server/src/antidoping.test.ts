import test from "node:test";
import assert from "node:assert/strict";
import { matchAntidopingRows, parseAntidopingTests, sameAthlete, SOURCE_NAMES, SOURCE_IDS, readAntidopingSnapshot, seedAntidopingTests, syncAntidopingTests, fighterAntidopingTests, unlinkedAntidopingRows, type AntidopingRow } from "./antidoping.ts";
import { db, getMeta, setMeta, dataRevision } from "./db.ts";
import { normName } from "./util.ts";

const page = (rows: [number, string, number][], shown = rows.length) => `<h2 id="displayCount">Displaying ${shown} Entries</h2>
  <table class="standardTable testResults--table searchTable"><thead><tr><th>Year</th><th>Athlete</th><th>Test Sessions</th></tr></thead>
  <tbody>${rows.map(([year, name, tests]) => `<tr><td>${year}</td><th class="searchable">${name}</th><td>${tests}</td></tr>`).join("")}</tbody></table>`;

test("a year's table reads every row, entities decoded, and anything else is refused", () => {
  assert.deepEqual(parseAntidopingTests(page([[2026, "Casey O&#39;Neill", 4], [2026, "Elekana &quot;Billy&quot; Joseph", 2]]), 2026), [
    { year: 2026, name: "Casey O'Neill", tests: 4 },
    { year: 2026, name: 'Elekana "Billy" Joseph', tests: 2 },
  ]);
  assert.throws(() => parseAntidopingTests("<html>Checking your browser</html>", 2026));
  // A table cut short, or another year's, never replaces a stored one.
  assert.throws(() => parseAntidopingTests(page([[2026, "Aaron Pico", 5]], 2), 2026));
  assert.throws(() => parseAntidopingTests(page([[2025, "Aaron Pico", 5]]), 2026));
});

test("a registered name matches the ring name it is, and not a namesake", () => {
  assert.ok(sameAthlete("brandon moreno carrillo", "brandon moreno"));
  assert.ok(sameAthlete("diego lopes da silva", "diego lopes"));
  assert.ok(sameAthlete("christian duncan", "christian leroy duncan"));
  assert.ok(sameAthlete("christopher duncan", "chris duncan"));
  assert.ok(sameAthlete("doo ho choi", "dooho choi"));
  assert.ok(sameAthlete("weili zhang", "zhang weili"));
  assert.ok(sameAthlete("yi zha", "yizha"));
  assert.ok(!sameAthlete("christian duncan", "chris duncan"));
  assert.ok(!sameAthlete("alexia pereira", "alex pereira"));
});

test("rows are tied only where one fighter fits, and never two to one fighter a year", () => {
  const fighter = (id: string, name: string, years: number[]) => ({ id, norm: normName(name), years: new Set(years) });
  const fighters = [
    fighter("pereira", "Alex Pereira", [2025, 2026]),
    fighter("usman", "Kamaru Usman", [2025]),
    fighter("silva1", "Bruno Silva", [2025]),
    fighter("silva2", "Bruno Silva", [2025]),
    fighter("moreno", "Brandon Moreno", [2024, 2025]),
    fighter("retired", "Joe Lauzon", [2019]),
  ];
  const rows: AntidopingRow[] = [
    { year: 2026, name: "Alex Pereira", tests: 5 },
    { year: 2026, name: "Alex S Pereira", tests: 1 },
    { year: 2025, name: "Kamarudeen Usman", tests: 4 },
    { year: 2026, name: "Kamarudeen Usman", tests: 2 },
    { year: 2025, name: "Bruno Silva", tests: 3 },
    { year: 2025, name: "Brandon Moreno Carrillo", tests: 6 },
    { year: 2025, name: "Brandon Moreno Ortiz", tests: 2 },
    { year: 2024, name: "Joe Lauzon", tests: 1 },
  ];
  assert.deepEqual(matchAntidopingRows(rows, fighters), [
    "pereira", null, // the exact name holds the fighter; the other is someone else
    "usman", "usman", // verified registered name, including a year without a bout
    null, // two Bruno Silvas
    null, null, // two rows for one fighter: neither is trusted
    "retired", // one fighter by that exact name, still in the testing pool
  ]);
});

test("every hand-tied name is one UFC fighter in the archive and not a name tied anyway", () => {
  const fighters = db.prepare("SELECT COUNT(*) AS n FROM fighters fr WHERE fr.norm_name = ? AND EXISTS (SELECT 1 FROM fights f WHERE fr.id IN (f.f1_id, f.f2_id))");
  const normalized = new Map<string, string>();
  for (const [source, stored] of Object.entries(SOURCE_NAMES)) {
    assert.equal((fighters.get(normName(stored)) as { n: number }).n, 1, `${source} -> ${stored}`);
    assert.notEqual(normName(source), normName(stored), source);
    const previous = normalized.get(normName(source));
    if (previous) assert.equal(previous, stored, "normalized aliases must agree");
    normalized.set(normName(source), stored);
  }
  const identity = db.prepare("SELECT name, nickname, birth_date FROM fighters WHERE id=?");
  for (const [source, id] of Object.entries(SOURCE_IDS)) {
    const flyweight = id === "294aa73dbf37d281";
    assert.deepEqual({ ...identity.get(id) }, {
      name: "Bruno Silva", nickname: flyweight ? "Bulldog" : "Blindado", birth_date: flyweight ? "1990-03-16" : "1989-07-13",
    }, source);
    assert.ok(!normalized.has(normName(source)));
  }
});

test("a conflicting year cannot be claimed later by carrying an adjacent year's name", () => {
  assert.deepEqual(matchAntidopingRows([
    { year: 2025, name: "Brandon Moreno Carrillo", tests: 6 },
    { year: 2025, name: "Brandon Moreno Ortiz", tests: 2 },
    { year: 2026, name: "Brandon Moreno Carrillo", tests: 4 },
  ], [{ id: "moreno", norm: "brandon moreno", years: new Set([2025, 2026]) }]), [null, null, "moreno"]);
});

test("malformed rows, blank counts, duplicates, and mixed years cannot replace valid data", () => {
  const valid = page([[2026, "Alex Pereira", 5]]);
  for (const html of [
    valid.replace("<td>5</td>", "<td></td>"),
    valid.replace("<td>5</td>", "<td>5e1</td>"),
    valid.replace("<td>5</td>", "<td>9007199254740992</td>"),
    valid.replace('id="displayCount"', 'id="changed"'),
    page([[2026, "Alex Pereira", 5], [2026, "Alex Pereira", 7]]),
    page([[2026, "Alex Pereira", 5], [2025, "Alex Pereira", 6]], 1),
  ]) assert.throws(() => parseAntidopingTests(html, 2026));
  assert.throws(() => parseAntidopingTests("<html>Unavailable</html>", 2027, true));
  assert.throws(() => parseAntidopingTests(page([]), 2027, true));
  const empty = `<select id="year"><option value="2027" selected>2027</option></select>${page([])}`;
  assert.deepEqual(parseAntidopingTests(empty, 2027, true), []);
  assert.throws(() => parseAntidopingTests(empty, 2026, true));
});

test("new similar names stay unlinked; reviewed aliases ignore casing and accents", () => {
  const fighters = [
    { id: "alex", norm: "alex pereira", years: new Set([2026]) },
    { id: "usman", norm: "kamaru usman", years: new Set([2026]) },
  ];
  assert.deepEqual(matchAntidopingRows([
    { year: 2026, name: "Alexia Pereira", tests: 7 },
    { year: 2026, name: "Alec Pereira", tests: 3 },
    { year: 2026, name: "KAMARUDÉEN USMAN", tests: 5 },
  ], fighters), [null, null, "usman"]);
});

test("bundled public tables contain every year and the source records for GSP and Pereira", () => {
  const snapshot = readAntidopingSnapshot();
  const history = (name: RegExp) => snapshot.years.flatMap(({ year, rows }) => rows.filter(([athlete]) => name.test(athlete)).map(([, tests]) => ({ year, tests })));
  assert.deepEqual(history(/^Georges St-Pierre$/), [{ year: 2016, tests: 2 }, { year: 2017, tests: 7 }, { year: 2018, tests: 5 }]);
  assert.deepEqual(history(/^Alex (S )?Pereira$/), [
    { year: 2021, tests: 1 }, { year: 2022, tests: 8 }, { year: 2023, tests: 9 },
    { year: 2024, tests: 5 }, { year: 2025, tests: 6 }, { year: 2026, tests: 5 },
  ]);
});

test("offline deployment, failed refreshes, history corrections, and year rollover preserve accurate records", async (t) => {
  // This suite runs only against a private archive copy. Restore our rows and
  // metadata for the other server tests sharing that temporary copy.
  const saved = db.prepare("SELECT * FROM antidoping_tests").all() as unknown as (AntidopingRow & { fighter_id: string | null })[];
  const meta = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'antidoping_%'").all() as { key: string; value: string }[];
  const insert = db.prepare("INSERT INTO antidoping_tests (year, name, tests, fighter_id) VALUES (?, ?, ?, ?)");
  t.after(() => {
    db.exec("BEGIN IMMEDIATE; DELETE FROM antidoping_tests; DELETE FROM meta WHERE key LIKE 'antidoping_%'");
    for (const row of saved) insert.run(row.year, row.name, row.tests, row.fighter_id);
    for (const row of meta) setMeta(row.key, row.value);
    db.exec("COMMIT");
  });
  db.exec("DELETE FROM antidoping_tests; DELETE FROM meta WHERE key LIKE 'antidoping_%'");
  const snapshot = readAntidopingSnapshot();
  const now = new Date(Date.parse(snapshot.checkedAt) + 86_400_000);
  const alex = "e5549c82bfb5582d", gsp = "6506c1d34da9c013";
  const count = (id: string, year: number) => fighterAntidopingTests(id).find(row => row.year === year)?.tests;
  const requests: number[] = [];
  let broken = false, historical = false, changed = false;
  const request = t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const year = Number(new URL(String(input)).searchParams.get("year"));
    requests.push(year);
    if (year === 2026 && broken) return new Response("<html>Source unavailable</html>");
    if (year === 2027) return new Response(`<select id="year"><option value="2027" selected>2027</option></select>${page([])}`);
    const rows = snapshot.years.find(row => row.year === year)!.rows.map(([name, tests]): [number, string, number] => [
      year, name, historical && year === 2016 && name === "Georges St-Pierre" ? 3
        : changed && name === "Alex Pereira" ? year === 2025 ? 8 : 9 : tests,
    ]);
    if (changed && year === 2026) {
      assert.equal(count(alex, 2025), 6, "an earlier page has not been published yet");
      rows.push([2026, "Unbooked Different Athlete", 3]);
    }
    return new Response(page(rows));
  });

  seedAntidopingTests();
  assert.equal(request.mock.calls.length, 0, "offline bootstrap needs no network");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM antidoping_tests").get() as { n: number }).n,
    snapshot.years.reduce((n, year) => n + year.rows.length, 0));
  assert.equal(count(alex, 2026), 5);
  assert.equal(count(gsp, 2018), 5);
  let revision = dataRevision("profiles");
  seedAntidopingTests();
  assert.equal(dataRevision("profiles"), revision, "restarting does not invalidate profiles");
  db.prepare("UPDATE antidoping_tests SET fighter_id=NULL WHERE name='Alex Pereira' AND year=2026").run();
  seedAntidopingTests();
  assert.equal(count(alex, 2026), 5, "the same bundle still rechecks newly resolvable identities");

  // Preserve a newer online value even when an older snapshot is redeployed.
  db.prepare("UPDATE antidoping_tests SET tests=7 WHERE fighter_id=? AND year=2026").run(alex);
  setMeta("antidoping_year_2026_checked_at", String(now.getTime()));
  setMeta("antidoping_seed_at", "");
  seedAntidopingTests();
  assert.equal(count(alex, 2026), 7);
  setMeta("antidoping_history_checked_at", String(now.getTime()));
  setMeta("antidoping_synced_at", String(now.getTime() - 86_400_000));
  const previousSync = getMeta("antidoping_synced_at");
  revision = dataRevision("profiles");
  changed = broken = true;
  await assert.rejects(syncAntidopingTests(now), /table not found/);
  assert.equal(count(alex, 2025), 6);
  assert.equal(count(alex, 2026), 7);
  assert.equal(getMeta("antidoping_synced_at"), previousSync);
  assert.equal(dataRevision("profiles"), revision);

  // A write/link failure also rolls back counts, links, metadata and revisions.
  broken = false;
  db.exec(`CREATE TEMP TRIGGER fail_antidoping_link BEFORE UPDATE OF fighter_id ON antidoping_tests
    WHEN NEW.year=2026 AND NEW.name='Alex Pereira' BEGIN SELECT RAISE(ABORT, 'injected link failure'); END`);
  try { await assert.rejects(syncAntidopingTests(now), /injected link failure/); }
  finally { db.exec("DROP TRIGGER fail_antidoping_link"); }
  assert.equal(count(alex, 2025), 6);
  assert.equal(count(alex, 2026), 7);
  assert.equal(dataRevision("profiles"), revision);
  assert.equal(getMeta("antidoping_synced_at"), previousSync);

  requests.length = 0;
  const analytics = dataRevision("analytics"), search = dataRevision("search");
  await syncAntidopingTests(now);
  assert.deepEqual(requests, [2025, 2026]);
  assert.equal(count(alex, 2025), 8);
  assert.equal(count(alex, 2026), 9);
  assert.ok(unlinkedAntidopingRows().some(row => row.name === "Unbooked Different Athlete" && row.tests === 3));
  assert.notEqual(dataRevision("profiles"), revision);
  assert.equal(dataRevision("analytics"), analytics);
  assert.equal(dataRevision("search"), search);
  assert.equal(getMeta("antidoping_synced_at"), String(now.getTime()));

  changed = false;
  historical = true;
  requests.length = 0;
  const later = new Date(now.getTime() + 31 * 86_400_000);
  const first = syncAntidopingTests(later);
  assert.equal(syncAntidopingTests(later), first, "overlapping repairs share one refresh");
  await first;
  assert.deepEqual(requests, snapshot.years.map(row => row.year));
  assert.equal(count(gsp, 2016), 3, "historical source corrections are picked up");
  revision = dataRevision("profiles");
  await syncAntidopingTests(later);
  assert.equal(dataRevision("profiles"), revision, "identical tables do not invalidate caches");
  setMeta("antidoping_seed_at", "");
  seedAntidopingTests();
  assert.equal(count(gsp, 2016), 3, "an older deployment cannot undo an online correction");

  requests.length = 0;
  await syncAntidopingTests(new Date("2027-01-01T12:00:00Z"));
  assert.ok(requests.includes(2027), "new years are discovered automatically");
  assert.equal(count(alex, 2027), undefined, "missing data is never invented as zero");
  assert.equal(count(alex, 2026), 5);
  assert.equal(count(gsp, 2016), 3);
});

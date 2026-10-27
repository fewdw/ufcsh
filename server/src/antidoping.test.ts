import test from "node:test";
import assert from "node:assert/strict";
import { matchAntidopingRows, parseAntidopingTests, registeredName, sameAthlete, SOURCE_NAMES, spelledAlike, type AntidopingRow } from "./antidoping.ts";
import { db } from "./db.ts";
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
  assert.ok(registeredName("kamarudeen usman", "kamaru usman"));
  assert.ok(registeredName("mohammad nasrat haqparast", "nasrat haqparast"));
  assert.ok(!registeredName("jackson silva", "jean silva"));
  assert.ok(spelledAlike("andrei puliaev", "andrey pulyaev"));
  assert.ok(!spelledAlike("bruno silva", "bruna silva"));
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
    "usman", "usman", // a year he didn't fight, carried from the one he did
    null, // two Bruno Silvas
    null, null, // two rows for one fighter: neither is trusted
    "retired", // one fighter by that exact name, still in the testing pool
  ]);
});

test("every hand-tied name is one UFC fighter in the archive and not a name tied anyway", () => {
  const fighters = db.prepare("SELECT COUNT(*) AS n FROM fighters fr WHERE fr.norm_name = ? AND EXISTS (SELECT 1 FROM fights f WHERE fr.id IN (f.f1_id, f.f2_id))");
  for (const [source, stored] of Object.entries(SOURCE_NAMES)) {
    assert.equal((fighters.get(normName(stored)) as { n: number }).n, 1, `${source} -> ${stored}`);
    assert.notEqual(normName(source), normName(stored), source);
  }
});

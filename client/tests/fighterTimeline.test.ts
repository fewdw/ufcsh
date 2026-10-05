import test from "node:test";
import assert from "node:assert/strict";
import { careerBands, fightProgram } from "../src/fighterTimeline.ts";
import type { CareerRosterEvent, ProfessionalHistoryRow } from "../src/api.ts";

function bout(date: string, event_name = "UFC 300", promotion: "ufc" | "outside" = "ufc", upcoming = false): ProfessionalHistoryRow {
  return { date, event_name, promotion, upcoming, outcome: upcoming ? null : "win", fight_id: null } as ProfessionalHistoryRow;
}
function report(date: string, kind: CareerRosterEvent["kind"] = "signed", observed = false): CareerRosterEvent {
  return { date, kind, observed, source_url: "https://www.ufc.com/", reason: null };
}

test("recruitment event names and TUF finales are identified without unrelated matches", () => {
  for (const name of ["Dana White's Contender Series - Week 1", "Dana White’s Tuesday Night Contender Series", "Dana White Contender Series", "UFC - DWCS 50", "DWTNCS 1"]) assert.equal(fightProgram(name), "Contender Series");
  assert.equal(fightProgram("UFC - Road To UFC 1"), "Road to UFC");
  assert.equal(fightProgram("The Ultimate Fighter 18 Finale"), "TUF");
  assert.equal(fightProgram("UFC - The Ultimate Fighter 18 Finale"), "TUF");
  for (const name of ["Cage Rage - Contenders", "Euphoria - Road to the Titles", "UFC 300"]) assert.equal(fightProgram(name), null);
});

test("DWCS and Road to UFC wins alone never create a signing band", () => {
  assert.deepEqual(careerBands([bout("2024-01-01", "Dana White's Contender Series")]), [[], []]);
  assert.deepEqual(careerBands([bout("2024-01-01", "Road to UFC")]), [[], []]);
  assert.deepEqual(careerBands([bout("2024-01-01", "The Ultimate Fighter 3")]), [[], []]);
  for (const title_type of ["tuf", "tournament"] as const) {
    const final = bout("2024-01-01", "UFC Fight Night"); final.title_type = title_type;
    assert.deepEqual(careerBands([final]), [[], []]);
    assert.equal(careerBands([bout("2025-01-01"), final])[1][0].label, "Signed to UFC");
  }
});

test("completed regular UFC appearance confirms a signing, without inventing its date", () => {
  const rows = [bout("2025-01-01"), bout("2024-09-01", "Dana White's Contender Series"), bout("2024-01-01", "LFA 1", "outside")];
  const bands = careerBands(rows);
  assert.equal(bands.flat().length, 1);
  assert.equal(bands[1][0].label, "Signed to UFC");
  assert.equal(bands[1][0].date, undefined);
  assert.match(bands[1][0].detail, /exact signing date unknown/);
});

test("bookings and result-pending rows do not establish a signing", () => {
  assert.deepEqual(careerBands([bout("2027-01-01", "UFC 400", "ufc", true)]), [[], []]);
  const pending = bout("2024-01-01"); pending.outcome = null;
  assert.deepEqual(careerBands([pending]), [[], []]);
  assert.equal(careerBands([], [report("2024-01-01")])[0][0].label, "Signed to UFC");
});

test("Romero's reported cut sits between Adesanya and Bellator; no duplicate exit", () => {
  const rows = [bout("2021-09-18", "Bellator 266", "outside"), bout("2020-03-07", "UFC 248"), bout("2019-08-17", "UFC 241")];
  const bands = careerBands(rows, [report("2020-12-04", "released")]);
  assert.equal(bands[1][0].label, "Cut from UFC");
  assert.equal(bands.flat().filter(band => !band.signing).length, 1);
});

test("unreported outside bouts never claim a cut, retirement or departure date", () => {
  const bands = careerBands([bout("2025-01-01", "Bellator 1", "outside"), bout("2024-01-01")]);
  assert.equal(bands[1][0].label, "Last UFC fight");
  assert.equal(bands[1][0].date, undefined);
  assert.match(bands[1][0].detail, /unconfirmed/);
});

test("multiple runs mark returns, and TUF finale undercards can confirm UFC appearances", () => {
  const bands = careerBands([bout("2025-01-01"), bout("2024-01-01", "LFA 1", "outside"), bout("2023-01-01", "UFC - The Ultimate Fighter 18 Finale")]);
  assert.equal(bands[1][0].label, "Returned to UFC");
  assert.equal(bands[2][0].label, "Last UFC fight");
  assert.equal(bands[3][0].label, "Signed to UFC");
});

test("reported signings replace inferred bands, retaining a source and deduplicating observations", () => {
  const events = [report("2024-10-01"), report("2024-10-01"), report("2024-10-03", "signed", true)];
  const bands = careerBands([bout("2025-01-01"), bout("2024-09-01", "DWCS 1")], events);
  assert.equal(bands.flat().length, 1);
  assert.equal(bands[1][0].date, "2024-10-01");
  assert.equal(bands[1][0].source_url, "https://www.ufc.com/");
});

test("retirement, non-renewal and observed roster changes retain distinct wording", () => {
  assert.equal(careerBands([], [report("2024-01-01", "retired")])[0][0].label, "Retired from UFC");
  const band = careerBands([], [report("2024-01-01", "departed", true)])[0][0];
  assert.equal(band.label, "Left UFC roster");
  assert.match(band.detail, /first observed/);
  assert.deepEqual(careerBands([], [report("2024-02-30")]), [[]]);
});

test("same-day reports place signings before a fight and releases after it", () => {
  assert.equal(careerBands([bout("2024-01-01")], [report("2024-01-01")])[1][0].label, "Signed to UFC");
  assert.equal(careerBands([bout("2024-01-01")], [report("2024-01-01", "released")])[0][0].label, "Cut from UFC");
  assert.equal(careerBands([bout("2024-01-01")], [report("2024-01-02", "signed", true)]).flat().length, 1);
});

test("the shared timeline identifies unknown fields and clears them with sourced reports", () => {
  const rows = [bout("2025-01-01", "Bellator 1", "outside"), bout("2024-01-01"), bout("2023-01-01", "LFA 1", "outside")];
  const unknown = careerBands(rows).flat();
  assert.deepEqual(unknown.find(band => band.signing)?.unknown, ["signing_date"]);
  assert.deepEqual(unknown.find(band => !band.signing)?.unknown, ["departure_date", "departure_reason"]);
  assert.ok(careerBands(rows, [report("2023-12-01"), report("2024-12-01", "released")]).flat().every(band => !band.unknown?.length));
  assert.deepEqual(careerBands([], [report("2024-01-01", "signed", true)])[0][0].unknown, ["signing_date"]);
  assert.deepEqual(careerBands([], [report("2024-01-01", "departed", true)])[0][0].unknown, ["departure_date", "departure_reason"]);
  assert.deepEqual(careerBands([], [report("2024-01-01", "departed")])[0][0].unknown, ["departure_reason"]);
  assert.deepEqual(careerBands([], [{ ...report("2024-01-01", "departed"), reason: "Contract not renewed" }])[0][0].unknown, []);
  assert.deepEqual(careerBands([bout("1993-01-01")])[1][0].unknown, []);
});

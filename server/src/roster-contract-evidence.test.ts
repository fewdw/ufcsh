import test from "node:test";
import assert from "node:assert/strict";
import { storedRosterHistory } from "./roster-history.ts";
import { careerBands, type TimelineBout } from "./roster-timeline.ts";

test("confirmed same-night contract awards resolve a signing gap after the recruitment bout", () => {
  const rows: TimelineBout[] = [
    { date: "2025-09-28", event_name: "UFC Fight Night", promotion: "ufc", fight_id: "debut", title_type: null, upcoming: false, outcome: "win" },
    { date: "2025-08-19", event_name: "Dana White's Contender Series", promotion: "outside", fight_id: null, title_type: null, upcoming: false, outcome: "win" },
  ];
  const reports = storedRosterHistory().filter(event => event.name === "Cam Rowston" && event.date === "2025-08-19");
  assert.equal(reports.length, 1);
  assert.match(reports[0].source_url, /^https:\/\/www\.ufc\.com\/news\//);
  assert.equal(reports[0].observed, false);
  assert.ok(careerBands(rows).flat().some(band => band.unknown?.includes("signing_date")));
  const bands = careerBands(rows, reports);
  assert.equal(bands.flat().some(band => band.unknown?.includes("signing_date")), false);
  assert.equal(bands[1][0].label, "Signed to UFC");
  // These two won on DWCS but UFC's results explicitly excluded them from
  // that night's contract recipients. Winning alone cannot supply a date.
  assert.equal(storedRosterHistory().some(event => event.name === "Mike Santiago" && event.date === "2017-08-22" && event.kind === "signed"), false);
  assert.equal(storedRosterHistory().some(event => event.name === "Eduardo Chapolin" && event.date === "2025-09-02" && event.kind === "signed"), false);
});

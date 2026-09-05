import test from "node:test";
import assert from "node:assert/strict";
import { FILTER_SECTIONS, sectionActiveCount, sectionKeys, emptyFilters, clearKeys } from "../src/pages/labFilters.ts";

test("clearing a section clears exactly the controls it owns", () => {
  const filters = { ...emptyFilters(), ageMin: "30", oppAgeMin: "20", ageGapMin: "2", from: "2015", division: ["Lightweight"], odds: "underdog" as const };
  const age = FILTER_SECTIONS.find((section) => section.id === "age")!;
  assert.ok(sectionActiveCount(age, filters) > 0);
  const cleared = clearKeys(filters, sectionKeys(age));
  assert.equal(sectionActiveCount(age, cleared), 0, "the section is empty afterwards");
  assert.equal(cleared.from, "2015", "another section is untouched");
  assert.deepEqual(cleared.division, ["Lightweight"]);
  assert.equal(cleared.odds, "underdog");
  // Every key a section names must be a real filter.
  for (const section of FILTER_SECTIONS) {
    for (const key of sectionKeys(section)) assert.ok(key in emptyFilters(), `${section.id} names a filter that does not exist: ${key}`);
  }
});

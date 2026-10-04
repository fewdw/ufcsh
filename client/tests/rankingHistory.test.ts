import test from "node:test";
import assert from "node:assert/strict";
import { rankingChart, rankingTime, rankOn } from "../src/rankingHistory.ts";

const timeline = {
  divisions: [{ division: "Featherweight", points: [
    { date: "2018-07-16", rank: "11" },
    { date: "2020-01-01", rank: null },
    { date: "2021-01-01", rank: "1" },
  ] }],
  through: "2026-09-01", meta_since: null,
  p4p: [{ date: "2020-02-01", rank: "9" }, { date: "2025-01-01", rank: null }],
};
const debut = { date: "2016-11-26", outcome: "win", weight_class: "Lightweight" };

test("ranking lines start at the UFC debut and include NR before, between and after rankings", () => {
  const chart = rankingChart(timeline, [debut])!;
  assert.equal(chart.start, rankingTime(debut.date));
  assert.equal(chart.end, rankingTime(timeline.through));
  const featherweight = chart.lines[0];
  assert.equal(rankOn(featherweight.points, chart.start), "NR");
  assert.equal(rankOn(featherweight.points, rankingTime("2018-07-16") - 1), "NR", "entering the bout uses the previous list");
  assert.equal(rankOn(featherweight.points, rankingTime("2018-07-16")), "11");
  assert.equal(rankOn(featherweight.points, rankingTime("2020-06-01")), "NR");
  assert.equal(rankOn(featherweight.points, chart.end), "1");
  const p4p = chart.lines[1];
  assert.equal(p4p.division, "Pound-for-pound");
  assert.equal(rankOn(p4p.points, chart.start), "NR");
  assert.equal(rankOn(p4p.points, rankingTime("2022-01-01")), "9");
  assert.equal(rankOn(p4p.points, chart.end), "NR");
  assert.equal(timeline.divisions[0].points[0].date, "2018-07-16", "the API timeline is unchanged");
});

test("outside UFC and upcoming bouts do not extend the ranking history", () => {
  const chart = rankingChart(timeline, [
    debut,
    { date: "2012-01-01", outcome: "win", promotion: "outside" },
    { date: "2014-01-01", outcome: null, upcoming: true },
  ])!;
  assert.equal(chart.start, rankingTime(debut.date));
});

test("ranking history never claims NR before official UFC rankings existed", () => {
  assert.equal(rankingChart(timeline, [{ date: "2010-01-01", outcome: "win" }])!.start, rankingTime("2013-02-04"));
});

test("P4P is omitted for a fighter never ranked there, but works without a divisional line", () => {
  assert.equal(rankingChart({ ...timeline, p4p: [] }, [debut])!.lines.length, 1);
  assert.equal(rankingChart({ ...timeline, p4p: [{ date: "2018-01-01", rank: null }] }, [debut])!.lines.length, 1);
  assert.deepEqual(rankingChart({ ...timeline, divisions: [] }, [debut])!.lines.map((line) => line.division), ["Pound-for-pound"]);
  assert.equal(rankingChart(undefined, [debut]), null);
});

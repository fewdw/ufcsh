import test from "node:test";
import assert from "node:assert/strict";
import { fullRankingLists, rankingChart, rankingPath, rankingTime, rankOn } from "../src/rankingHistory.ts";

const timeline = {
  divisions: [{ division: "Featherweight", points: [
    { date: "2018-07-16", rank: "11" },
    { date: "2020-01-01", rank: null },
    { date: "2021-01-01", rank: "1" },
  ] }],
  through: "2026-09-01", meta_since: null,
  p4p: [{ date: "2020-02-01", rank: "9" }, { date: "2025-01-01", rank: null }],
};
const debut = { date: "2016-11-26", outcome: "win" };
const last = { date: "2021-07-10", outcome: "loss" };

test("full tooltip lists retain every career division, complete tied lists, and the correct P4P gender", () => {
  const entries = [{ rank: "C", name: "Champion" }, ...Array.from({ length: 15 }, (_, i) => ({ rank: String(i + 1), name: `Fighter ${i + 1}` })), { rank: "15", name: "Tied fighter" }];
  const divisions = [
    { division: "Women's Strawweight", entries },
    { division: "Women's Pound-for-Pound", entries: [{ rank: "1", name: "Woman" }] },
    { division: "Pound-for-Pound", entries: [{ rank: "1", name: "Man" }] },
    { division: "Lightweight", entries },
  ];
  const lists = fullRankingLists(divisions, ["Women's Flyweight", "Women's Strawweight", "Pound-for-pound"], true);
  assert.deepEqual(lists.map(row => row.division), ["Women's Flyweight", "Women's Strawweight", "Pound-for-pound"]);
  assert.equal(lists[0].list, undefined, "a class without a published list stays unavailable instead of borrowing another class");
  assert.deepEqual(lists[1].list?.entries, entries, "champions, all 15 ranks, and ties are retained");
  assert.equal(lists[2].list?.entries[0].name, "Woman");
  assert.equal(fullRankingLists(divisions, ["Pound-for-pound"], false)[0].list?.entries[0].name, "Man");
  assert.ok(fullRankingLists([], ["Women's Strawweight", "Pound-for-pound"], true).every(row => row.list === undefined), "dates before the archive cannot show today's rankings");
});

test("the chart spans exactly the first and last completed UFC fights", () => {
  const chart = rankingChart(timeline, [last, debut])!;
  assert.equal(chart.start, rankingTime(debut.date));
  assert.equal(chart.end, rankingTime(last.date));
  const featherweight = chart.lines[0];
  assert.equal(rankOn(featherweight.points, chart.start), null);
  assert.equal(rankOn(featherweight.points, rankingTime("2018-07-16") - 1), null);
  assert.equal(rankOn(featherweight.points, rankingTime("2018-07-16")), "11");
  assert.equal(rankOn(featherweight.points, rankingTime("2020-06-01")), null);
  assert.equal(rankOn(featherweight.points, chart.end), "1");
  assert.equal(chart.lines[1].division, "Pound-for-pound");
  assert.equal(rankOn(chart.lines[1].points, chart.start), null);
  assert.equal(rankOn(chart.lines[1].points, chart.end), "9");
  assert.ok(chart.lines.every(line => line.points.every(point => rankingTime(point.date) <= chart.end)));
  assert.equal(timeline.divisions[0].points[0].date, "2018-07-16", "the API timeline is unchanged");
});

test("outside UFC and upcoming bouts do not extend either end of the chart", () => {
  const chart = rankingChart(timeline, [debut, last,
    { date: "2012-01-01", outcome: "win", promotion: "outside" },
    { date: "2026-10-01", outcome: null, upcoming: true },
    { date: "2026-01-01", outcome: "win", promotion: "outside" },
  ])!;
  assert.equal(chart.start, rankingTime(debut.date));
  assert.equal(chart.end, rankingTime(last.date));
  assert.equal(rankingChart(timeline, []), null);
});

test("careers before 2013 still start at the UFC debut, with no invented rankings", () => {
  const chart = rankingChart(timeline, [{ date: "2010-01-01", outcome: "win" }, last])!;
  assert.equal(chart.start, rankingTime("2010-01-01"));
  assert.equal(rankOn(chart.lines[0].points, chart.start), null);
});

test("P4P is omitted if never ranked there and works without a divisional line", () => {
  assert.equal(rankingChart({ ...timeline, p4p: [] }, [debut, last])!.lines.length, 1);
  assert.equal(rankingChart({ ...timeline, p4p: [{ date: "2018-01-01", rank: null }] }, [debut, last])!.lines.length, 1);
  assert.deepEqual(rankingChart({ ...timeline, divisions: [] }, [debut, last])!.lines.map(line => line.division), ["Pound-for-pound"]);
  assert.equal(rankingChart(undefined, [debut]), null);
});

test("a division stops when off the list and restarts without spikes or NR lines", () => {
  const points = [
    { date: "2020-01-01", rank: null },
    { date: "2020-01-02", rank: "5" },
    { date: "2020-01-03", rank: "C" },
    { date: "2020-01-04", rank: null },
    { date: "2020-01-06", rank: "1" },
  ];
  const x = (at: number) => (at - rankingTime("2020-01-01")) / 86_400_000;
  assert.equal(rankingPath(points, rankingTime("2020-01-07"), x, rank => rank === "C" ? 0 : Number(rank)),
    "M1.0,5.0H2.0L2.0,0.0H3.0M5.0,1.0H6.0");
});

test("the rank held before the first fight is clipped into the chart", () => {
  const chart = rankingChart(timeline, [{ date: "2019-01-01", outcome: "win" }, last])!;
  assert.deepEqual(chart.lines[0].points[0], { date: "2019-01-01", rank: "11" });
});

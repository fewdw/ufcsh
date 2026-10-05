import test from "node:test";
import assert from "node:assert/strict";
import { rankingArchiveUrl, rankingChart, rankingListOn, rankingPath, rankingTime, rankOn } from "../src/rankingHistory.ts";

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

test("preloaded lists select the last publication without leaking future ranks or removed divisions", () => {
  const archive = {
    dates: ["2020-01-01", "2020-01-08", "2020-01-15", "2020-01-22"],
    fighters: [["Champion", "champion"], ["Fighter", "fighter"], ["Tied fighter", null]] as [string, string | null][],
    lists: [
      { date: "2020-01-01", entries: [["C", 0], ["15", 1], ["15", 2]] as [string, number][] },
      { date: "2020-01-15", entries: [] },
      { date: "2020-01-22", entries: [["1", 1]] as [string, number][] },
    ],
  };
  assert.equal(rankingListOn(archive, "2019-12-31"), null);
  assert.equal(rankingListOn(archive, "2020-01-07")!.as_of, "2020-01-01");
  assert.equal(rankingListOn(archive, "2020-01-08")!.as_of, "2020-01-08", "an unchanged list retains the selected publication date");
  assert.deepEqual(rankingListOn(archive, "2020-01-14")!.entries.map(row => [row.rank, row.name, row.fighter_id]), [
    ["C", "Champion", "champion"], ["15", "Fighter", "fighter"], ["15", "Tied fighter", null],
  ], "champions, tied ranks and unlinked names are preserved");
  assert.equal(rankingListOn(archive, "2020-01-15"), null);
  assert.equal(rankingListOn(archive, "2020-01-21"), null);
  assert.equal(rankingListOn(archive, "2020-01-22")!.entries[0].rank, "1");
  assert.equal(rankingListOn(archive, "2026-01-01")!.as_of, "2020-01-22");
  assert.equal(rankingListOn({ dates: [], fighters: [], lists: [] }, "2020-01-01"), null);
});

test("archive keys reuse divisions between fighters and keep P4P on the correct gender/media source", () => {
  const url = (name: string, womens: boolean, source: "media" | "meta") => new URL(rankingArchiveUrl(name, womens, source), "http://test");
  assert.equal(url("Women's Strawweight", true, "meta").searchParams.get("division"), "Women's Strawweight");
  assert.equal(url("Women's Strawweight", true, "meta").searchParams.get("ranking"), "meta");
  assert.equal(url("Pound-for-pound", true, "meta").searchParams.get("division"), "Women's Pound-for-Pound");
  assert.equal(url("Pound-for-pound", false, "meta").searchParams.get("division"), "Men's Pound-for-Pound");
  assert.equal(rankingArchiveUrl("Pound-for-pound", true, "meta"), rankingArchiveUrl("Pound-for-pound", true, "media"));
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

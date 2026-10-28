import test from "node:test";
import assert from "node:assert/strict";
import { marketAnalytics, noVig, parseHistory } from "./polymarket-math.ts";

test("sportsbook comparison removes both sides' margin and preserves corner order", () => {
  assert.equal(noVig("-110", "-110"), 0.5);
  const p = noVig("−200", "+150")!;
  assert.ok(Math.abs(p - 0.625) < 1e-9);
  assert.ok(Math.abs(noVig("+150", "-200")! - (1 - p)) < 1e-9);
  for (const value of [null, "", "bad", "0", "1.6", "-99", Infinity, {}, true])
    assert.equal(noVig(value, "-110"), null);
});

test("history validates prices, reverses corners, and excludes buckets crossing the pre-fight cutoff", () => {
  const points = parseHistory(
    {
      data: [
        { timestamp: 300, price: 0.4, resolution_seconds: 60 },
        { timestamp: 100, price: "0.2", resolution_seconds: 60 },
        { timestamp: 150, price: 0.3, resolution_seconds: 60 },
        { timestamp: 200, price: 0.35, resolution_seconds: 60 },
        { timestamp: 400, price: "junk", resolution_seconds: 60 },
        { timestamp: 410, price: null, resolution_seconds: 60 },
        { timestamp: 420, price: 0.4 },
        { timestamp: 600, price: 0.6, resolution_seconds: 60 },
      ],
    },
    true,
    210_000,
    500_000,
  );
  assert.deepEqual(
    points.map((p) => [p.at, p.p, p.phase]),
    [
      [100_000, 0.8, "prefight"],
      [150_000, 0.7, "unknown"],
      [200_000, 0.65, "unknown"],
      [300_000, 0.6, "unknown"],
    ],
  );
  assert.deepEqual(parseHistory({ history: [] }, false, 0, 0), []);
});

test("source scores use an identical cohort, keep 50/50s in Brier and exclude them from winner accuracy", () => {
  const data = marketAnalytics([
    {
      id: "a",
      label: "a",
      date: "2026-01-01",
      at: 1000,
      p: 0.8,
      sports: 0.6,
      community: 0.5,
      won: true,
    },
    {
      id: "b",
      label: "b",
      date: "2026-01-01",
      at: 1000,
      p: 0.4,
      sports: 0.2,
      community: 0.7,
      won: false,
    },
    {
      id: "c",
      label: "c",
      date: "2026-01-01",
      at: 1000,
      p: 0.99,
      sports: null,
      community: 0.9,
      won: true,
    },
    {
      id: "bad",
      label: "bad",
      date: "2026-01-01",
      at: 1000,
      p: NaN,
      sports: 0.2,
      community: 0.7,
      won: false,
    },
  ]);
  assert.equal(data.fights, 3);
  assert.equal(data.common, 2);
  assert.ok(data.sources.every((s) => s.n === 2));
  assert.ok(Math.abs(data.sources[0].brier! - 0.1) < 1e-9);
  assert.equal(data.sources[0].accuracy, 1);
  assert.equal(data.sources[2].accuracy, 0);
  assert.ok(
    data.sources.every((s) => s.bins.reduce((n, b) => n + b.n, 0) === s.n),
  );
  assert.ok(
    marketAnalytics([]).sources.every(
      (s) => s.brier == null && s.accuracy == null,
    ),
  );
});

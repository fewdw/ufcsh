import test from "node:test";
import assert from "node:assert/strict";
import { predictionRoundShares, type PredictionDistribution } from "../src/predictions.ts";

test("mixed communities retain Verdict decisions and leave unpublished finish rounds unspecified", () => {
  const distribution: PredictionDistribution = {
    total: 105, local: 5,
    fighters: [
      { fighterId: "a", name: "A", count: 63,
        methods: [{ method: "ko", count: 12 }, { method: "submission", count: 5 }, { method: "decision", count: 45 }, { method: null, count: 1 }],
        rounds: [{ round: 1, count: 0 }, { round: 2, count: 1 }, { round: 3, count: 0 }, { round: null, count: 2 }] },
      { fighterId: "b", name: "B", count: 42,
        methods: [{ method: "ko", count: 20 }, { method: "submission", count: 1 }, { method: "decision", count: 21 }],
        rounds: [{ round: 1, count: 0 }, { round: 2, count: 0 }, { round: 3, count: 1 }, { round: null, count: 1 }] },
    ],
    methods: [{ method: "ko", count: 32 }, { method: "submission", count: 6 }, { method: "decision", count: 66 }, { method: null, count: 1 }],
    rounds: [{ round: 1, count: 0 }, { round: 2, count: 1 }, { round: 3, count: 1 }, { round: null, count: 3 }],
  };
  const rounds = predictionRoundShares(distribution);
  assert.deepEqual(rounds.map(round => [round.short, round.count, round.sides]), [
    ["1", 0, [0, 0]], ["2", 1, [1, 0]], ["3", 1, [0, 1]], ["DEC", 66, [45, 21]], ["?", 37, [17, 20]],
  ]);
  assert.equal(rounds.reduce((sum, round) => sum + round.count, 0), distribution.total);
});

test("Verdict-only and local-only polls keep every pick, including bouts without scheduled rounds", () => {
  for (const local of [0, 10]) for (const length of [0, 3, 5]) {
    const distribution: PredictionDistribution = {
      total: 10, local,
      fighters: [
        { fighterId: "a", name: "A", count: 4, methods: [{ method: "decision", count: 4 }], rounds: [] },
        { fighterId: "b", name: "B", count: 6, methods: [{ method: "decision", count: 6 }], rounds: [] },
      ],
      methods: [{ method: "decision", count: 10 }],
      rounds: Array.from({ length }, (_, index) => ({ round: index + 1, count: 0 })),
    };
    const rounds = predictionRoundShares(distribution);
    assert.equal(rounds.length, length + 1);
    assert.deepEqual(rounds.at(-1), { key: "decision", label: "Decision", short: "DEC", sides: [4, 6], count: 10 });
    assert.ok(rounds.slice(0, -1).every(round => round.count === 0));
  }
});

test("winner-only picks remain unspecified instead of being called decisions", () => {
  const rounds = predictionRoundShares({ total: 2, local: 2,
    fighters: [{ fighterId: "a", name: "A", count: 2, methods: [{ method: null, count: 2 }], rounds: [] }],
    methods: [{ method: null, count: 2 }], rounds: [],
  });
  assert.equal(rounds.find(round => round.short === "DEC")?.count, 0);
  assert.equal(rounds.find(round => round.short === "?")?.count, 2);
});

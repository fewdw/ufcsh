import test from "node:test";
import assert from "node:assert/strict";
import { decisionScores, roundOutcomes, roundStrikes, yearlyStrikes, type RoundOutcome } from "./fight-insights.ts";
import { careerStatistics } from "./career-statistics.ts";
import { fightIndex, type IndexedFight } from "./fight-index.ts";

const bout = (outcome: string, method: string, round: number | null, scheduledRounds = 3) => ({
  id: "fight", date: "2025-01-01", method, round, scheduledRounds,
  sides: [{ id: "a", name: "A", outcome }, { id: "b", name: "B", outcome: outcome === "win" ? "loss" : outcome === "loss" ? "win" : outcome }],
}) as unknown as IndexedFight;

test("yearly strikes use total recorded time, preserve zero rates, and exclude unpaired or missing samples", () => {
  const struck = (year: number, seconds: number | null, landed: number | null, absorbed: number | null, reverse = false) => {
    const actions = (count: number | null) => count == null ? {} : { significantStrikes: { scored: count, attempted: null } };
    const sides = [{ id: "a", actions: actions(landed) }, { id: "b", actions: actions(absorbed) }];
    return { ...bout("nc", "Overturned", 1), year, elapsed: seconds, sides: reverse ? sides.reverse() : sides } as unknown as IndexedFight;
  };
  assert.deepEqual(yearlyStrikes([
    struck(2025, 60, 30, 10),
    struck(2023, 300, 0, 0),
    struck(2025, 540, 30, 20, true),
    struck(2025, 300, null, 999),
    struck(2025, 300, 999, null),
    struck(2025, null, 999, 999),
    struck(2025, 0, 999, 999),
    struck(2026, null, 10, 10),
  ], "a"), [
    { year: 2023, bouts: 1, fights: 1, landed: 0, absorbed: 0 },
    { year: 2025, bouts: 6, fights: 2, landed: 6, absorbed: 3 },
    { year: 2026, bouts: 1, fights: 0, landed: null, absorbed: null },
  ]);
  assert.deepEqual(yearlyStrikes([], "a"), []);
});

test("archive: every year's strike rates agree with career-stat evidence for the same bouts", () => {
  const index = fightIndex();
  for (const fighter of index.fighters.values()) {
    const evidence = careerStatistics(index, fighter.id)!;
    for (const year of yearlyStrikes(fighter.fights, fighter.id)) {
      const rows = evidence.rows.filter(row => Number(row.date.slice(0, 4)) === year.year);
      const samples = rows.filter(row => row.totals.seconds > 0);
      const seconds = samples.reduce((sum, row) => sum + row.totals.seconds, 0);
      assert.equal(year.bouts, rows.length, fighter.name);
      assert.equal(year.fights, samples.length, fighter.name);
      assert.equal(year.landed, seconds ? samples.reduce((sum, row) => sum + row.totals.sigLanded, 0) / seconds * 60 : null, fighter.name);
      assert.equal(year.absorbed, seconds ? samples.reduce((sum, row) => sum + row.totals.sigAbsorbed, 0) / seconds * 60 : null, fighter.name);
    }
  }
});

test("round outcomes: finishes in their round, decisions past every round, no contests left out", () => {
  const result = roundOutcomes([
    bout("win", "KO/TKO", 1),
    bout("loss", "SUB", 2),
    bout("win", "U-DEC", 3),
    bout("loss", "S-DEC", 5, 5),
    bout("draw", "M-DEC", 3),
    bout("win", "DQ", 2),
    bout("nc", "Overturned", 1),
    bout("draw", "Other", 2),
  ], "a")!;
  assert.equal(result.fights, 6);
  assert.deepEqual(result.rounds.map(({ bouts: _, ...round }) => round), [
    { round: 1, won: 1, lost: 0, past: 5 },
    { round: 2, won: 1, lost: 1, past: 3 },
    { round: 3, won: 0, lost: 0, past: 3 },
    { round: 4, won: 0, lost: 0, past: 1 },
    { round: 5, won: 0, lost: 0, past: 1 },
  ]);
  // Each ending names the bout: result, method and opponent, in the order fought.
  assert.deepEqual(result.rounds.map(round => round.bouts), [
    [{ outcome: "win", method: "KO/TKO", opponent: "B" }],
    [{ outcome: "loss", method: "SUB", opponent: "B" }, { outcome: "win", method: "DQ", opponent: "B" }],
    [], [], [],
  ]);
  const { bouts, ...decision } = result.decision;
  assert.deepEqual(decision, { won: 1, lost: 1, drawn: 1 });
  assert.deepEqual(bouts.map(bout => `${bout.outcome} ${bout.method}`), ["win U-DEC", "loss S-DEC", "draw M-DEC"]);
  assert.equal(roundOutcomes([bout("nc", "CNC", 1)], "a"), null);
});

test("archive: every counted bout starts round one, and ends once", () => {
  const index = fightIndex();
  for (const fighter of index.fighters.values()) {
    const rounds = roundOutcomes(fighter.fights, fighter.id);
    if (!rounds) continue;
    const ended = rounds.rounds.reduce((sum, round) => sum + round.won + round.lost, 0)
      + rounds.decision.won + rounds.decision.lost + rounds.decision.drawn;
    assert.equal(ended, rounds.fights, fighter.name);
    for (const part of [...rounds.rounds, rounds.decision]) {
      assert.equal(part.bouts.length, part.won + part.lost + ("drawn" in part ? part.drawn : 0), fighter.name);
      assert(part.bouts.every(bout => bout.opponent), fighter.name);
    }
    const first = rounds.rounds[0];
    assert.equal(first.won + first.lost + first.past, rounds.fights, fighter.name);
    for (const [at, round] of rounds.rounds.entries()) {
      const next: RoundOutcome | undefined = rounds.rounds[at + 1];
      if (next) assert(next.won + next.lost + next.past <= round.past, `${fighter.name} R${next.round}`);
    }
  }
});

test("decision scores: every judge's card and fan average, by length, from the fighter's side", () => {
  const scored = (id: string, rounds: number, cards: [number, number][], fans?: [number, number]) => ({
    ...bout(id === "a" ? "win" : "loss", "U-DEC", rounds, rounds),
    sides: id === "a" ? [{ id: "a", name: "A", outcome: "win" }, { id: "b", name: "B", outcome: "loss" }] : [{ id: "b", name: "B", outcome: "win" }, { id: "a", name: "A", outcome: "loss" }],
    row: {
      detail_json: JSON.stringify({ judges: cards.map(([f1Score, f2Score]) => ({ judge: "J", f1Score, f2Score })) }),
      community_score_json: fans ? JSON.stringify({ cards: 900, avg1: fans[0], avg2: fans[1], rounds: Array.from({ length: rounds }, (_, index) => ({ round: index + 1, avg1: fans[0] / rounds, avg2: fans[1] / rounds })) }) : null,
    },
  }) as unknown as IndexedFight;
  assert.deepEqual(decisionScores([scored("a", 5, [[50, 45], [50, 45], [50, 45]], [50, 45])], "a"), [
    { rounds: 5, fights: 1, own: 50, opponent: 45 },
  ]);
  const result = decisionScores([
    scored("a", 3, [[30, 27], [29, 28], [28, 29]], [29, 28]),
    // Fought from the other corner and lost: the scores swap sides.
    scored("b", 3, [[30, 27], [30, 27], [30, 27]]),
    scored("a", 5, [[48, 47], [48, 47], [47, 48]]),
    // A total no three-round card can carry is left out, as is a finish.
    scored("a", 3, [[48, 47], [48, 47], [48, 47]]),
    { ...scored("a", 3, [[30, 27], [30, 27], [30, 27]]), method: "KO/TKO" },
  ], "a")!;
  // Three-rounders: three judges and the fans, then three judges: seven cards.
  assert.deepEqual(result, [
    { rounds: 3, fights: 2, own: (30 + 29 + 28 + 29 + 27 * 3) / 7, opponent: (27 + 28 + 29 + 28 + 30 * 3) / 7 },
    { rounds: 5, fights: 1, own: 143 / 3, opponent: 142 / 3 },
  ]);
  assert.equal(decisionScores([bout("win", "KO/TKO", 1)], "a"), null);
});

test("round strikes: mean landed and absorbed over the bouts that reached each round, from the fighter's side", () => {
  const struck = (id: string, own: number[], faced: number[]) => {
    const sides = [{ id: "a", name: "A", outcome: "win", rounds: own.map(sig => ({ sig })) }, { id: "b", name: "B", outcome: "loss", rounds: faced.map(sig => ({ sig })) }];
    return { ...bout("win", "U-DEC", own.length), sides: id === "a" ? sides : sides.reverse() } as unknown as IndexedFight;
  };
  assert.deepEqual(roundStrikes([
    struck("a", [10, 20, 30], [5, 5, 5]),
    struck("b", [20], [15]),
    // Rounds recorded for one corner only say nothing of the other.
    struck("a", [99, 99], []),
    struck("a", [], []),
  ], "a"), [
    { round: 1, fights: 2, landed: 15, absorbed: 10 },
    { round: 2, fights: 1, landed: 20, absorbed: 5 },
    { round: 3, fights: 1, landed: 30, absorbed: 5 },
  ]);
  assert.equal(roundStrikes([bout("win", "KO/TKO", 1)], "a"), null);
});

test("archive: round strikes cover no more bouts than were fought, fewer each round", () => {
  for (const fighter of fightIndex().fighters.values()) {
    const strikes = roundStrikes(fighter.fights, fighter.id);
    if (!strikes) continue;
    assert(strikes[0].fights <= fighter.fights.length, fighter.name);
    for (const [at, round] of strikes.entries()) {
      assert.equal(round.round, at + 1, fighter.name);
      assert(round.fights > 0 && round.landed >= 0 && round.absorbed >= 0, fighter.name);
      if (at) assert(round.fights <= strikes[at - 1].fights, `${fighter.name} R${round.round}`);
    }
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { oddsRecord, roundOutcomes, type RoundOutcome } from "./fight-insights.ts";
import { fightIndex, type IndexedFight } from "./fight-index.ts";

const bout = (outcome: string, method: string, round: number | null, scheduledRounds = 3, close: [number | null, number | null] = [null, null]) => ({
  method, round, scheduledRounds,
  sides: [{ id: "a", outcome, close: close[0] }, { id: "b", outcome: outcome === "win" ? "loss" : outcome === "loss" ? "win" : outcome, close: close[1] }],
}) as unknown as IndexedFight;

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
  assert.deepEqual(result.rounds, [
    { round: 1, won: 1, lost: 0, past: 5 },
    { round: 2, won: 1, lost: 1, past: 3 },
    { round: 3, won: 0, lost: 0, past: 3 },
    { round: 4, won: 0, lost: 0, past: 1 },
    { round: 5, won: 0, lost: 0, past: 1 },
  ]);
  assert.deepEqual(result.decision, { won: 1, lost: 1, drawn: 1 });
  assert.equal(roundOutcomes([bout("nc", "CNC", 1)], "a"), null);
});

test("odds record removes the margin and counts only decided, priced bouts", () => {
  const result = oddsRecord([
    bout("win", "KO/TKO", 1, 3, [-200, 170]),
    bout("loss", "U-DEC", 3, 3, [-150, 130]),
    bout("win", "SUB", 1),
    bout("draw", "M-DEC", 3, 3, [100, -120]),
  ], "a")!;
  const fair = (a: number, b: number) => a / (a + b);
  const expected = fair(200 / 300, 100 / 270) + fair(150 / 250, 100 / 230);
  assert.deepEqual({ ...result, expected: 0 }, { fights: 3, priced: 2, wins: 1, expected: 0 });
  assert.equal(result.expected, Math.round(expected * 10) / 10);
  assert.equal(oddsRecord([bout("nc", "CNC", 1)], "a"), null);
});

test("archive: every counted bout starts round one, and ends once", () => {
  const index = fightIndex();
  for (const fighter of index.fighters.values()) {
    const rounds = roundOutcomes(fighter.fights, fighter.id);
    if (!rounds) continue;
    const ended = rounds.rounds.reduce((sum, round) => sum + round.won + round.lost, 0)
      + rounds.decision.won + rounds.decision.lost + rounds.decision.drawn;
    assert.equal(ended, rounds.fights, fighter.name);
    const first = rounds.rounds[0];
    assert.equal(first.won + first.lost + first.past, rounds.fights, fighter.name);
    for (const [at, round] of rounds.rounds.entries()) {
      const next: RoundOutcome | undefined = rounds.rounds[at + 1];
      if (next) assert(next.won + next.lost + next.past <= round.past, `${fighter.name} R${next.round}`);
    }
    const odds = oddsRecord(fighter.fights, fighter.id);
    if (odds) assert(odds.priced <= odds.fights && odds.wins <= odds.priced && odds.expected <= odds.priced + 0.05, fighter.name);
  }
});

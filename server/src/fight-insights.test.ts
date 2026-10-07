import test from "node:test";
import assert from "node:assert/strict";
import { roundOutcomes, type RoundOutcome } from "./fight-insights.ts";
import { fightIndex, type IndexedFight } from "./fight-index.ts";

const bout = (outcome: string, method: string, round: number | null, scheduledRounds = 3) => ({
  id: "fight", date: "2025-01-01", method, round, scheduledRounds,
  sides: [{ id: "a", name: "A", outcome }, { id: "b", name: "B", outcome: outcome === "win" ? "loss" : outcome === "loss" ? "win" : outcome }],
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

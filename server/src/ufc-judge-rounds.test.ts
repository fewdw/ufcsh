import test from "node:test";
import assert from "node:assert/strict";
import { bugReport } from "./bugs.ts";
import { db } from "./db.ts";
import { parseFightRoundScores } from "./scrape/ufccom.ts";
import { rereadUfcJudgeRounds } from "./ufc-judge-rounds.ts";

type Card = { judge: string; id: number; rounds: [number, number][] };
const side = (red: number, blue: number, a: number, b: number) => [{ FighterId: blue, Score: b }, { FighterId: red, Score: a }];
/** A fight feed shaped like ufc.com's: rounds list fighters in either order. */
function feed(fightId: number, red: string, blue: string, cards: Card[], totals = cards) {
  const name = (full: string) => ({ FirstName: full.split(" ")[0], LastName: full.split(" ").slice(1).join(" ") });
  const judge = (card: Card) => ({ JudgeId: card.id, JudgeFirstName: card.judge.split(" ")[0], JudgeLastName: card.judge.split(" ").slice(1).join(" ") });
  return { LiveFightDetail: {
    FightId: fightId,
    Fighters: [{ FighterId: 1, Name: name(red), Corner: "Red" }, { FighterId: 2, Name: name(blue), Corner: "Blue" }],
    Result: {
      Method: "Decision - Unanimous",
      FightScores: totals.map(card => ({ ...judge(card), Fighters: side(1, 2,
        card.rounds.reduce((sum, [a]) => sum + a, 0), card.rounds.reduce((sum, [, b]) => sum + b, 0)) })),
      RoundScores: cards.map(card => ({ ...judge(card), Rounds: card.rounds.map(([a, b], index) => ({ RoundNumber: index + 1, Fighters: side(1, 2, a, b) })).reverse() })),
    },
  } };
}
const panel: Card[] = [
  { judge: "Adrian Castro", id: 523, rounds: [[10, 9], [9, 10], [10, 9]] },
  { judge: "Sal D'amato", id: 14, rounds: [[10, 9], [10, 9], [10, 9]] },
  { judge: "Chris Lee", id: 17, rounds: [[9, 10], [10, 9], [10, 9]] },
];

test("a fight feed's round cards are read in its fighter order and checked against its own totals", () => {
  const parsed = parseFightRoundScores(feed(13140, "Ciryl Gane", "Josh Hokit", panel));
  assert.equal(parsed?.f1Name, "Ciryl Gane");
  assert.deepEqual(parsed?.judges[0], { judge: "Adrian Castro", f1Score: 29, f2Score: 28,
    rounds: [{ round: 1, f1Score: 10, f2Score: 9 }, { round: 2, f1Score: 9, f2Score: 10 }, { round: 3, f1Score: 10, f2Score: 9 }] });
  // A total that disagrees with the rounds, or a missing round score, drops that card alone.
  const wrongTotal = feed(1, "A B", "C D", panel, [{ ...panel[0], rounds: [[10, 9], [10, 9], [10, 9]] }, panel[1], panel[2]]);
  assert.deepEqual(parseFightRoundScores(wrongTotal)?.judges.map(card => card.judge), ["Sal D'amato", "Chris Lee"]);
  const blank = feed(1, "A B", "C D", panel);
  (blank.LiveFightDetail.Result.RoundScores[2].Rounds[0].Fighters[0] as { Score: number | null }).Score = null;
  assert.deepEqual(parseFightRoundScores(blank)?.judges.map(card => card.judge), ["Adrian Castro", "Sal D'amato"]);
  // A finish lists judges with no round scores at all.
  const finish = feed(1, "A B", "C D", panel.map(card => ({ ...card, rounds: [] })));
  assert.deepEqual(parseFightRoundScores(finish)?.judges, []);
  assert.equal(parseFightRoundScores({}), null);
});

test("a decision's missing round cards are filled from the feed, aligned to our corners", async () => {
  const fight = db.prepare(`SELECT f.id, f.event_id, f.f1_name, f.f2_name FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.method LIKE '%DEC' AND f.round = '3' AND f.f1_outcome = 'win' ORDER BY e.date DESC LIMIT 1`).get() as { id: string; event_id: string; f1_name: string; f2_name: string };
  // ufc.com lists the bout with its corners the other way round.
  const reversed = panel.map(card => ({ ...card, rounds: card.rounds.map(([a, b]) => [b, a] as [number, number]) }));
  const totals = panel.map(card => ({ judge: card.judge, f1Score: card.rounds.reduce((s, [a]) => s + a, 0), f2Score: card.rounds.reduce((s, [, b]) => s + b, 0) }));
  const priorFetch = globalThis.fetch;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE events SET ufc_event_id = 987654 WHERE id = ?").run(fight.event_id);
    db.prepare("UPDATE fights SET judge_rounds_json = NULL, detail_json = ? WHERE id = ?").run(JSON.stringify({ type: "past", judges: totals }), fight.id);
    const actions = () => bugReport().checks.find(row => row.id === "decision-no-judge-rounds")!.items.find(item => item.key === fight.id)!.actions;
    assert.equal(actions()[0]?.id, "ufc-rounds");
    let fightFeed: unknown = feed(55555, fight.f2_name, fight.f1_name, reversed);
    globalThis.fetch = async input => new Response(JSON.stringify(String(input).includes("/event/live/987654")
      ? { LiveEventDetail: { EventId: 987654, FightCard: [{ FightId: 55555, Fighters: [fight.f2_name, fight.f1_name].map(full => ({ Name: { FirstName: full.split(" ")[0], LastName: full.split(" ").slice(1).join(" ") } })) }] } }
      : fightFeed));
    // Totals that contradict UFCStats' official cards attach nothing.
    fightFeed = feed(55555, fight.f2_name, fight.f1_name, reversed.map(card => ({ ...card, rounds: [[10, 9], [10, 9], [10, 9]] })));
    assert.equal((await rereadUfcJudgeRounds(fight.id)).ok, false);
    assert.equal((db.prepare("SELECT judge_rounds_json FROM fights WHERE id = ?").get(fight.id) as { judge_rounds_json: string | null }).judge_rounds_json, null);
    fightFeed = feed(55555, fight.f2_name, fight.f1_name, reversed);
    assert.equal((await rereadUfcJudgeRounds(fight.id)).ok, true);
    const stored = JSON.parse((db.prepare("SELECT judge_rounds_json FROM fights WHERE id = ?").get(fight.id) as { judge_rounds_json: string }).judge_rounds_json);
    assert.equal(stored.source, "UFC");
    assert.deepEqual(stored.judges.map((card: { judge: string }) => card.judge), panel.map(card => card.judge));
    assert.deepEqual(stored.judges[0].rounds.map((round: { f1Score: number; f2Score: number }) => [round.f1Score, round.f2Score]), panel[0].rounds);
  } finally { globalThis.fetch = priorFetch; db.exec("ROLLBACK"); }
});

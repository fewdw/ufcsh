import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { importVerdictPickCard } from "./verdict-picks.ts";

test("Verdict picks land on the matching bout in our corner order and a pickless copy never clears them", async () => {
  const fight = db.prepare(`SELECT f.id, f.f1_name, f.f2_name, e.date FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND e.date >= '2024-01-01' ORDER BY e.date DESC LIMIT 1`).get() as { id: string; f1_name: string; f2_name: string; date: string };
  const person = (id: number, name: string) => {
    const [first, ...rest] = name.split(" ");
    return { fighterID: id, fighterFirstName: first, fighterLastName: rest.join(" ") };
  };
  // Verdict lists our second corner first.
  const verdictBout = (eventId: number, picked: boolean) => ({
    eventID: eventId, fightNumber: 2, roundsCount: 3, fighter1: person(1, fight.f2_name), fighter2: person(2, fight.f1_name),
    fightPoll: picked ? {
      fightBallots: { global: { fighterID: 2, fightVictoryTerms: 0, roundNumber: -1, count: 45 } },
      rates: [[1, [5.71, 20, 26.67, 11.43]], [2, [1.21, 26.67, 4.44, 1.78]]].map(([fighterID, [multiplier, ko, sub, dec]]: any) => ({
        fighterID, multiplier, subrates: [{ fightVictoryTerms: 2, multiplier: ko }, { fightVictoryTerms: 1, multiplier: sub }, { fightVictoryTerms: 0, multiplier: dec }],
      })),
    } : { fightBallots: { global: null }, rates: {} },
  });
  const stranger = (eventId: number) => ({ eventID: eventId, fightNumber: 3, fighter1: person(3, "Nobody Here"), fighter2: person(4, "Someone Else") });
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    const eventId = Number(url.searchParams.get("eventID"));
    if (url.searchParams.get("fightNumber") !== "2") return new Response('{"message":"Fight not found"}', { status: 404 });
    const own = verdictBout(eventId, eventId === 999999);
    return Response.json({ fight: own, event: { eventDate: Date.parse(`${fight.date}T22:00:00Z`) / 1000, eventStatus: 3, fights: [stranger(eventId), own] } });
  };
  const ids = db.prepare("SELECT f1_id, f2_id FROM fights WHERE id = ?").get(fight.id) as { f1_id: string; f2_id: string };
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(fight.id);
    assert.deepEqual(await importVerdictPickCard(999999), { bouts: 2, matched: 1, stored: 1 });
    const stored = () => JSON.parse((db.prepare("SELECT verdict_picks_json AS v FROM fights WHERE id = ?").get(fight.id) as { v: string }).v);
    const { fetchedAt, ...rest } = stored();
    assert.ok(fetchedAt > 0);
    assert.deepEqual(rest, {
      source: "Verdict MMA", sourceUrl: "https://verdictmma.com/event/999999/fight/2", final: true, f1Id: ids.f1_id, f2Id: ids.f2_id,
      total: 80, least: 80, exact: true, fits: true,
      f1: { ko: 3, submission: 18, decision: 45 }, f2: { ko: 4, submission: 3, decision: 7 },
    });
    const card = db.prepare("SELECT date, final FROM verdict_pick_cards WHERE verdict_id = 999999").get() as { date: string; final: number };
    assert.equal(card.final, 1);
    assert.equal((await importVerdictPickCard(999998)).stored, 0);
    assert.equal(stored().total, 80);
  } finally { globalThis.fetch = priorFetch; db.exec("ROLLBACK"); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { VERDICT_PICKS_FORMAT } from "./predictions.ts";
import { importVerdictPickCard, pairing, rematchVerdictPicks, syncVerdictPicks } from "./verdict-picks.ts";

type Fight = { id: string; event_id: string; f1_name: string; f2_name: string; f1_id: string; f2_id: string; date: string };
const fight = () => db.prepare(`SELECT f.id, f.event_id, f.f1_name, f.f2_name, f.f1_id, f.f2_id, e.date FROM fights f JOIN events e ON e.id = f.event_id
  WHERE e.complete = 1 AND e.date >= '2024-01-01' ORDER BY e.date DESC LIMIT 1`).get() as Fight;
const person = (id: number, name: string) => {
  const [first, ...rest] = name.split(" ");
  return { fighterID: id, fighterFirstName: first, fighterLastName: rest.join(" ") };
};
const rates = (prices: [number, number[]][]) => prices.map(([fighterID, [multiplier, ko, sub, dec]]) => ({
  fighterID, multiplier, subrates: [{ fightVictoryTerms: 2, multiplier: ko }, { fightVictoryTerms: 1, multiplier: sub }, { fightVictoryTerms: 0, multiplier: dec }],
}));
// RIZIN's Oshima–Kuziutina prices: exactly 80 picks, 45 on Verdict's second corner by decision.
const picked = { fightBallots: { global: { fighterID: 2, fightVictoryTerms: 0, roundNumber: -1, count: 45 } },
  rates: rates([[1, [5.71, 20, 26.67, 11.43]], [2, [1.21, 26.67, 4.44, 1.78]]]) };
// The same prices with a top ballot read later, when more picks had come in: no total fits.
const unfit = { ...picked, fightBallots: { global: { ...picked.fightBallots.global, count: 60 } } };
const none = { fightBallots: { global: null }, rates: {} };

/** Verdict, as `/api/v1/fight` answers: bout 2 is ours with our corners
 * reversed (or another opponent), bout 3 is someone else's. */
function mockVerdict(local: Fight, polls: Record<number, object>, opponent = local.f1_name, association = "UFC",
  { active = 1, listed = true, emptyList = false }: { active?: number; listed?: boolean; emptyList?: boolean } = {}) {
  const prior = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    const eventId = Number(url.searchParams.get("eventID"));
    const number = url.searchParams.get("fightNumber");
    if (number !== "2" && !(number === "3" && !listed)) return new Response('{"message":"Fight not found"}', { status: 404 });
    const own = { eventID: eventId, fightNumber: 2, roundsCount: 3, fighter1: person(1, local.f2_name), fighter2: person(2, opponent), fightPoll: polls[eventId] };
    const stranger = { eventID: eventId, fightNumber: 3, fighter1: person(3, "Nobody Here"), fighter2: person(4, "Someone Else") };
    return Response.json({ fight: listed ? own : stranger,
      event: { eventDate: Date.parse(`${local.date}T22:00:00Z`) / 1000, eventStatus: 3, eventAssociation: association, eventActive: active, fights: emptyList ? [] : listed ? [stranger, own] : [stranger] } });
  };
  return () => { globalThis.fetch = prior; };
}
const stored = (id: string) => {
  const row = db.prepare("SELECT verdict_picks_json AS v FROM fights WHERE id = ?").get(id) as { v: string | null };
  const value = row.v ? JSON.parse(row.v) : null;
  return value?.cleared ? null : value;
};

test("Verdict picks land on the matching bout in our corner order and a pickless copy never clears them", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999999: picked, 999998: none });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    assert.deepEqual(await importVerdictPickCard(999999), { bouts: 2, matched: 1, stored: 1 });
    const { fetchedAt, ...rest } = stored(local.id);
    assert.ok(fetchedAt > 0);
    assert.deepEqual(rest, {
      format: VERDICT_PICKS_FORMAT, source: "Verdict MMA", sourceUrl: "https://verdictmma.com/event/999999/fight/2", final: true, f1Id: local.f1_id, f2Id: local.f2_id,
      total: 80, least: 80, exact: true, fits: true,
      f1: { ko: 3, submission: 18, decision: 45 }, f2: { ko: 4, submission: 3, decision: 7 },
    });
    assert.equal((db.prepare("SELECT final FROM verdict_pick_cards WHERE verdict_id = 999999").get() as { final: number }).final, 1);
    assert.equal((await importVerdictPickCard(999998)).stored, 0);
    assert.equal(stored(local.id).total, 80);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a bout sharing one fighter and only a first name with ours is another matchup", async () => {
  const local = fight();
  // Ferguson–Johnson is not Ferguson–Chandler because both Michaels.
  const restore = mockVerdict(local, { 999997: picked }, `${local.f1_name.split(" ")[0]} Unrelatedperson`);
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    assert.equal((await importVerdictPickCard(999997)).matched, 0);
    assert.equal(stored(local.id), null);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("another promotion's card is never matched to our bouts", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999994: picked }, local.f1_name, "PFL");
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    assert.deepEqual(await importVerdictPickCard(999994), { bouts: 2, matched: 0, stored: 0 });
    assert.equal(stored(local.id), null);
    assert.equal((db.prepare("SELECT final FROM verdict_pick_cards WHERE verdict_id = 999994").get() as { final: number }).final, 1);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("prices that fit no total are never shown; a final read clears that bout's earlier split", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999996: picked });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    await importVerdictPickCard(999996);
    assert.equal(stored(local.id).total, 80);
    restore();
    const again = mockVerdict(local, { 999996: unfit });
    try {
      assert.equal((await importVerdictPickCard(999996)).stored, 1);
      assert.equal(stored(local.id), null);
      assert.equal((db.prepare("SELECT unfit FROM verdict_pick_cards WHERE verdict_id = 999996").get() as { unfit: number }).unfit, 1);
    } finally { again(); }
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a finished card read before our bout was loaded is matched and read when it is", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999995: picked });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    db.prepare("UPDATE events SET date = '1990-01-01' WHERE id = ?").run(local.event_id);
    assert.equal((await importVerdictPickCard(999995)).matched, 0);
    assert.equal((await rematchVerdictPicks()).stored, 0);
    db.prepare("UPDATE events SET date = ? WHERE id = ?").run(local.date, local.event_id);
    assert.equal((await rematchVerdictPicks()).stored, 1);
    assert.equal(stored(local.id).total, 80);
    // Read once: a later pass fetches nothing more for it.
    globalThis.fetch = async () => { throw new Error("no fetch expected"); };
    assert.deepEqual(await rematchVerdictPicks(), { stored: 0, cards: 0, failed: 0, lastError: null });
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("Verdict's own spellings of a fighter match; a shared first name never does", () => {
  const ours = (f1_name: string, f2_name: string) => ({ f1_name, f2_name, f1_alias: null, f2_alias: null });
  assert.deepEqual(pairing("Charles Olivera", "Michael Chandler", ours("Charles Oliveira", "Michael Chandler")), { order: 1, tier: 2 });
  assert.deepEqual(pairing("Alex Perez", "Sumudaerji Tibetan Eagle", ours("Sumudaerji", "Alex Perez")), { order: -1, tier: 2 });
  assert.deepEqual(pairing("Dustin Jacoby", "Muhammad Said", ours("Muhammad Saidov", "Dustin Jacoby")), { order: -1, tier: 2 });
  assert.equal(pairing("Tony Ferguson", "Michael Johnson", ours("Tony Ferguson", "Michael Chandler")), null);
  assert.equal(pairing("Jussier Formiga", "Ulka Sasaki", ours("Jussier Formiga", "Yuta Sasaki")), null);
  assert.equal(pairing("Nate Diaz", "Someone Else", ours("Nick Diaz", "Another One")), null);
});

test("a read that started earlier never overwrites one that started later", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999993: picked });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    const later = Date.now();
    await importVerdictPickCard(999993, later);
    await importVerdictPickCard(999993, later - 60_000);
    assert.equal(stored(local.id).fetchedAt, later);
    assert.equal((db.prepare("SELECT checked_at FROM verdict_pick_cards WHERE verdict_id = 999993").get() as { checked_at: number }).checked_at, later);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a rematch that fails keeps its error for Admin and clears it once it reads", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999992: picked });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    db.prepare("UPDATE events SET date = '1990-01-01' WHERE id = ?").run(local.event_id);
    await importVerdictPickCard(999992);
    db.prepare("UPDATE events SET date = ? WHERE id = ?").run(local.date, local.event_id);
    const working = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("Verdict down"); };
    const failed = await rematchVerdictPicks();
    assert.deepEqual([failed.cards, failed.failed], [1, 1]);
    const error = () => (db.prepare("SELECT error FROM verdict_pick_cards WHERE verdict_id = 999992").get() as { error: string | null }).error;
    assert.match(error() ?? "", /Verdict down/);
    globalThis.fetch = working;
    assert.equal((await rematchVerdictPicks()).stored, 1);
    assert.equal(error(), null);
  } finally { restore(); db.exec("ROLLBACK"); }
});

// Prochazka–Stirling's prices while open: at least 44 picks.
const small = { fightBallots: { global: { fighterID: 2, fightVictoryTerms: 2, roundNumber: 2, count: 14 } },
  rates: rates([[1, [2.44, 2.44, 4.2, 4.2]], [2, [1.69, 1.69, 4.2, 4.2]]]) };

test("of two Verdict cards listing our bout, the larger poll is kept whichever is read last", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999991: picked, 999990: small });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    await importVerdictPickCard(999990);
    assert.equal(stored(local.id).least, 44);
    await importVerdictPickCard(999991);
    assert.equal(stored(local.id).total, 80);
    await importVerdictPickCard(999990);
    assert.equal(stored(local.id).total, 80);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a card that retires, or drops our bout, takes its split with it", async () => {
  const local = fight();
  db.exec("BEGIN");
  try {
    for (const [card, change] of [[999989, { active: 0 }], [999979, { listed: false }]] as const) {
      db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
      let restore = mockVerdict(local, { [card]: picked });
      await importVerdictPickCard(card, Date.now() - 1_000);
      assert.equal(stored(local.id).total, 80);
      restore();
      restore = mockVerdict(local, { [card]: picked }, local.f1_name, "UFC", change);
      try { await importVerdictPickCard(card); } finally { restore(); }
      assert.equal(stored(local.id), null, JSON.stringify(change));
    }
  } finally { db.exec("ROLLBACK"); }
});

test("a failed re-read keeps a final card final", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999988: picked });
  db.exec("BEGIN");
  try {
    await importVerdictPickCard(999988);
    globalThis.fetch = async () => new Response("nope", { status: 418 });
    await assert.rejects(importVerdictPickCard(999988), /418/);
    const card = db.prepare("SELECT final, error FROM verdict_pick_cards WHERE verdict_id = 999988").get() as { final: number; error: string };
    assert.equal(card.final, 1);
    assert.match(card.error, /418/);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a cleared split stays cleared against an older read still in flight", async () => {
  const local = fight();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    const t = Date.now();
    let restore = mockVerdict(local, { 999987: picked });
    await importVerdictPickCard(999987, t);
    restore();
    restore = mockVerdict(local, { 999987: picked }, local.f1_name, "UFC", { active: 0 });
    await importVerdictPickCard(999987, t + 2_000);
    restore();
    assert.equal(stored(local.id), null);
    restore = mockVerdict(local, { 999987: picked });
    await importVerdictPickCard(999987, t + 1_000);
    restore();
    assert.equal(stored(local.id), null);
  } finally { db.exec("ROLLBACK"); }
});

test("a card whose bout list is empty keeps none of its splits once a second read agrees", async () => {
  const local = fight();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    let restore = mockVerdict(local, { 999986: picked });
    await importVerdictPickCard(999986, Date.now() - 1_000);
    restore();
    restore = mockVerdict(local, { 999986: picked }, local.f1_name, "UFC", { emptyList: true });
    try {
      // Believed on the second read, like a card none of whose bouts answers.
      assert.equal((await importVerdictPickCard(999986, Date.now() - 500)).bouts, 0);
      assert.equal(stored(local.id).total, 80);
      await importVerdictPickCard(999986);
    } finally { restore(); }
    assert.equal(stored(local.id), null);
  } finally { db.exec("ROLLBACK"); }
});

test("the rematch takes nothing from a card Verdict has since retired", async () => {
  const local = fight();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    db.prepare("UPDATE events SET date = '1990-01-01' WHERE id = ?").run(local.event_id);
    let restore = mockVerdict(local, { 999985: picked });
    await importVerdictPickCard(999985);
    restore();
    db.prepare("UPDATE events SET date = ? WHERE id = ?").run(local.date, local.event_id);
    restore = mockVerdict(local, { 999985: picked }, local.f1_name, "UFC", { active: 0 });
    try { assert.equal((await rematchVerdictPicks()).stored, 0); } finally { restore(); }
    assert.equal(stored(local.id), null);
  } finally { db.exec("ROLLBACK"); }
});

test("an earlier opponent's larger poll never blocks the current matchup's picks", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999984: small });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = ? WHERE id = ?").run(JSON.stringify({
      format: VERDICT_PICKS_FORMAT, source: "Verdict MMA", sourceUrl: "https://verdictmma.com/event/1/fight/1", fetchedAt: 1, final: true,
      f1Id: local.f1_id, f2Id: "an-earlier-opponent", total: 5000, least: 5000, exact: true, fits: true,
      f1: { ko: 1000, submission: 1000, decision: 500 }, f2: { ko: 1000, submission: 1000, decision: 500 },
    }), local.id);
    await importVerdictPickCard(999984);
    assert.equal(stored(local.id).least, 44);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a read that started before a newer read of its card writes nothing, even onto an empty bout", async () => {
  const local = fight();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    const t = Date.now();
    let restore = mockVerdict(local, { 999983: picked }, local.f1_name, "UFC", { active: 0 });
    await importVerdictPickCard(999983, t + 2_000);
    restore();
    restore = mockVerdict(local, { 999983: picked });
    await importVerdictPickCard(999983, t);
    restore();
    assert.equal(stored(local.id), null);
  } finally { db.exec("ROLLBACK"); }
});

test("between two cards listing our bout, the larger poll wins even when its read started first", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999982: picked, 999981: small });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    const t = Date.now();
    await importVerdictPickCard(999981, t + 1_000);
    assert.equal(stored(local.id).least, 44);
    await importVerdictPickCard(999982, t);
    assert.equal(stored(local.id).total, 80);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a response Verdict changed shape is an error, never a card with no bouts", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999978: picked });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    await importVerdictPickCard(999978, Date.now() - 1_000);
    globalThis.fetch = async () => Response.json({ status: "Authentication required." });
    await assert.rejects(importVerdictPickCard(999978), /unreadable/);
    assert.equal(stored(local.id).total, 80);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a card that reads empty is believed only on the next read too", async () => {
  const local = fight();
  const restore = mockVerdict(local, { 999977: picked });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    const t = Date.now();
    await importVerdictPickCard(999977, t);
    globalThis.fetch = async () => new Response('{"message":"Fight not found"}', { status: 404 });
    await importVerdictPickCard(999977, t + 1_000);
    assert.equal(stored(local.id).total, 80);
    assert.match((db.prepare("SELECT error FROM verdict_pick_cards WHERE verdict_id = 999977").get() as { error: string }).error, /no bouts/);
    await importVerdictPickCard(999977, t + 2_000);
    assert.equal(stored(local.id), null);
    // Believed, the note clears: nothing is left for Admin to retry.
    assert.equal((db.prepare("SELECT error FROM verdict_pick_cards WHERE verdict_id = 999977").get() as { error: string | null }).error, null);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a stray pick on a card from before UFC 205 is never shown", async () => {
  const local = db.prepare(`SELECT f.id, f.event_id, f.f1_name, f.f2_name, f.f1_id, f.f2_id, e.date FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.date < '2016-01-01' ORDER BY e.date DESC LIMIT 1`).get() as Fight;
  const restore = mockVerdict(local, { 999976: picked });
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    assert.equal((await importVerdictPickCard(999976)).stored, 0);
    assert.equal(stored(local.id), null);
  } finally { restore(); db.exec("ROLLBACK"); }
});

test("a newer failed attempt never stops an earlier successful read from retiring the card", async () => {
  const local = fight();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET verdict_picks_json = NULL WHERE id = ?").run(local.id);
    const t = Date.now();
    // C, started last, fails first.
    globalThis.fetch = async () => new Response("nope", { status: 418 });
    await assert.rejects(importVerdictPickCard(999975, t + 3_000));
    // B, started second, sees the card retired.
    let restore = mockVerdict(local, { 999975: picked }, local.f1_name, "UFC", { active: 0 });
    await importVerdictPickCard(999975, t + 2_000);
    restore();
    // A, started first, sees it live: too old to write.
    restore = mockVerdict(local, { 999975: picked });
    await importVerdictPickCard(999975, t + 1_000);
    restore();
    assert.equal(stored(local.id), null);
    const card = db.prepare("SELECT final, error, read_at FROM verdict_pick_cards WHERE verdict_id = 999975").get() as { final: number; error: string; read_at: number };
    assert.deepEqual([card.final, card.read_at], [1, t + 2_000]);
    assert.match(card.error, /418/);
  } finally { db.exec("ROLLBACK"); }
});

test("the archive walk reads newest first, skips cards already read, and starts again only for cards added above it", async () => {
  const prior = globalThis.fetch;
  const asked: number[] = [];
  globalThis.fetch = async input => {
    const id = Number(new URL(String(input)).searchParams.get("eventID"));
    if (id >= 999_000 && !asked.includes(id)) asked.push(id);
    return new Response('{"message":"Fight not found"}', { status: 404 });
  };
  db.exec("BEGIN");
  try {
    const now = Date.now();
    for (const [key, value] of [["since", now - 60_000], ["top", 999995], ["down", 999995], ["newest", 999995]]) setMeta(`verdict_picks_${key}`, String(value));
    // Read since the walk began, and final: neither is read again.
    db.prepare("INSERT OR REPLACE INTO verdict_pick_cards (verdict_id, final, checked_at, read_at) VALUES (999994, 0, ?1, ?1), (999993, 1, 0, 0)").run(now - 30_000);
    await syncVerdictPicks(now, 0);
    await syncVerdictPicks(now + 30_000, 0);
    assert.deepEqual(asked, [999995, 999992]);
    assert.equal(getMeta("verdict_picks_down"), "999991");
    // Done: idle until Verdict adds a card above where it started.
    setMeta("verdict_picks_down", "0");
    await syncVerdictPicks(now + 60_000, 0);
    assert.deepEqual(asked, [999995, 999992]);
    setMeta("verdict_picks_newest", "999997");
    await syncVerdictPicks(now + 90_000, 0);
    await syncVerdictPicks(now + 120_000, 0);
    assert.deepEqual(asked, [999995, 999992, 999997, 999996]);
    assert.equal(getMeta("verdict_picks_top"), "999997");
  } finally {
    db.exec("ROLLBACK");
    globalThis.fetch = prior;
  }
});

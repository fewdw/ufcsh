import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { resolvePublicApi } from "./api.ts";
import { fighterRosterEvents, sameSigning, storedRosterMoves, syncUfcSignings, syncUfcStatuses, ufcDepartures, ufcSignings } from "./roster-moves.ts";
import type { NewAthlete, NewestAthlete } from "./scrape/ufccom.ts";

const listed = (...slugs: string[]) => async (): Promise<NewestAthlete[]> => slugs.map(slug => ({ slug, name: slug }));
type Page = NewAthlete;
const unpictured = { headshot: null, fullBody: null };

test("ufc.com's newest profiles become signings only once seen new and Active", async () => {
  const saved = getMeta("ufc_signings");
  const history = getMeta("roster_history"), historyRevision = getMeta("roster_history_revision");
  try {
    db.prepare("DELETE FROM meta WHERE key = 'ufc_signings'").run();
    const read: string[] = [];
    const pages: Record<string, Page> = {
      "luis-hernandez": { name: "Luis Hernandez", status: "active", division: "Light Heavyweight", headshot: "https://ufc.com/h.png", fullBody: null },
      "bruce-whitehead": { name: "Bruce Whitehead", status: null, division: null, ...unpictured },
    };
    const readAthlete = async (slug: string) => {
      read.push(slug);
      if (!pages[slug]) throw new Error("HTTP 503");
      return pages[slug];
    };

    // The first read learns who is there: nobody already Active is reported,
    // and a profile not yet Active waits.
    pages["a"] = { name: "A", status: "active", division: null, ...unpictured };
    pages["dwcs"] = { name: "Callum Connor", status: null, division: "Lightweight", ...unpictured };
    await syncUfcSignings(listed("dwcs", "c", "b", "a"), readAthlete);
    assert.deepEqual(ufcSignings(), []);
    assert.deepEqual(read, ["a", "b", "c", "dwcs"]);
    read.length = 0;

    // New profiles are read; an Active one is a signing, one not yet Active
    // waits, an unreadable one is tried again next time.
    await syncUfcSignings(listed("broken", "bruce-whitehead", "luis-hernandez", "c", "b"), readAthlete);
    assert.deepEqual(read, ["luis-hernandez", "bruce-whitehead", "broken"]);
    assert.deepEqual(ufcSignings().map(s => [s.name, s.division]), [["Luis Hernandez", "Light Heavyweight"]]);
    assert.equal(ufcSignings()[0].date, new Date().toISOString().slice(0, 10));
    assert.equal(ufcSignings()[0].photo, "https://ufc.com/h.png");

    // Within half an hour a waiting profile isn't read again; a signing is never re-reported.
    read.length = 0;
    await syncUfcSignings(listed("broken", "bruce-whitehead", "luis-hernandez", "c"), readAthlete);
    assert.deepEqual(read, ["broken"]);
    assert.equal(ufcSignings().length, 1);

    // Off the list, a waiting profile is read every two hours until it reads
    // Active, which is when ufc.com adds them to its roster.
    const waiting = JSON.parse(getMeta("ufc_signings")!);
    assert.ok(waiting.pending.dwcs);
    waiting.pending.dwcs.read = Date.now() - 3 * 3_600_000;
    setMeta("ufc_signings", JSON.stringify(waiting));
    pages["dwcs"] = { ...pages["dwcs"], status: "active" };
    read.length = 0;
    await syncUfcSignings(listed("broken", "bruce-whitehead", "luis-hernandez", "c"), readAthlete);
    assert.deepEqual(read, ["broken", "dwcs"]);
    assert.deepEqual(ufcSignings().map(s => s.name), ["Luis Hernandez", "Callum Connor"]);
    assert.equal(JSON.parse(getMeta("ufc_signings")!).pending.dwcs, undefined);

    // A signing whose page had no headshot yet is read again two hours later.
    const stored = JSON.parse(getMeta("ufc_signings")!);
    stored.signed[0] = { ...stored.signed[0], photo: null, read_at: Date.now() - 3 * 3_600_000 };
    setMeta("ufc_signings", JSON.stringify(stored));
    read.length = 0;
    await syncUfcSignings(listed("luis-hernandez", "c"), readAthlete);
    assert.deepEqual(read, ["luis-hernandez"]);
    assert.equal(ufcSignings()[0].photo, "https://ufc.com/h.png");

    // ufc.com down: nothing changes.
    const before = getMeta("ufc_signings");
    await assert.rejects(syncUfcSignings(async () => { throw new Error("HTTP 503"); }, readAthlete));
    assert.equal(getMeta("ufc_signings"), before);

    // A list sharing nobody with the last read (no longer newest-first) is re-learned silently.
    read.length = 0;
    pages["y"] = { name: "Y", status: "active", division: null, ...unpictured };
    await syncUfcSignings(listed("x", "y", "z"), readAthlete);
    assert.deepEqual(read, ["z", "y", "x"]);
    assert.equal(ufcSignings().length, 2);
  } finally {
    if (saved === null) db.prepare("DELETE FROM meta WHERE key = 'ufc_signings'").run();
    else setMeta("ufc_signings", saved);
    for (const [key, value] of [["roster_history", history], ["roster_history_revision", historyRevision]]) {
      if (value === null) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
      else setMeta(key!, value!);
    }
  }
});

test("ufc.com's signing matches Wikipedia's under another spelling of the name", () => {
  const wiki = (name: string, division = "Flyweight") => ({ name, division, date: "2026-10-06" });
  const ufc = (name: string, division: string | null = "Flyweight") => ({ name, division, date: "2026-10-09" });
  assert.ok(sameSigning(wiki("Preston LaGrange"), ufc("Preston La Grange")));
  assert.ok(sameSigning(wiki("Roque Conceição Moreira Jr."), ufc("Roque Conceicao")));
  assert.ok(sameSigning(wiki("Aieza Ramos Bertolso"), ufc("Aieza Bertolso")));
  assert.ok(sameSigning(wiki("Tom Pagliarulo"), ufc("Thomas Pagliarulo", null)));
  // Another division, first name, surname or season is someone else.
  assert.ok(!sameSigning(wiki("Roque Conceição Moreira Jr."), ufc("Roque Conceicao", "Bantamweight")));
  assert.ok(!sameSigning(wiki("Roque Conceição Moreira Jr."), ufc("Rose Conceicao")));
  assert.ok(!sameSigning(wiki("Roque Conceição Moreira Jr."), ufc("Roque Silva")));
  assert.ok(!sameSigning({ ...wiki("Aieza Ramos Bertolso"), date: "2025-01-10" }, ufc("Aieza Bertolso")));
});

test("the roster shows ufc.com's signings Wikipedia hasn't listed, once", async () => {
  const saved = getMeta("ufc_signings");
  const wiki = storedRosterMoves().signed[0];
  if (!wiki) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    setMeta("ufc_signings", JSON.stringify({ seen: [], pending: {}, signed: [
      { name: wiki.name, division: null, date: today },
      { name: `${wiki.name} Jr.`, division: wiki.division, date: wiki.date ?? today },
      { name: "Zzyzx Qwertyuiop", division: "Flyweight", date: today, photo: "https://ufc.com/z.png" },
    ] }));
    const roster = await resolvePublicApi(new URL("http://localhost/api/roster")) as { signed: any[] };
    assert.equal(roster.signed.filter(move => move.name === "Zzyzx Qwertyuiop" && move.division === "Flyweight"
      && move.fighter_id === null && move.photo_url === "https://ufc.com/z.png").length, 1);
    // Wikipedia's entry stands; the same person from ufc.com, under either spelling, isn't added again.
    assert.equal(roster.signed.filter(move => move.record === null && move.name.startsWith(wiki.name)).length, 0);
  } finally {
    if (saved === null) db.prepare("DELETE FROM meta WHERE key = 'ufc_signings'").run();
    else setMeta("ufc_signings", saved);
  }
});

test("a fighter whose ufc.com page turns Retired has left the roster, and is back once it reads Active", async () => {
  const cut = new Set(storedRosterMoves().cut.map(move => move.name));
  const fighter = (db.prepare(`SELECT fr.id, fr.name FROM fighters fr JOIN fights f ON fr.id IN (f.f1_id, f.f2_id) JOIN events e ON e.id = f.event_id
    WHERE fr.signee = 0 AND e.date >= date('now', '-1 year') ORDER BY e.date DESC LIMIT 50`).all() as { id: string; name: string }[])
    .find(row => !cut.has(row.name));
  if (!fighter) return;
  const saved = Object.fromEntries(["ufc_signings", "roster_history", "roster_history_revision"].map(key => [key, getMeta(key)]));
  db.exec("CREATE TEMP TABLE saved_ufc_status AS SELECT * FROM ufc_status");
  try {
    // Everyone else was read just now, so only this fighter is due.
    db.exec("DELETE FROM ufc_status");
    db.prepare("INSERT INTO ufc_status (fighter_id, status, checked_at) SELECT id, 'active', ? FROM fighters WHERE id != ?").run(Date.now(), fighter.id);
    db.prepare("INSERT INTO ufc_status (fighter_id, url, status, checked_at) VALUES (?, ?, 'active', 1)").run(fighter.id, "https://www.ufc.com/athlete/x");
    const page = (status: "active" | "retired") => async () => ({ url: "https://www.ufc.com/athlete/x", status, height: null, reach: null });

    await syncUfcStatuses(1, page("retired"));
    assert.deepEqual(ufcDepartures().map(({ fighter_id, status }) => ({ fighter_id, status })), [{ fighter_id: fighter.id, status: "retired" }]);
    assert.ok(fighterRosterEvents(fighter.id).some(event => event.kind === "retired" && event.observed));
    const roster = await resolvePublicApi(new URL("http://localhost/api/roster")) as { cut: any[] };
    assert.equal(roster.cut.find(move => move.fighter_id === fighter.id)?.reason, "Retired");

    db.prepare("UPDATE ufc_status SET checked_at = 1 WHERE fighter_id = ?").run(fighter.id);
    await syncUfcStatuses(1, page("active"));
    assert.deepEqual(ufcDepartures(), []);
    assert.ok(ufcSignings().some(signing => signing.name === fighter.name));
  } finally {
    db.exec("DELETE FROM ufc_status; INSERT INTO ufc_status SELECT * FROM saved_ufc_status; DROP TABLE saved_ufc_status");
    for (const [key, value] of Object.entries(saved)) {
      if (value === null) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
      else setMeta(key, value);
    }
  }
});

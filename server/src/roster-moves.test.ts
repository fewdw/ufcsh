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

test("a namesake's ufc.com page swapped for the fighter's own is no change watched, and one found wrong drops its status", async () => {
  const fighter = db.prepare(`SELECT fr.id, fr.name FROM fighters fr JOIN fights f ON fr.id IN (f.f1_id, f.f2_id) JOIN events e ON e.id = f.event_id
    WHERE fr.signee = 0 AND e.date >= date('now', '-1 year') ORDER BY e.date DESC LIMIT 1`).get() as { id: string; name: string } | undefined;
  if (!fighter) return;
  const saved = Object.fromEntries(["ufc_signings", "roster_history", "roster_history_revision"].map(key => [key, getMeta(key)]));
  db.exec("CREATE TEMP TABLE saved_ufc_status AS SELECT * FROM ufc_status");
  try {
    db.exec("DELETE FROM ufc_status");
    db.prepare("INSERT INTO ufc_status (fighter_id, status, checked_at) SELECT id, 'active', ? FROM fighters WHERE id != ?").run(Date.now(), fighter.id);
    db.prepare("INSERT INTO ufc_status (fighter_id, status, checked_at) VALUES (?, NULL, 1)").run(fighter.id);
    const namesake = (status: string, leftAt: number | null = null) =>
      db.prepare("UPDATE ufc_status SET url = 'https://www.ufc.com/athlete/namesake', status = ?, left_at = ?, checked_at = 1 WHERE fighter_id = ?").run(status, leftAt, fighter.id);
    const row = () => ({ ...db.prepare("SELECT url, status, left_at FROM ufc_status WHERE fighter_id = ?").get(fighter.id) as object });
    const reads = (url: string | null, status: "active" | "not_fighting" | null) => async () => ({ url, status, height: null, reach: null });
    const returns = () => ufcSignings().filter(signing => signing.name === fighter.name);
    const observedToday = () => fighterRosterEvents(fighter.id).filter(event => event.observed && event.date === new Date().toISOString().slice(0, 10));

    // Their own page has read Not Fighting all along: nothing changed today,
    // and the namesake's departure goes with its page.
    namesake("active", Date.now() - 86_400_000);
    await syncUfcStatuses(1, reads("https://www.ufc.com/athlete/own", "not_fighting"));
    assert.deepEqual(row(), { url: "https://www.ufc.com/athlete/own", status: "not_fighting", left_at: null });
    assert.deepEqual(ufcDepartures(), []);

    // Their own page reads Active where the namesake's read Not Fighting: no return.
    namesake("not_fighting");
    await syncUfcStatuses(1, reads("https://www.ufc.com/athlete/own", "active"));
    assert.deepEqual(row(), { url: "https://www.ufc.com/athlete/own", status: "active", left_at: null });
    assert.deepEqual(returns(), []);

    // Their own page with no status readable yet keeps nothing of the
    // namesake's, so its first status read is no departure either.
    namesake("active");
    await syncUfcStatuses(1, reads("https://www.ufc.com/athlete/own", null));
    assert.deepEqual(row(), { url: "https://www.ufc.com/athlete/own", status: null, left_at: null });
    db.prepare("UPDATE ufc_status SET checked_at = 1 WHERE fighter_id = ?").run(fighter.id);
    await syncUfcStatuses(1, reads("https://www.ufc.com/athlete/own", "not_fighting"));
    assert.deepEqual(ufcDepartures(), []);

    // A page shown to be someone else's, with none of their own, leaves no status behind.
    namesake("active");
    await syncUfcStatuses(1, reads(null, null));
    assert.deepEqual(row(), { url: null, status: null, left_at: null });
    assert.deepEqual(observedToday(), []);
    assert.deepEqual(returns(), []);
  } finally {
    db.exec("DELETE FROM ufc_status; INSERT INTO ufc_status SELECT * FROM saved_ufc_status; DROP TABLE saved_ufc_status");
    for (const [key, value] of Object.entries(saved)) {
      if (value === null) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
      else setMeta(key, value);
    }
  }
});

test("off-roster fighters with no recent bout are still read weekly, and namesakes are read with every division they fought in", async () => {
  const old = db.prepare(`SELECT fr.id FROM fighters fr WHERE fr.signee = 0
    AND EXISTS (SELECT 1 FROM fights f WHERE fr.id IN (f.f1_id, f.f2_id))
    AND NOT EXISTS (SELECT 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE fr.id IN (f.f1_id, f.f2_id) AND e.date >= date('now', '-3 years'))
    LIMIT 1`).get() as { id: string } | undefined;
  db.exec("CREATE TEMP TABLE saved_ufc_status AS SELECT * FROM ufc_status");
  // Everyone but `id` read just now; `id` long ago, as Active so it is due.
  const onlyDue = (id: string, status = "active", checkedAt = 1) => {
    db.exec("DELETE FROM ufc_status");
    db.prepare("INSERT INTO ufc_status (fighter_id, status, checked_at) SELECT id, 'active', ? FROM fighters WHERE id != ?").run(Date.now(), id);
    db.prepare("INSERT INTO ufc_status (fighter_id, status, checked_at) VALUES (?, ?, ?)").run(id, status, checkedAt);
  };
  const divisionsRead = async (id: string) => {
    onlyDue(id);
    const read: string[][] = [];
    await syncUfcStatuses(1, async (_name, _url, _load, divisions) => { read.push(divisions ?? []); return null; });
    assert.equal(read.length, 1);
    return read[0];
  };
  try {
    if (old) {
      onlyDue(old.id, "not_fighting", Date.now() - 3 * 86_400_000);
      const read: string[] = [];
      const page = async (name: string) => { read.push(name); return null; };
      await syncUfcStatuses(1, page);
      assert.deepEqual(read, [], "read three days ago: not due");
      db.prepare("UPDATE ufc_status SET checked_at = ? WHERE fighter_id = ?").run(Date.now() - 8 * 86_400_000, old.id);
      await syncUfcStatuses(1, page);
      assert.equal(read.length, 1, "read eight days ago: due");
    }

    // A made-up namesake pair: the fighter and an invented fighter of the same name with a bout.
    const fighter = db.prepare(`SELECT fr.id, fr.name, fr.norm_name FROM fighters fr JOIN fights f ON fr.id IN (f.f1_id, f.f2_id)
      WHERE fr.signee = 0 AND f.weight_class NOT IN ('Catch Weight', 'Open Weight', '') LIMIT 1`).get() as { id: string; name: string; norm_name: string };
    const expected = (db.prepare(`SELECT DISTINCT weight_class FROM fights WHERE ? IN (f1_id, f2_id)
      AND weight_class NOT IN ('Catch Weight', 'Open Weight', '')`).all(fighter.id) as { weight_class: string }[]).map(row => row.weight_class).sort();
    assert.deepEqual(await divisionsRead(fighter.id), [], "no namesake: no division check");
    db.exec("SAVEPOINT namesake");
    try {
      db.prepare("INSERT INTO fighters (id, name, norm_name, signee) VALUES ('test-namesake', ?, ?, 0)").run(fighter.name, fighter.norm_name);
      db.prepare("UPDATE fights SET f1_id = 'test-namesake' WHERE id = (SELECT id FROM fights WHERE f1_id != ? AND f2_id != ? LIMIT 1)").run(fighter.id, fighter.id);
      assert.deepEqual((await divisionsRead(fighter.id)).sort(), expected);
    } finally {
      db.exec("ROLLBACK TO namesake; RELEASE namesake");
    }
  } finally {
    db.exec("DELETE FROM ufc_status; INSERT INTO ufc_status SELECT * FROM saved_ufc_status; DROP TABLE saved_ufc_status");
  }
});

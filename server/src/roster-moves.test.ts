import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { resolvePublicApi } from "./api.ts";
import { storedRosterMoves, syncUfcSignings, ufcSignings } from "./roster-moves.ts";
import type { NewestAthlete } from "./scrape/ufccom.ts";

const listed = (...slugs: string[]) => async (): Promise<NewestAthlete[]> => slugs.map(slug => ({ slug, name: slug }));
type Page = { name: string; status: "active" | "not_fighting" | null; division: string | null };

test("ufc.com's newest profiles become signings only once seen new and Active", async () => {
  const saved = getMeta("ufc_signings");
  try {
    db.prepare("DELETE FROM meta WHERE key = 'ufc_signings'").run();
    const read: string[] = [];
    const pages: Record<string, Page> = {
      "luis-hernandez": { name: "Luis Hernandez", status: "active", division: "Light Heavyweight" },
      "bruce-whitehead": { name: "Bruce Whitehead", status: null, division: null },
    };
    const readAthlete = async (slug: string) => {
      read.push(slug);
      if (!pages[slug]) throw new Error("HTTP 503");
      return pages[slug];
    };

    // The first read only learns who is there.
    await syncUfcSignings(listed("c", "b", "a"), readAthlete);
    assert.deepEqual(ufcSignings(), []);
    assert.deepEqual(read, []);

    // New profiles are read; an Active one is a signing, one not yet Active
    // waits, an unreadable one is tried again next time.
    await syncUfcSignings(listed("broken", "bruce-whitehead", "luis-hernandez", "c", "b"), readAthlete);
    assert.deepEqual(read, ["luis-hernandez", "bruce-whitehead", "broken"]);
    assert.deepEqual(ufcSignings().map(s => [s.name, s.division]), [["Luis Hernandez", "Light Heavyweight"]]);
    assert.equal(ufcSignings()[0].date, new Date().toISOString().slice(0, 10));

    // Within half an hour a waiting profile isn't read again; a signing is never re-reported.
    read.length = 0;
    await syncUfcSignings(listed("broken", "bruce-whitehead", "luis-hernandez", "c"), readAthlete);
    assert.deepEqual(read, ["broken"]);
    assert.equal(ufcSignings().length, 1);

    // ufc.com down: nothing changes.
    const before = getMeta("ufc_signings");
    await assert.rejects(syncUfcSignings(async () => { throw new Error("HTTP 503"); }, readAthlete));
    assert.equal(getMeta("ufc_signings"), before);

    // A list sharing nobody with the last read (no longer newest-first) is re-learned silently.
    read.length = 0;
    await syncUfcSignings(listed("x", "y", "z"), readAthlete);
    assert.deepEqual(read, []);
    assert.equal(ufcSignings().length, 1);
  } finally {
    if (saved === null) db.prepare("DELETE FROM meta WHERE key = 'ufc_signings'").run();
    else setMeta("ufc_signings", saved);
  }
});

test("the roster shows ufc.com's signings Wikipedia hasn't listed, once", async () => {
  const saved = getMeta("ufc_signings");
  const wiki = storedRosterMoves().signed[0];
  if (!wiki) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    setMeta("ufc_signings", JSON.stringify({ seen: [], pending: {}, signed: [
      { name: wiki.name, division: null, date: today },
      { name: "Zzyzx Qwertyuiop", division: "Flyweight", date: today },
    ] }));
    const roster = await resolvePublicApi(new URL("http://localhost/api/roster")) as { signed: any[] };
    assert.equal(roster.signed.filter(move => move.name === "Zzyzx Qwertyuiop" && move.division === "Flyweight" && move.fighter_id === null).length, 1);
    // Wikipedia's entry stands; the same person from ufc.com isn't added again.
    assert.equal(roster.signed.filter(move => move.date === today && move.reason === null && move.record === null && move.name === wiki.name).length, 0);
  } finally {
    if (saved === null) db.prepare("DELETE FROM meta WHERE key = 'ufc_signings'").run();
    else setMeta("ufc_signings", saved);
  }
});

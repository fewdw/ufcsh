import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { archiveRosterEvents, departureKind, storedRosterHistory, validRosterDate, type RosterHistoryEvent } from "./roster-history.ts";
import { fighterRosterEvents } from "./roster-moves.ts";
import { getFighter } from "./api.ts";
import { bugReport } from "./bugs.ts";

test("retirement and contract expiry never become cuts", () => {
  assert.equal(departureKind("Released"), "released");
  assert.equal(departureKind("Retired from MMA"), "retired");
  assert.equal(departureKind("Contract not renewed"), "departed");
  assert.equal(departureKind("Off UFC roster"), "departed");
  assert.equal(departureKind(null), "departed");
  assert.equal(validRosterDate("2024-02-30"), false);
});

test("dated source reports persist, accept corrections and reject undated entries", () => {
  const saved = getMeta("roster_history"), revision = getMeta("roster_history_revision");
  try {
    db.prepare("DELETE FROM meta WHERE key = 'roster_history'").run();
    const event: RosterHistoryEvent = { name: "Example Fighter", date: "2024-01-01", kind: "departed", reason: "Contract expired", source_url: "https://www.ufc.com/", observed: false };
    archiveRosterEvents([event, { ...event, date: "2024-02-30" }]);
    archiveRosterEvents([{ ...event, kind: "released", reason: "Released" }]);
    archiveRosterEvents([]);
    assert.deepEqual(storedRosterHistory().filter(row => row.name === event.name), [{ ...event, kind: "released", reason: "Released" }]);
    assert.ok(getMeta("roster_history_revision"));
    const after = getMeta("roster_history_revision");
    archiveRosterEvents([{ ...event, kind: "released", reason: "Released" }]);
    assert.equal(getMeta("roster_history_revision"), after);
  } finally {
    for (const [key, value] of [["roster_history", saved], ["roster_history_revision", revision]]) {
      if (value === null) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
      else setMeta(key!, value!);
    }
  }
});

test("Romero's sourced historical release is linked to his UFCStats identity and profile API", async () => {
  assert.equal(fighterRosterEvents("f77c68bb4be8516d").some(event => event.kind === "released" && event.date === "2020-12-04" && event.source_url.includes("yoel-romero")), true);
  assert.deepEqual(fighterRosterEvents("not-a-fighter"), []);
  const profile = await getFighter("f77c68bb4be8516d", "meta") as { roster_events: RosterHistoryEvent[] };
  assert.ok(profile.roster_events.some(event => event.kind === "released" && event.date === "2020-12-04"));
});

test("the admin board surfaces retained evidence with a missing source or identity", () => {
  const saved = getMeta("roster_history");
  try {
    setMeta("roster_history", JSON.stringify([{ name: "Zzyzx Missing Timeline Identity", date: "2024-01-01", kind: "departed", reason: null, source_url: "", observed: false }]));
    const check = bugReport().checks.find(check => check.id === "roster-history")!;
    const item = check.items.find(item => item.title === "Zzyzx Missing Timeline Identity")!;
    assert.match(item.subtitle!, /source, unambiguous profile/);
    assert.equal(item.actions[0].id, "roster-moves");
  } finally {
    if (saved === null) db.prepare("DELETE FROM meta WHERE key = 'roster_history'").run();
    else setMeta("roster_history", saved);
  }
});

test("profile timeline unknowns appear with research context and disappear after manual evidence is added", () => {
  const saved = getMeta("roster_history"), revision = getMeta("roster_history_revision");
  try {
    const initial = bugReport().checks.find(check => check.id === "roster-history")!;
    // The backlog must stay searchable past the usual thousand-item cap.
    assert.equal(initial.items.length, initial.total);
    const signing = initial.items.find(item => item.title === "Charles Oliveira" && item.subtitle?.includes("unknown exact signing date"))!;
    assert.ok(signing);
    assert.ok(signing.facts.some(([label, value]) => label === "Next fight" && value.includes("Darren Elkins")));
    assert.ok(signing.links.some(link => link.internal && link.href === "/fighters/07225ba28ae309b6"));
    const departure = initial.items.find(item => item.title === "Andrei Arlovski" && item.subtitle?.startsWith("Last UFC fight"))!;
    assert.ok(departure.facts.some(([label, value]) => label === "Previous fight" && value.includes("Jake O'Brien")));
    assert.match(departure.subtitle!, /departure date, departure reason/);
    assert.ok(initial.items.some(item => item.title === "Robbie Lawler" && item.subtitle?.startsWith("Returned to UFC")));
    assert.equal(initial.items.some(item => item.title === "Yoel Romero" && item.subtitle?.startsWith("Last UFC fight")), false);

    archiveRosterEvents([
      { name: "Charles Oliveira", date: "2010-07-01", kind: "signed", reason: null, source_url: "https://www.ufc.com/test-signing-evidence", observed: false },
      { name: "Andrei Arlovski", date: "2008-05-01", kind: "departed", reason: "Contract not renewed", source_url: "https://www.ufc.com/test-departure-evidence", observed: false },
    ]);
    const after = bugReport().checks.find(check => check.id === "roster-history")!;
    assert.equal(after.items.some(item => item.key === signing.key), false);
    assert.equal(after.items.some(item => item.key === departure.key), false);
  } finally {
    for (const [key, value] of [["roster_history", saved], ["roster_history_revision", revision]]) {
      if (value === null) db.prepare("DELETE FROM meta WHERE key = ?").run(key);
      else setMeta(key!, value!);
    }
  }
});

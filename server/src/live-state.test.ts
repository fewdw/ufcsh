import test from "node:test";
import assert from "node:assert/strict";
import { boutIsLive, eventStatus, fightIsComplete, fightIsUnderway, isFightDay, liveDetailDue } from "./live-state.ts";
const now = Date.parse("2026-09-05T20:00:00Z");
test("current and next are distinct, with midnight grace and completed-card handoff", () => {
  assert.equal(eventStatus({ date: "2026-09-05", complete: 0 }, "2026-09-12", now), "current");
  assert.equal(eventStatus({ date: "2026-09-12", complete: 0 }, "2026-09-12", now), "next");
  assert.equal(eventStatus({ date: "2026-09-05", complete: 1 }, "2026-09-12", now), "past");
  assert.equal(eventStatus({ date: "2026-09-04", complete: 0 }, "2026-09-12", now), "current");
  assert.equal(eventStatus({ date: "2026-09-03", complete: 0 }, "2026-09-12", now), "past");
  assert.equal(eventStatus({ date: "2026-09-19", complete: 0 }, "2026-09-12", now), "future");
  assert.equal(isFightDay("2026-09-05", Date.parse("2026-09-06T02:00:00Z")), true);
});
test("a completed prelim is complete before the event or main event ends", () => {
  assert.equal(fightIsComplete({ f1_outcome: "win", f2_outcome: "loss" }), true);
  assert.equal(fightIsComplete({ f1_outcome: "draw", f2_outcome: "draw" }), true);
  assert.equal(fightIsComplete({ f1_outcome: "nc", f2_outcome: "nc" }), true);
  assert.equal(fightIsComplete({ f1_outcome: null, f2_outcome: null }), false);
});
test("newly confirmed results immediately replace previews, with timed correction checks", () => {
  const row = { detail_fetched_at: now - 1000, detail_json: '{"type":"future"}', f1_outcome: "win" };
  assert.equal(liveDetailDue(row, now), true);
  assert.equal(liveDetailDue({ ...row, f1_outcome: null }, now), false);
  assert.equal(liveDetailDue({ ...row, detail_json: '{"type":"past"}' }, now), false);
  assert.equal(liveDetailDue({ ...row, detail_json: '{"type":"past"}', detail_fetched_at: now - 60_000 }, now), true);
  assert.equal(liveDetailDue({ ...row, detail_json: null }, now), true);
});
test("a bout with numbers but no verdict is being fought right now", () => {
  assert.equal(fightIsUnderway({ detail_json: '{"type":"past"}', f1_outcome: null, f2_outcome: null }), true);
  assert.equal(fightIsUnderway({ detail_json: '{"type":"future"}', f1_outcome: null, f2_outcome: null }), false, "a preview page is a bout that has not started");
  assert.equal(fightIsUnderway({ detail_json: '{"type":"past"}', f1_outcome: "win", f2_outcome: "loss" }), false, "a verdict ends it");
  assert.equal(fightIsUnderway({ detail_json: null, f1_outcome: null, f2_outcome: null }), false);
});
test("the bout in progress is refreshed harder than the finished ones around it", () => {
  const underway = { detail_json: '{"type":"past"}', f1_outcome: null, f2_outcome: null, detail_fetched_at: now - 31_000 };
  assert.equal(liveDetailDue(underway, now), true, "its numbers are the ones moving");
  assert.equal(liveDetailDue({ ...underway, detail_fetched_at: now - 29_000 }, now), false);
  assert.equal(liveDetailDue({ ...underway, f1_outcome: "win", f2_outcome: "loss", detail_fetched_at: now - 31_000 }, now), false, "a finished bout only waits for corrections");
});

test("the bout after a result is live; the opener from its start; a later segment waits for its own", () => {
  const now = Date.UTC(2026, 9, 17, 22);
  const at = (minutes: number) => now + minutes * 60_000;
  const bout = { started: false, held: false, completed: 0, startsAt: null, segmentStart: null };
  // The opener: Next until the card's announced start, live from it.
  assert.equal(boutIsLive({ ...bout, startsAt: at(5), segmentStart: at(5) }, now), false);
  assert.equal(boutIsLive({ ...bout, startsAt: at(-1), segmentStart: at(-1) }, now), true);
  // No announced time and no result: nothing says the card has begun.
  assert.equal(boutIsLive(bout, now), false);
  // After a result the next bout is on, however late its estimate said it was.
  assert.equal(boutIsLive({ ...bout, completed: 2, startsAt: at(25), segmentStart: at(-60) }, now), true);
  // Prelims done early: the main card's opener waits for the main card.
  assert.equal(boutIsLive({ ...bout, completed: 6, startsAt: at(15), segmentStart: at(15) }, now), false);
  // An administrator can hold it at Next, but not against evidence.
  assert.equal(boutIsLive({ ...bout, completed: 2, held: true }, now), false);
  assert.equal(boutIsLive({ ...bout, completed: 2, held: true, started: true }, now), true);
  assert.equal(boutIsLive({ ...bout, started: true, startsAt: at(30), segmentStart: at(30) }, now), true, "evidence beats any schedule");
});

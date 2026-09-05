import test from "node:test";
import assert from "node:assert/strict";
import { eventStatus, fightIsComplete, fightIsUnderway, isFightDay, liveDetailDue } from "./live-state.ts";
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

import test from "node:test";
import assert from "node:assert/strict";
import { finishDetail } from "../src/format.ts";

test("a finish reads as UFCStats words it, without the stray 'to' its blank parts leave", () => {
  assert.equal(finishDetail("Knee to Head In Clinch"), "Knee to Head In Clinch");
  assert.equal(finishDetail("Rear Naked Choke"), "Rear Naked Choke");
  assert.equal(finishDetail("to Corner Stoppage"), "Corner Stoppage");
  assert.equal(finishDetail("to Knee Injury"), "Knee Injury");
  assert.equal(finishDetail("Slam to On Ground"), "Slam On Ground");
  assert.equal(finishDetail("Kick to Head At Distance Wheel Kick"), "Kick to Head At Distance Wheel Kick");
  assert.equal(finishDetail("to"), "");
  assert.equal(finishDetail(null), "");
});

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, STATS_CHOICES, statsRequest } from "../src/statsDefaults.ts";
import { STATS_PAGE_OPENING } from "../../server/src/api-policy.ts";

test("the server warms the exact request the Stats page opens with", () => {
  assert.equal(statsRequest({ ...STATS_CHOICES, settings: DEFAULT_SETTINGS, fighterIds: [] }), STATS_PAGE_OPENING);
});

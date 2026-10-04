import test from "node:test";
import assert from "node:assert/strict";
import { pageRequests } from "../src/pageRequests.ts";

test("a page is warmed with the requests it makes itself", () => {
  const id = "0123456789abcdef";
  assert.deepEqual(pageRequests(`/fighters/${id}`, "", "media"),
    [`/api/fighters/${id}?ranking=media`, `/api/fighters/${id}/stats?scope=ufc&minBouts=0`]);
  assert.deepEqual(pageRequests(`/fights/${id}`, "?tab=score", "meta"), [`/api/fights/${id}?ranking=meta`]);
  assert.deepEqual(pageRequests(`/events/${id}`, "", "media"), [`/api/events/${id}?ranking=media`]);
  assert.deepEqual(pageRequests("/events/potential-matchups", "", "meta"), ["/api/events/potential-matchups?ranking=meta"]);
  assert.deepEqual(pageRequests("/fights/potential-jon-jones-vs-tom-aspinall-57626", "", "media"), ["/api/fights/potential-jon-jones-vs-tom-aspinall-57626?ranking=media"]);
  assert.deepEqual(pageRequests("/rankings", "", "media"), ["/api/rankings?ranking=media"]);
  assert.deepEqual(pageRequests("/rankings", "?date=2016-07-10&division=Lightweight", "meta"),
    ["/api/rankings?ranking=meta&date=2016-07-10"]);
  assert.deepEqual(pageRequests("/judges/sal-d-amato", "", "media"), ["/api/judges/sal-d-amato"]);
  assert.deepEqual(pageRequests("/profiles/fan", "?tab=bets", "media"), ["/api/profiles/fan?filter=decisions&q=&offset=0"]);
});

test("filtered views and unknown pages are left alone", () => {
  assert.deepEqual(pageRequests("/judges/sal-d-amato", "?rounds=3", "media"), []);
  assert.deepEqual(pageRequests("/profiles/me", "", "media"), []);
  assert.deepEqual(pageRequests("/profiles/fan", "?filter=all", "media"), []);
  assert.deepEqual(pageRequests("/stats", "", "media"), []);
});

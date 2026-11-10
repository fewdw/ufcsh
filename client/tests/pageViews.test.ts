import test from "node:test";
import assert from "node:assert/strict";
import { firstHiddenAt, pageViewFor } from "../src/pageViews.ts";

test("a page that sends the reader on to its own address is one view, not two", () => {
  // "/" opening its card, a renamed venue, <Navigate replace>.
  assert.equal(pageViewFor("/events/402ea3b5ee233852", true), "same");
  assert.equal(pageViewFor("/venues/t-mobile-arena", true), "same");
  // A link followed, Back, or the first page of the tab.
  assert.equal(pageViewFor("/events/402ea3b5ee233852", false), "new");
  assert.equal(pageViewFor("/", false), "new");
});

test("the reader's own profile is counted under its name, never as \"me\"", () => {
  assert.equal(pageViewFor("/profiles/me", false), "none");
  assert.equal(pageViewFor("/profiles/me", true), "none");
  // "me" was not counted, so the address it turns into is not a redirect of a counted view.
  assert.equal(pageViewFor("/profiles/fred", false), "new");
});

test("load timings know when the tab was first hidden, from the start of the page", () => {
  assert.equal(firstHiddenAt([]), Infinity);
  assert.equal(firstHiddenAt([{ name: "visible", startTime: 0 }]), Infinity);
  // Opened behind another tab, looked at 4 s later, left at 30 s.
  assert.equal(firstHiddenAt([{ name: "hidden", startTime: 0 }, { name: "visible", startTime: 4000 }, { name: "hidden", startTime: 30000 }]), 0);
  // Read, then left: paints before 9 s count.
  assert.equal(firstHiddenAt([{ name: "visible", startTime: 0 }, { name: "hidden", startTime: 9000 }]), 9000);
});

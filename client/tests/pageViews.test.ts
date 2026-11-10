import test from "node:test";
import assert from "node:assert/strict";
import { firstHiddenAt, pageViewTracker, SAME_VIEW } from "../src/pageViews.ts";

/** The paths a tab's arrivals are counted under, in order. */
function counted(arrivals: [path: string, how?: "push" | "replace" | "redirect"][]): string[] {
  const isPageView = pageViewTracker();
  return arrivals.filter(([path, how = "push"]) => isPageView(path, { replace: how !== "push", state: how === "redirect" ? SAME_VIEW : null }))
    .map(([path]) => path);
}

test("a page that sends the reader on to its own address is one view, not two", () => {
  // "/" opens its card and the address catches up: the home page, read once.
  assert.deepEqual(counted([["/"], ["/events/402ea3b5ee233852", "redirect"]]), ["/"]);
  // A venue's former name moves to its current one, then the reader goes on.
  assert.deepEqual(counted([["/venues/arco-arena"], ["/venues/sleep-train-arena", "redirect"], ["/events/1"]]), ["/venues/arco-arena", "/events/1"]);
  // A second redirect in a row is still that one view.
  assert.deepEqual(counted([["/"], ["/events/1", "redirect"], ["/events/2", "redirect"]]), ["/"]);
});

test("replacing the address without saying it is a redirect is a page of its own", () => {
  // The Browse tabs replace one another in history, and each is a different page.
  assert.deepEqual(counted([["/roster"], ["/officials", "replace"], ["/venues", "replace"], ["/awards", "replace"]]),
    ["/roster", "/officials", "/venues", "/awards"]);
  // Back to a page that was redirected to is a view: only arriving by the redirect is not.
  assert.deepEqual(counted([["/"], ["/events/1", "redirect"], ["/fights/9"], ["/events/1"]]), ["/", "/fights/9", "/events/1"]);
  // The same path twice running (a tab or a filter changing the query) is one view.
  assert.deepEqual(counted([["/fights/9"], ["/fights/9", "replace"], ["/fights/9"]]), ["/fights/9"]);
});

test("the reader's own profile is counted under its name, never as \"me\"", () => {
  assert.deepEqual(counted([["/profiles/me"], ["/profiles/fred", "replace"]]), ["/profiles/fred"]);
  assert.deepEqual(counted([["/stats"], ["/profiles/me"], ["/profiles/fred", "redirect"]]), ["/stats", "/profiles/fred"]);
});

test("load timings know when the tab was first hidden, from the start of the page", () => {
  assert.equal(firstHiddenAt([]), Infinity);
  assert.equal(firstHiddenAt([{ name: "visible", startTime: 0 }]), Infinity);
  // Opened behind another tab, looked at 4 s later, left at 30 s.
  assert.equal(firstHiddenAt([{ name: "hidden", startTime: 0 }, { name: "visible", startTime: 4000 }, { name: "hidden", startTime: 30000 }]), 0);
  // Read, then left: paints before 9 s count.
  assert.equal(firstHiddenAt([{ name: "visible", startTime: 0 }, { name: "hidden", startTime: 9000 }]), 9000);
});

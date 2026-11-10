import test from "node:test";
import assert from "node:assert/strict";
import { accountPage, sessionCookieSet } from "../src/sessionHint.ts";

test("a session timestamp, plain or suffixed, means someone may be signed in", () => {
  assert.equal(sessionCookieSet("__client_uat=1731234567"), true);
  assert.equal(sessionCookieSet("theme=dark; __client_uat_AbC123=1731234567"), true);
  assert.equal(sessionCookieSet("__client_uat=0; __client_uat_AbC123=1731234567"), true);
});

test("no cookie, an empty one or 0 means signed out", () => {
  assert.equal(sessionCookieSet(""), false);
  assert.equal(sessionCookieSet("theme=dark"), false);
  assert.equal(sessionCookieSet("__client_uat=0"), false);
  assert.equal(sessionCookieSet("__client_uat=0; __client_uat_AbC123=0"), false);
  assert.equal(sessionCookieSet("__client_uat=; other=1"), false);
  assert.equal(sessionCookieSet("x__client_uat=123"), false);
});

test("account pages, including Clerk's callback and hash routes, need Clerk", () => {
  for (const path of ["/sign-in", "/sign-in/callback", "/sign-up", "/profiles/me", "/admin", "/admin/bugs"]) assert.equal(accountPage(path), true, path);
  for (const path of ["/", "/profiles/someone", "/signing", "/administrators", "/events/abc"]) assert.equal(accountPage(path), false, path);
});

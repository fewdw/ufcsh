import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AdminStore, normalizeEmail } from "./admins.ts";
import { ScoringError } from "./scoring.ts";

const OWNER = "frederic.alefebvre@gmail.com";

function fixture(t: any, owner: string | null = OWNER) {
  const previous = process.env.DEFAULT_ADMIN;
  if (owner === null) delete process.env.DEFAULT_ADMIN;
  else process.env.DEFAULT_ADMIN = owner;
  const db = new DatabaseSync(":memory:");
  const store = new AdminStore(db);
  t.after(() => {
    db.close();
    if (previous === undefined) delete process.env.DEFAULT_ADMIN;
    else process.env.DEFAULT_ADMIN = previous;
  });
  return store;
}

test("the address named in the environment is an administrator and cannot be removed", (t) => {
  const store = fixture(t);
  assert.equal(store.isAdmin(OWNER), true);
  // However it is spelled or spaced, it is the same account.
  assert.equal(store.isAdmin(" Frederic.ALefebvre@Gmail.com "), true);
  assert.throws(() => store.remove(OWNER), ScoringError, "the permanent administrator stays");
  assert.throws(() => store.add(OWNER, OWNER), ScoringError, "and is never duplicated into the table");
  assert.equal(store.isAdmin(OWNER), true);
  const [first] = store.list();
  assert.deepEqual(first, { email: OWNER, addedAt: null, addedBy: null, removable: false });
  assert.equal(store.list().length, 1);
});

test("other administrators are added and removed, and take effect immediately", (t) => {
  const store = fixture(t);
  assert.equal(store.isAdmin("friend@example.com"), false);
  const added = store.add("Friend@Example.com", OWNER);
  assert.equal(store.isAdmin("friend@example.com"), true, "stored lower-cased, matched either way");
  assert.equal(added.length, 2);
  assert.equal(added[1].email, "friend@example.com");
  assert.equal(added[1].addedBy, OWNER);
  assert.equal(added[1].removable, true);
  // Adding twice is not an error and does not duplicate the row.
  assert.equal(store.add("friend@example.com", OWNER).length, 2);
  assert.equal(store.remove("friend@example.com").length, 1);
  assert.equal(store.isAdmin("friend@example.com"), false);
});

test("nothing else is an administrator, including the shapes an attacker would try", (t) => {
  const store = fixture(t);
  for (const value of [null, undefined, "", "   ", "not-an-email", "a@b", "@example.com", "owner@example.com\n", `${OWNER} `.repeat(200), 42, {}]) {
    assert.equal(store.isAdmin(value as string), false, `rejects ${JSON.stringify(value)}`);
  }
  for (const value of [null, "", "nope", 7]) assert.throws(() => store.add(value, OWNER), ScoringError);
  for (const value of [null, "", "nope"]) assert.throws(() => store.remove(value), ScoringError);
});

test("with no address configured, no account is an administrator by default", (t) => {
  const store = fixture(t, null);
  assert.equal(store.isAdmin(OWNER), false);
  assert.deepEqual(store.list(), []);
  // A row still grants access; only the permanent slot is unset.
  store.add("someone@example.com", "");
  assert.equal(store.isAdmin("someone@example.com"), true);
  assert.equal(store.list()[0].removable, true);
});

test("an address is normalized once, so the list and the check cannot disagree", () => {
  assert.equal(normalizeEmail("  Owner@Example.COM "), "owner@example.com");
  assert.equal(normalizeEmail("owner@example.com"), "owner@example.com");
  assert.equal(normalizeEmail("owner@sub.example.co.uk"), "owner@sub.example.co.uk");
  assert.equal(normalizeEmail("owner at example.com"), null);
  assert.equal(normalizeEmail(`${"x".repeat(320)}@example.com`), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LEASE_MS, syncLease } from "./sync-lease.ts";

test("one sync worker holds the lease until it lets go or stops renewing", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  let now = 1_000_000;
  const clock = () => now;
  const old = syncLease(db, "blue:7", clock);
  const fresh = syncLease(db, "green:7", clock);

  assert.equal(old.claim(), true);
  assert.equal(fresh.claim(), false, "the release taking over waits");
  now += LEASE_MS - 1;
  assert.equal(old.claim(), true, "the holder renews");
  assert.equal(fresh.claim(), false);
  old.release();
  assert.equal(fresh.claim(), true, "a clean shutdown hands over at once");
  assert.equal(old.claim(), false);
  fresh.release();

  // A holder that died without letting go is replaced once the lease expires.
  assert.equal(old.claim(), true);
  now += LEASE_MS;
  assert.equal(fresh.claim(), false);
  now += 1;
  assert.equal(fresh.claim(), true);
  old.release();
  assert.equal(old.claim(), false, "releasing someone else's lease does nothing");
});

import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { fighterNamed } from "./fighter-identity.ts";

test("duplicate directory entries link only to the uniquely confirmed signee without bout evidence", () => {
  db.exec("BEGIN");
  try {
    const insert = db.prepare("INSERT INTO fighters(id, name, norm_name, signee) VALUES (?, ?, ?, ?)");
    insert.run("identity-duplicate-unused", "Replacement Duplicate Fixture", "replacement duplicate fixture", 0);
    insert.run("identity-duplicate-signed", "Replacement Duplicate Fixture", "replacement duplicate fixture", 1);
    assert.equal(fighterNamed("Replacement Duplicate Fixture", "Lightweight", "2026-11-07"), "identity-duplicate-signed");
    db.prepare("UPDATE fighters SET signee = 1 WHERE id = ?").run("identity-duplicate-unused");
    assert.equal(fighterNamed("Replacement Duplicate Fixture", "Lightweight", "2026-11-07"), "", "two signed namesakes stay ambiguous");
    db.prepare("UPDATE fighters SET signee = 0 WHERE norm_name = ?").run("replacement duplicate fixture");
    assert.equal(fighterNamed("Replacement Duplicate Fixture", "Lightweight", "2026-11-07"), "", "directory entries alone do not establish a UFC identity");
  } finally { db.exec("ROLLBACK"); }
});


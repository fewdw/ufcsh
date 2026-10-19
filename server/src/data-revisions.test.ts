import test from "node:test";
import assert from "node:assert/strict";
import { dataRevision, db } from "./db.ts";

test("a moving line on a bout not yet fought moves profiles but not analytics", t => {
  const eventId = "face000000000021", fightId = "face000000000022";
  t.after(() => {
    db.prepare("DELETE FROM odds WHERE fight_id = ?").run(fightId);
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Test', '2099-01-01', 0)").run(eventId);
  db.prepare("INSERT INTO fights (id, event_id, f1_name, f2_name) VALUES (?, ?, 'Example Fighter', 'Example Opponent')").run(fightId, eventId);
  const revisions = () => ({ analytics: dataRevision("analytics"), profiles: dataRevision("profiles") });
  const moved = (change: () => void) => {
    const before = revisions();
    change();
    const after = revisions();
    return { analytics: after.analytics !== before.analytics, profiles: after.profiles !== before.profiles };
  };

  assert.deepEqual(moved(() => db.prepare("INSERT INTO odds (fight_id, f1_close, f2_close) VALUES (?, '-150', '+130')").run(fightId)),
    { analytics: false, profiles: true });
  assert.deepEqual(moved(() => db.prepare("UPDATE odds SET f1_close = '-170' WHERE fight_id = ?").run(fightId)),
    { analytics: false, profiles: true });

  db.prepare("UPDATE fights SET f1_outcome = 'win', f2_outcome = 'loss', method = 'U-DEC' WHERE id = ?").run(fightId);
  assert.deepEqual(moved(() => db.prepare("UPDATE odds SET f1_close = '-175', final = 1 WHERE fight_id = ?").run(fightId)),
    { analytics: true, profiles: true }, "a decided bout's closing line feeds the fight index");
  assert.deepEqual(moved(() => db.prepare("DELETE FROM odds WHERE fight_id = ?").run(fightId)),
    { analytics: true, profiles: true });
});

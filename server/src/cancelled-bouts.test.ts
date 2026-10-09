import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { resolvePublicApi } from "./api.ts";

// The API needs the same historical context as a normal row, even when the
// fighter actually fought a replacement on the cancellation's event date.
test("cancelled card rows retain profiles and only results before the event", async () => {
  db.exec("SAVEPOINT cancelled_card");
  try {
    const events = [
      ["cace000000000001", "2000-01-01"],
      ["cace000000000002", "2001-01-01"],
      ["cace000000000003", "2002-01-01"],
    ];
    for (const [id, date] of events) {
      db.prepare("INSERT INTO events (id, name, date, complete, detail_fetched_at) VALUES (?, 'Cancelled fixture', ?, 1, ?)")
        .run(id, date, Date.now());
    }
    for (const [id, name] of [["cacf000000000001", "Booked Fighter"], ["cacf000000000002", "Replacement"], ["cacf000000000003", "Unlinked Debutant"]]) {
      db.prepare("INSERT INTO fighters (id, name, birth_date, wins, photo_url) VALUES (?, ?, '1970-01-01', 99, 'https://example.com/headshot.png')")
        .run(id, name);
    }
    for (const [index, [eventId]] of [...events, events[1]].entries()) {
      db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f1_name, f2_id, f2_name,
        f1_outcome, f2_outcome, method, perf_bonus, fotn_bonus)
        VALUES (?, ?, ?, 'Flyweight', 'cacf000000000001', 'Booked Fighter', 'cacf000000000002', 'Replacement', ?, ?, 'U-DEC', 0, 0)`)
        .run(`cacb00000000000${index + 1}`, eventId, index === 1 ? 0 : 1, index === 0 ? "win" : "loss", index === 0 ? "loss" : "win");
    }
    const stored = [
      { f1: "Booked Fighter", f1_id: "cacf000000000001", f2: "Unlinked Debutant", f2_id: "cacf000000000003", division: "Flyweight", reason: "Injury" },
      { f1: "Unknown Fighter", f1_id: null, f2: "Replacement", f2_id: "cacf000000000002", division: null, reason: null },
    ];
    db.prepare("UPDATE events SET cancelled_json = ? WHERE id = ?").run(JSON.stringify(stored), events[1][0]);
    const event = await resolvePublicApi(new URL(`http://localhost/api/events/${events[1][0]}?ranking=media`)) as any;
    assert.equal(event.fights.length, 2, "a cancellation is not counted as a played bout");
    assert.equal(event.card_stats.total_fights, 2);
    const [bout, unknown] = event.cancelled;
    assert.equal(bout.f1.id, "cacf000000000001");
    assert.equal(bout.f1.profile_eligible, true);
    assert.ok(bout.f1.photo_url.includes(bout.f1.id));
    assert.equal(bout.f1.age, 31);
    assert.equal(bout.f1.ufc_record, "1-0");
    assert.deepEqual(bout.f1.form, ["win"], "same-day replacement and later results are excluded");
    assert.equal(bout.f1.streak.count, 1);
    assert.equal(bout.f1.outcome, null);
    assert.equal(bout.f1.record, "", "an unverified historical record cannot borrow today's 99 wins");
    assert.equal(bout.reason, "Injury");
    assert.equal(bout.division, "Flyweight");
    assert.equal(bout.f2.id, null, "a fighter without a UFC bout has no profile link");
    assert.equal(bout.f2.profile_eligible, false);
    assert.equal(unknown.f1.name, "Unknown Fighter");
    assert.equal(unknown.f1.id, null);
    assert.equal(unknown.f1.photo_url, null);
    assert.equal(unknown.f1.age, null);
    assert.deepEqual(unknown.f1.form, []);
    assert.equal(unknown.reason, null);
    assert.equal(unknown.division, null);

    db.prepare("UPDATE events SET cancelled_json = 'unreadable' WHERE id = ?").run(events[1][0]);
    const malformed = await resolvePublicApi(new URL(`http://localhost/api/events/${events[1][0]}`)) as any;
    assert.deepEqual(malformed.cancelled, []);
  } finally {
    db.exec("ROLLBACK TO cancelled_card; RELEASE cancelled_card");
  }
});

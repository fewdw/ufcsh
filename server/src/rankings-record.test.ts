import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { getRankings } from "./api.ts";
import { bugReport } from "./bugs.ts";

test("ranked records count every meeting, scope by current source/division, and exclude NCs and bookings", () => {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM rankings");
    const fighter = db.prepare("INSERT INTO fighters (id, name) VALUES (?, ?)");
    for (const id of ["subject", "champ", "other", "unranked", "media-only", "draw", "nc", "zero"]) {
      fighter.run(`top15-${id}`, `Top15 ${id}`);
    }
    db.prepare("INSERT INTO events (id, name, date, complete) VALUES ('top15-event', 'Top15 test', '2000-01-01', 1)").run();
    const bout = db.prepare(`INSERT INTO fights
      (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name, f1_outcome, f2_outcome)
      VALUES (?, 'top15-event', ?, 'Featherweight', 'top15-subject', ?, 'Top15 subject', ?, ?, ?)`);
    const meetings = [["champ", "win", "loss"], ["champ", "win", "loss"], ["champ", "loss", "win"],
      ["other", "win", "loss"], ["unranked", "loss", "win"], ["media-only", "loss", "win"],
      ["draw", "draw", "draw"], ["nc", "nc", "nc"], ["champ", null, null]];
    meetings.forEach(([opponent, result, inverse], i) => bout.run(`top15-bout-${i}`, i, `top15-${opponent}`, `Top15 ${opponent}`, result, inverse));
    const rank = db.prepare(`INSERT INTO rankings
      (ranking_type, division, div_pos, rank, fighter_id, fighter_name) VALUES (?, ?, ?, ?, ?, ?)`);
    const add = (source: string, division: string, position: number, ranking: string, id: string) =>
      rank.run(source, division, position, ranking, `top15-${id}`, `Top15 ${id}`);
    for (const source of ["meta", "media"]) {
      add(source, "Featherweight", 0, "C", "champ");
      add(source, "Featherweight", 1, "1", "subject");
      add(source, "Featherweight", 2, "2", "draw");
      add(source, "Featherweight", 3, "3", "nc");
      add(source, "Featherweight", 4, "4", "zero");
      add(source, "Featherweight", 16, "16", "unranked");
      add(source, "Lightweight", 0, "C", "other");
      add(source, "Lightweight", 1, "1", "subject");
    }
    add("media", "Lightweight", 2, "2", "media-only");
    add("media", "Men's Pound-for-Pound", 1, "1", "champ");
    add("media", "Men's Pound-for-Pound", 2, "2", "subject");

    for (const source of ["meta", "media"] as const) {
      const divisions = getRankings(source) as { division: string; entries: any[] }[];
      const entry = (division: string, id = "subject") => divisions.find((d) => d.division === division)!.entries.find((e) => e.name === `Top15 ${id}`)!;
      assert.deepEqual(entry("Featherweight").activity.top15_record, { wins: 2, losses: 1, draws: 1 });
      assert.deepEqual(entry("Lightweight").activity.top15_record, { wins: 1, losses: source === "media" ? 1 : 0, draws: 0 });
      assert.deepEqual(entry("Featherweight").activity.ranked_record, { wins: 3, losses: source === "media" ? 2 : 1, draws: 1 }, "a champion also ranked P4P is counted once per meeting");
      assert.deepEqual(entry("Featherweight", "champ").activity.top15_record, { wins: 1, losses: 2, draws: 0 }, "opponent perspective");
      assert.deepEqual(entry("Featherweight", "zero").activity.top15_record, { wins: 0, losses: 0, draws: 0 });
      assert.equal(entry("Men's Pound-for-Pound").activity.top15_record, null, "P4P is not a weight division");
      assert.deepEqual(entry("Men's Pound-for-Pound").activity.ranked_record, entry("Featherweight").activity.ranked_record);
    }
    add("meta", "Featherweight", 5, "5", "missing");
    const gaps = bugReport().checks.find((check) => check.id === "ranked-record-gaps")!;
    assert.ok(gaps.items.some((item) => item.title === "Top15 missing" && item.actions.length === 0));
    assert.ok(gaps.items.some((item) => item.title === "Top15 subject" && item.actions[0]?.id === "career"));
  } finally {
    db.exec("ROLLBACK");
  }
});

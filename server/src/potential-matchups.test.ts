import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { potentialMatchups, storePotentialBoard, type PotentialMatchup } from "./potential-matchups.ts";
import { resolvePublicApi } from "./api.ts";
import { publicApi } from "./api-policy.ts";
import { pageSeo } from "./seo.ts";
import type { FightOddsBout } from "./scrape/fightodds.ts";

test("potential prices stay separate from booked bouts, refresh, and disappear when booked or unpriced", async () => {
  const prior = db.prepare("SELECT * FROM potential_matchups").all() as PotentialMatchup[];
  const meta = db.prepare("SELECT * FROM meta WHERE key LIKE 'potential_%'").all() as { key: string; value: string }[];
  const f1 = "potential-test-one", f2 = "potential-test-two";
  const bout: FightOddsBout = { slug: "test-pair", url: "https://fightodds.io/fights/test-pair/odds", propCount: 0,
    f1: { id: f1, name: "First Fighter", last: "Fighter" }, f2: { id: f2, name: "Second Fighter", last: "Fighter" },
    quotes: [{ open: [-200, 170], now: [-150, 130] }],
  };
  const fightsBefore = db.prepare("SELECT COUNT(*) AS n FROM fights").get()!.n;
  const jobsBefore = db.prepare("SELECT COUNT(*) AS n FROM refresh_jobs").get()!.n;
  try {
    db.exec("DELETE FROM potential_matchups");
    await storePotentialBoard([bout, { ...bout, slug: "duplicate", f1: bout.f2, f2: bout.f1 }]);
    assert.equal(potentialMatchups().length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fights").get()!.n, fightsBefore);
    const event: any = await resolvePublicApi(new URL("http://test/api/events/potential-matchups"));
    assert.equal(event.potential, true);
    assert.equal(event.date, "");
    assert.equal(event.fights[0].scheduled_rounds, null);
    assert.equal(event.fights[0].odds.f1.close, "-150");
    assert.equal(publicApi("/api/events/potential-matchups"), true);
    assert.equal(publicApi("/api/fights/potential-test-pair"), true);
    const fight: any = await resolvePublicApi(new URL("http://test/api/fights/potential-test-pair"));
    assert.equal(fight.potential, true);
    assert.equal(fight.prediction_available, false);
    assert.equal(fight.live, false);
    assert.equal(fight.event.date, "");
    assert.equal(fight.scheduled_rounds, null);
    assert.equal(fight.odds.f2.close, "+130");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM refresh_jobs").get()!.n, jobsBefore);
    assert.equal(pageSeo("/events/potential-matchups").status, 200);
    assert.equal(pageSeo("/fights/potential-test-pair").status, 200);
    assert.equal(pageSeo("/fights/potential-missing").status, 404);
    assert.equal(pageSeo("/fights/potential-test-pair").structuredData, undefined);

    const bfo = { ...bout, slug: "bfo-42", url: "https://www.bestfightodds.com/events/future-events-197",
      f1: bout.f2, f2: bout.f1, quotes: [{ open: [null, null] as [null, null], now: [160, -190] as [number, number] }] };
    await storePotentialBoard([bfo, { ...bfo, slug: "bfo-43", f2: { ...bout.f1, id: "potential-test-three", name: "Third Fighter" } }], false, "bestfightodds");
    assert.equal(potentialMatchups().length, 2);
    assert.equal(potentialMatchups().find(row => row.f1_id === f1)?.id, "potential-test-pair");
    const combined: any = await resolvePublicApi(new URL("http://test/api/events/potential-matchups"));
    assert.deepEqual(new Set(combined.odds_freshness.sources), new Set(["FightOdds.io", "BestFightOdds"]));
    db.prepare("UPDATE potential_matchups SET fetched_at = ? WHERE id = 'potential-test-pair'").run(Date.now() - 11 * 60_000);
    const fallback = potentialMatchups().find(row => row.id === "potential-bfo-42")!;
    assert.equal(JSON.parse(fallback.odds_json).f1.close, "+160");
    await storePotentialBoard([]);
    assert.equal(potentialMatchups().length, 2, "one source cannot delete the other's snapshots");
    await storePotentialBoard([], false, "bestfightodds");
    assert.equal(potentialMatchups().length, 0);
    await storePotentialBoard([bout]);

    await storePotentialBoard([{ ...bout, quotes: [{ open: [-250, 210], now: [-180, 155] }] }]);
    const updated = JSON.parse(potentialMatchups()[0].odds_json);
    assert.equal(updated.f1.open, "-200");
    assert.equal(updated.f1.close, "-180");
    db.prepare("INSERT INTO events (id, name, date) VALUES ('potential-test-event', 'Announced card', '2099-01-01')").run();
    db.prepare("INSERT INTO fights (id, event_id, f1_id, f2_id) VALUES ('potential-test-booked', 'potential-test-event', ?, ?)").run(f2, f1);
    assert.equal(potentialMatchups().length, 0);
    assert.equal(await resolvePublicApi(new URL("http://test/api/fights/potential-test-pair")), undefined);
    db.prepare("DELETE FROM fights WHERE id = 'potential-test-booked'").run();
    await storePotentialBoard([{ ...bout, quotes: [] }]);
    assert.equal(potentialMatchups().length, 0);
  } finally {
    db.prepare("DELETE FROM fights WHERE id = 'potential-test-booked'").run();
    db.prepare("DELETE FROM events WHERE id = 'potential-test-event'").run();
    db.exec("DELETE FROM potential_matchups");
    const insert = db.prepare("INSERT INTO potential_matchups VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const row of prior) insert.run(row.id, row.f1_id, row.f2_id, row.f1_name, row.f2_name, row.odds_json, row.fetched_at);
    db.exec("DELETE FROM meta WHERE key LIKE 'potential_%'");
    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const row of meta) insertMeta.run(row.key, row.value);
  }
});

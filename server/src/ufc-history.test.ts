import test from "node:test";
import assert from "node:assert/strict";
import { fightIndex, mergeUfcBouts, professionalBoutsBefore, ufcBoutsBefore, type CareerBout } from "./fight-index.ts";
import { getFighterPreview, resolvePublicApi } from "./api.ts";

const bout = (patch: Partial<CareerBout> = {}): CareerBout => ({
  date: "2024-01-01",
  sourceOrder: 1,
  outcome: "win",
  method: "Decision",
  opponentName: "Opponent",
  eventName: "Dana White's Contender Series",
  isUfc: true,
  ufcFightId: null,
  ...patch,
});

test("merged UFC history keeps source-only bouts without duplicating local fights", () => {
  const local = [
    bout({ date: "2025-03-01", sourceOrder: 12, opponentName: "Local Opponent", method: "KO/TKO", ufcFightId: "local" }),
    bout({ date: "2025-04-01", sourceOrder: 4, opponentName: "Fresh Result", method: "SUB", ufcFightId: "fresh" }),
  ];
  const source = [
    bout({ date: "2024-08-01", sourceOrder: 3, opponentName: "Source Only", outcome: "loss" }),
    bout({ date: "2025-03-01", sourceOrder: 2, opponentName: "Local Opponent", method: "TKO", ufcFightId: "local" }),
    // The local result arrived before reconciliation attached its fight id.
    bout({ date: "2025-04-01", sourceOrder: 1, opponentName: "Fresh Result", method: "Submission" }),
  ];

  const merged = mergeUfcBouts(local, source);
  assert.deepEqual(merged.map((row) => row.opponentName), ["Source Only", "Local Opponent", "Fresh Result"]);
  assert.equal(merged[1].method, "KO/TKO", "the richer local method wins");
  assert.equal(merged[1].sourceOrder, 2, "source order is retained for same-day chronology");
  assert.equal(merged.filter((row) => row.opponentName === "Fresh Result").length, 1);
});

test("every indexed UFC record is the record of its merged UFC timeline", () => {
  const index = fightIndex();
  for (const fighter of index.fighters.values()) {
    const count = (outcome: CareerBout["outcome"]) => fighter.ufcBouts.filter((bout) => bout.outcome === outcome).length;
    assert.deepEqual(
      fighter.ufc,
      { wins: count("win"), losses: count("loss"), draws: count("draw"), ncs: count("nc") },
      fighter.name,
    );
    const linked = fighter.ufcBouts.map((bout) => bout.ufcFightId).filter(Boolean);
    assert.equal(new Set(linked).size, linked.length, `${fighter.name} has a duplicated local UFC fight`);
  }
});

test("Matthieu Duclos carries his Contender Series loss into his UFC debut", () => {
  const index = fightIndex();
  const fighter = index.fighters.get("ec322adbabbfa6e7");
  assert.ok(fighter);
  assert.deepEqual(fighter.ufc, { wins: 1, losses: 1, draws: 0, ncs: 0 });
  const debut = index.byId.get("e5fd7ef7ccf955b8");
  assert.ok(debut);
  const prior = ufcBoutsBefore(index, fighter.id, debut.date, debut.ord);
  assert.deepEqual(prior.map((row) => ({ outcome: row.outcome, opponent: row.opponentName })), [
    { outcome: "loss", opponent: "Marco Tulio" },
  ]);

  const preview = getFighterPreview(fighter.id) as any;
  assert.equal(preview.recent.length, 5);
  assert.deepEqual(preview.recent.map((row: any) => row.ufc), [true, false, false, false, false]);
});

test("last five uses the full career while UFC records keep their own scope", async () => {
  const event = await resolvePublicApi(new URL("http://localhost/api/events/2144954270be834d")) as any;
  const fight = event.fights.find((row: any) => row.id === "e5fd7ef7ccf955b8");
  const duclos = [fight.f1, fight.f2].find((side: any) => side.id === "ec322adbabbfa6e7");
  assert.equal(duclos.ufc_record, "0-1");
  assert.deepEqual(duclos.form_details, [
    { outcome: "loss", method: "KO/TKO", ufc: true },
    { outcome: "win", method: "DEC", ufc: false },
    { outcome: "win", method: "KO/TKO", ufc: false },
    { outcome: "win", method: "KO/TKO", ufc: false },
    { outcome: "win", method: "KO/TKO", ufc: false },
  ]);
  assert.equal(duclos.streak.count, 4);
  assert.equal(duclos.streak.outcome, "win");

  const matchup = await resolvePublicApi(new URL("http://localhost/api/fights/e5fd7ef7ccf955b8")) as any;
  const side = [matchup.f1, matchup.f2].find((row: any) => row.id === duclos.id);
  assert.deepEqual(side.recent_history.map((row: any) => row.opponent.name), [
    "Ilian Bouafia", "Moacir Rocha", "Thiago Hayne", "Daichi Henry Mikami", "Marco Tulio",
  ]);
});

test("every fighter's form timeline retains outside bouts and excludes the current fight", () => {
  const index = fightIndex();
  for (const fighter of index.fighters.values()) {
    const last = fighter.fights.at(-1);
    if (!last) continue;
    const prior = professionalBoutsBefore(index, fighter.id, last.date, last.ord);
    assert.ok(prior.every((bout) => bout.ufcFightId !== last.id), fighter.name);
    if (fighter.careerVerified) {
      for (const outside of fighter.outsideBouts.filter((bout) => bout.date < last.date)) {
        assert.ok(prior.includes(outside), `${fighter.name}: missing outside bout vs ${outside.opponentName}`);
      }
    }
  }
});

test("debutants and recent signees keep five results instead of only their UFC appearances", async () => {
  const event = await resolvePublicApi(new URL("http://localhost/api/events/638cfec7ec559d6e")) as any;
  const sides = event.fights.flatMap((fight: any) => [fight.f1, fight.f2]);
  for (const [name, ufcCount] of [["Tommy Gantt", 2], ["Sean King III", 0], ["Regina Tarin", 1]] as const) {
    const side = sides.find((fighter: any) => fighter.name === name);
    assert.ok(side, name);
    assert.equal(side.form_details.length, 5, name);
    assert.equal(side.form_details.filter((row: any) => row.ufc).length, ufcCount, name);
  }
  const sean = sides.find((fighter: any) => fighter.name === "Sean King III");
  assert.deepEqual(sean.form_details.map((row: any) => row.method), ["DEC", "DEC", "KO/TKO", "SUB", "KO/TKO"]);
});

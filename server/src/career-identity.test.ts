import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedIdentity, nameAliases, samePersonName, type KnownUfcBout, type LocalFighter, type ReconciledBout } from "./career-records.ts";
import type { SherdogProfile } from "./scrape/sherdog.ts";

const local: LocalFighter = { id: "x", name: "Patricio Pitbull", nickname: "", birth_date: "1987-07-07", wins: 37, losses: 9, draws: 0 };
const profile = (patch: Partial<SherdogProfile> = {}): SherdogProfile => ({
  id: "9960", url: "https://www.sherdog.com/fighter/Patricio-Freire-9960",
  name: "Patricio Freire", nickname: "Pitbull", birthDate: "1987-07-07",
  country: "Brazil", countryCode: "BR", birthplace: "Natal, Rio Grande do Norte",
  wins: 37, losses: 9, draws: 0, ncs: 0, bouts: [], ...patch,
});
const known = (n: number): KnownUfcBout[] =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, date: `2024-0${i + 1}-01`, opponent: `Opponent ${i}` }));
const reconciled = (n: number): ReconciledBout[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `k${i}`, sourceOrder: i, date: `2024-0${i + 1}-01`, outcome: "win" as const,
    opponentName: `Opponent ${i}`, opponentUrl: "", eventName: "UFC 300", eventUrl: "",
    method: "Decision (Unanimous)", round: "3", time: "5:00", isUfc: true, ufcFightId: `f${i}`,
  }));

test("a fighter filed under their ring name is still the same person", () => {
  assert.deepEqual(nameAliases("Patricio Freire", "Pitbull"), ["Patricio Freire", "patricio pitbull", "pitbull freire"]);
  assert.ok(samePersonName("Patricio Pitbull", "Patricio Freire", "Pitbull"));
  assert.ok(samePersonName("Patricio Freire", "Patricio Freire"));
});

test("a nickname alone is never an identity", () => {
  assert.equal(samePersonName("Pitbull", "Patricio Freire", "Pitbull"), false);
  assert.equal(samePersonName("Patricio Lima", "Patricio Freire", "Pitbull"), false, "another Pitbull is another person");
  assert.deepEqual(nameAliases("Jon Jones", ""), ["Jon Jones"]);
});

test("a ring-name match has to be carried by bouts or a birth date", () => {
  // Two of our own UFC bouts reconciling exactly is the strong key.
  assert.ok(isVerifiedIdentity(local, 4, profile(), reconciled(2), known(2)));
  // With one bout and no matching birth date, the ring name is not enough.
  assert.equal(isVerifiedIdentity({ ...local, birth_date: "" }, 4, profile({ birthDate: "" }), reconciled(1), known(1)), false);
  // The same date of birth carries it where the bouts cannot.
  assert.ok(isVerifiedIdentity(local, 1, profile(), [], []));
});

test("an exact name still needs the record or the bouts to agree", () => {
  const sameName = profile({ name: "Patricio Pitbull", nickname: "" });
  assert.ok(isVerifiedIdentity(local, 1, sameName, reconciled(2), known(2)));
  assert.equal(isVerifiedIdentity(local, 1, profile({ name: "Patricio Pitbull", nickname: "", wins: 12 }), [], []), false);
});

test("initial punctuation and omitted suffixes match without merging different suffixes", () => {
  assert.ok(samePersonName("JJ Aldrich", "J.J. Aldrich"));
  assert.ok(samePersonName("DongHun Choi", "Dong Hun Choi"));
  assert.ok(samePersonName("SeungGuk Choi", "Seung Guk Choi"));
  assert.ok(samePersonName("Sean King III", "Sean King"));
  assert.equal(samePersonName("Sean King III", "Sean King II"), false);
  assert.equal(samePersonName("Sean King Jr.", "Sean King Sr."), false);
});

test("a debutant suffix match still needs corroboration when several names match", () => {
  const debutant = { ...local, name: "Sean King III", nickname: "The King of New Orleans", birth_date: "", wins: 6, losses: 0 };
  const candidate = profile({ name: "Sean King", nickname: "", birthDate: "", wins: 6, losses: 0 });
  assert.equal(isVerifiedIdentity(debutant, 3, candidate, [], []), false);
  assert.ok(isVerifiedIdentity(debutant, 3, { ...candidate, nickname: debutant.nickname }, [], []));
});

test("a known legal-name profile needs matching birth date, UFC history, and record", () => {
  const fighter = { ...local, name: "Tommy Gantt", birth_date: "1993-01-09", wins: 12, losses: 0 };
  const candidate = profile({ name: "Thomas Gantt", nickname: "", birthDate: fighter.birth_date, wins: 12, losses: 0 });
  assert.ok(isVerifiedIdentity(fighter, 1, candidate, reconciled(1), known(1)));
  assert.equal(isVerifiedIdentity(fighter, 1, { ...candidate, birthDate: "1990-01-01" }, reconciled(1), known(1)), false);
  assert.equal(isVerifiedIdentity(fighter, 1, candidate, [], []), false);
  assert.equal(isVerifiedIdentity(fighter, 1, { ...candidate, wins: 11 }, reconciled(1), known(1)), false);
});

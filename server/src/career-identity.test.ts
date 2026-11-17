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

test("a UFC bout reconciles through a shortened or misspelled opponent name", async () => {
  const { reconcileCareerBouts, similarOpponentName } = await import("./career-records.ts");
  assert.ok(similarOpponentName("Felix Lee Mitchell", "Felix Mitchell"));
  assert.ok(similarOpponentName("Christophe Leninger", "Christophe Leininger"));
  assert.ok(similarOpponentName("Josh Culibao", "Joshua Culibao"));
  assert.ok(similarOpponentName("Constantinos Philippou", "Costas Philippou"));
  assert.ok(similarOpponentName("Maheshate", "Maheshate Hayisaer"));
  assert.equal(similarOpponentName("Nick Diaz", "Nate Diaz"), false, "brothers are different people");
  assert.equal(similarOpponentName("Jon Jones", "Jon Fitch"), false);

  const row = (date: string, opponentName: string, eventName = "UFC 3") => ({
    key: `${date}${opponentName}`, sourceOrder: 0, date, outcome: "win" as const, opponentName, opponentUrl: "",
    eventName, eventUrl: "", method: "", round: "", time: "",
  });
  // Tournament night: two bouts on one date, each found by its own opponent.
  const night = reconcileCareerBouts(
    [row("1994-09-09", "Felix Mitchell"), row("1994-09-09", "Christophe Leininger")],
    [{ id: "a", date: "1994-09-09", opponent: "Felix Lee Mitchell" }, { id: "b", date: "1994-09-09", opponent: "Christophe Leninger" }],
  );
  assert.deepEqual(night.map((bout) => bout.ufcFightId), ["a", "b"]);
  // A rematch the same night: the result tells the two bouts apart.
  const rematch = reconcileCareerBouts(
    [row("1997-12-21", "Marcus Silveira"), { ...row("1997-12-21", "Marcus Silveira"), key: "nc", outcome: "nc" as const }],
    [{ id: "nc", date: "1997-12-21", opponent: "Marcus Silveira", outcome: "nc" }, { id: "win", date: "1997-12-21", opponent: "Marcus Silveira", outcome: "win" }],
  );
  assert.deepEqual(rematch.map((bout) => bout.ufcFightId), ["win", "nc"]);
  // Different names, a day apart, and the only bout either source has then.
  const renamed = reconcileCareerBouts([row("2020-02-23", "Konklak Suphisara")], [{ id: "c", date: "2020-02-22", opponent: "Loma Lookboonmee" }]);
  assert.equal(renamed[0].ufcFightId, "c");
  assert.equal(reconcileCareerBouts([row("2012-10-20", "Robert Montiel", "UFC Venezuela 4 - National MMA 2")], [])[0].isUfc, false);
});

test("records a bout apart still verify on name, birth date and every UFC bout", () => {
  const fighter = { ...local, name: "Farman Hasanov", nickname: "", birth_date: "1995-08-01", wins: 6, losses: 0 };
  const candidate = profile({ name: "Farman Hasanov", nickname: "", birthDate: "1995-08-01", wins: 5, losses: 0 });
  assert.ok(isVerifiedIdentity(fighter, 1, candidate, reconciled(1), known(1)), "one UFC bout, record off by one");
  assert.ok(isVerifiedIdentity(fighter, 1, candidate, [], []), "debutant with a stale record");
  assert.ok(isVerifiedIdentity(fighter, 1, { ...candidate, birthDate: "" }, reconciled(1), known(1)), "exact name plus the shared UFC bout");
  assert.equal(isVerifiedIdentity(fighter, 1, { ...candidate, birthDate: "" }, [], []), false, "a debutant name alone is not enough");
  assert.equal(isVerifiedIdentity(fighter, 1, candidate, [], known(1)), false, "the UFC bout has to reconcile");
  assert.equal(isVerifiedIdentity(fighter, 1, { ...candidate, wins: 15, losses: 4 }, [], []), false, "a debutant far apart needs review");
  const nicknamed = { ...fighter, nickname: "Tina Black" };
  const farApart = { ...candidate, nickname: "Tina Black", wins: 15, losses: 4 };
  assert.ok(isVerifiedIdentity(nicknamed, 1, farApart, [], []), "the only name, nickname and birth date match settles it");
  assert.equal(isVerifiedIdentity(nicknamed, 2, farApart, [], []), false, "not when another candidate shares the name");
  assert.equal(isVerifiedIdentity(nicknamed, 1, { ...farApart, birthDate: "" }, [], []), false, "not without the birth date");
  const shortName = { ...nicknamed, name: "Joe Kropschot" };
  assert.ok(isVerifiedIdentity(shortName, 1, { ...farApart, name: "Joseph Kropschot" }, [], []), "a short first name");
  assert.equal(isVerifiedIdentity(shortName, 1, { ...farApart, name: "Joseph Kropp" }, [], []), false, "not another surname");
  assert.equal(isVerifiedIdentity(fighter, 1, { ...candidate, wins: 4 }, reconciled(1), known(1)), false, "two bouts apart needs review");
  const typo = { ...fighter, name: "Mehemmedeli Osmanli" };
  assert.ok(isVerifiedIdentity(typo, 1, { ...candidate, name: "Mehemmedali Osmanli" }, [], []));
  assert.equal(isVerifiedIdentity(typo, 1, { ...candidate, name: "Mehemmedali Osmanli", birthDate: "" }, [], []), false);
  assert.equal(isVerifiedIdentity({ ...fighter, name: "Nick Diaz" }, 1, { ...candidate, name: "Nate Diaz" }, [], []), false);
});

test("a newcomer verifies when the source history passed through the UFCStats record", () => {
  const fighter = { ...local, name: "Ivan Gnizditskiy", nickname: "", birth_date: "1996-05-10", wins: 5, losses: 0 };
  const win = (date: string) => ({ ...reconciled(1)[0], date, outcome: "win" as const });
  const bouts = ["2026-03-28", "2025-05-30", "2025-03-07", "2024-10-12", "2024-02-24", "2023-05-27", "2018-06-10"].map(win);
  const candidate = profile({ name: "Ivan Gnizditskiy", nickname: "Samurai", birthDate: "1996-05-10", wins: 7, losses: 0, bouts });
  assert.ok(isVerifiedIdentity(fighter, 1, candidate, [], []));
  assert.equal(isVerifiedIdentity(fighter, 2, candidate, [], []), false, "not when another candidate shares the name");
  assert.equal(isVerifiedIdentity(fighter, 1, { ...candidate, birthDate: "" }, [], []), false, "not without the birth date");
  assert.equal(isVerifiedIdentity({ ...fighter, losses: 1 }, 1, candidate, [], []), false, "not a record the history never had");
});

test("a one-word UFCStats name matches the source's family-name-last spelling", () => {
  assert.ok(samePersonName("Jiniushiyue", "Niushiyue Ji"));
  assert.ok(samePersonName("Niushiyue Ji", "Jiniushiyue"));
  assert.equal(samePersonName("Jiniushiyue", "Niushiyue Jin"), false);
  const fighter = { ...local, name: "Jiniushiyue", nickname: "Little Vajra", birth_date: "2000-12-09", wins: 17, losses: 4 };
  assert.ok(isVerifiedIdentity(fighter, 1, profile({ name: "Niushiyue Ji", nickname: "Little King Kong", birthDate: "2000-12-09", wins: 17, losses: 4 }), [], []));
});

import test from "node:test";
import assert from "node:assert/strict";
import { boutLines, boutProps, consensusLine, matchBout, parseBout, type FightOddsBout, type RawProp } from "./fightodds.ts";

const silva = { id: "RmlnaHRlck5vZGU6MQ==", firstName: "Natalia Cristina", lastName: "da Silva", fightmetricUrl: "http://www.ufcstats.com/fighter-details/262d32ebda89efc4" };
const wang = { id: "RmlnaHRlck5vZGU6Mg==", firstName: "Cong", lastName: "Wang", fightmetricUrl: "http://www.ufcstats.com/fighter-details/2997e7fe3c9d3d4a" };
const outcome = (odds: number | null, oddsOpen: number | null, fighter = silva) => ({ odds, oddsOpen, fighter: { id: fighter.id } });

test("a board bout reads each book against the fighter its outcomes name", () => {
  const bout = parseBout({
    slug: "natalia-cristina-da-silva-vs-cong-wang-81444",
    isCancelled: false,
    fighter1: silva,
    fighter2: wang,
    straightOffers: { edges: [
      { node: { outcome1: outcome(-215, -250), outcome2: outcome(164, 198, wang) } },
      // Listed the other way round by this book.
      { node: { outcome1: outcome(176, 177, wang), outcome2: outcome(-209, -210) } },
      // A book with no price yet.
      { node: { outcome1: outcome(null, null), outcome2: outcome(null, null, wang) } },
    ] },
  });
  assert.equal(bout.url, "https://fightodds.io/fights/natalia-cristina-da-silva-vs-cong-wang-81444/odds");
  assert.deepEqual(bout.f1, { id: "262d32ebda89efc4", name: "Natalia Cristina da Silva", last: "da Silva" });
  assert.deepEqual(bout.quotes, [
    { now: [-215, 164], open: [-250, 198] },
    { now: [-209, 176], open: [-210, 177] },
  ]);
});

test("the line is each corner's median across books that describe one market", () => {
  assert.deepEqual(consensusLine([[-215, 164], [-209, 176], [-205, 173]]), ["-209", "+173"]);
  // A prediction market's placeholder pair (both sides near-certain) is dropped,
  // and one far-off book cannot drag the line.
  assert.deepEqual(consensusLine([[-215, 164], [-9900, -9900], [-209, 176], [-400, 300], [-205, 173], [-210, 170]]), ["-210", "+173"]);
  // An even count takes the midpoint of the middle two in probability.
  assert.deepEqual(consensusLine([[-110, -110], [-120, 100]]), ["-115", "-105"]);
  assert.equal(consensusLine([[-233, -900]]), null);
  assert.equal(consensusLine([]), null);
});

test("a bout opens at the books' openers, or at today's line when none kept one", () => {
  const bout = (open: [number | null, number | null]): FightOddsBout => ({
    slug: "", url: "", propCount: 0, f1: { id: null, name: "", last: "" }, f2: { id: null, name: "", last: "" },
    quotes: [{ now: [-141, 121], open }],
  });
  assert.deepEqual(boutLines(bout([-210, 180])), { open: ["-210", "+180"], close: ["-141", "+121"] });
  assert.deepEqual(boutLines(bout([null, null])), { open: ["-141", "+121"], close: ["-141", "+121"] });
});

test("board bouts match our fights by UFCStats id, in either corner", () => {
  const fights = [
    { id: "a", f1_id: "2997e7fe3c9d3d4a", f2_id: "262d32ebda89efc4", names1: ["Wang Cong"], names2: ["Natalia Silva"] },
    { id: "b", f1_id: "c0ac37a4a1133da9", f2_id: "romero0000000000", names1: ["Marcus McGhee"], names2: ["Anthony Romero"] },
  ];
  const corner = (id: string | null, name: string, last: string) => ({ id, name, last });
  const bout = (f1: ReturnType<typeof corner>, f2: ReturnType<typeof corner>): FightOddsBout => ({ slug: "", url: "", propCount: 0, f1, f2, quotes: [] });

  const silvaWang = matchBout(bout(corner("262d32ebda89efc4", "Natalia Cristina da Silva", "da Silva"), corner("2997e7fe3c9d3d4a", "Cong Wang", "Wang")), fights);
  assert.deepEqual(silvaWang && { id: silvaWang.fight.id, reversed: silvaWang.reversed }, { id: "a", reversed: true });

  // A debutant the board hasn't linked to UFCStats matches by surname beside a linked opponent.
  const debut = matchBout(bout(corner("c0ac37a4a1133da9", "Marcus McGhee", "McGhee"), corner(null, "Anthony Romero", "Romero")), fights);
  assert.equal(debut?.fight.id, "b");
  // A replacement opponent is not the booked fight.
  assert.equal(matchBout(bout(corner("c0ac37a4a1133da9", "Marcus McGhee", "McGhee"), corner(null, "Jose Delgado", "Delgado")), fights), null);
  assert.equal(matchBout(bout(corner("c0ac37a4a1133da9", "Marcus McGhee", "McGhee"), corner("ffffffffffffffff", "Anthony Romero", "Romero")), fights), null);
  // Two unlinked corners need both full names.
  const unlinked = [{ id: "c", f1_id: "1111111111111111", f2_id: "2222222222222222", names1: ["Bruce Whitehead"], names2: ["Jacobe Smith"] }];
  assert.equal(matchBout(bout(corner(null, "Bruce Whitehead", "Whitehead"), corner(null, "Jacobe Smith", "Smith")), unlinked)?.fight.id, "c");
  assert.equal(matchBout(bout(corner(null, "Tom Whitehead", "Whitehead"), corner(null, "Jacobe Smith", "Smith")), unlinked), null);
});

test("board props become the matchup's markets, in our corners and wording", () => {
  const offer = (book: string, a: number | null, b: number | null = null, prev: number | null = null) =>
    ({ node: { sportsbook: { shortName: book }, outcome1: a == null ? null : { odds: a, oddsPrev: prev }, outcome2: b == null ? null : { odds: b, oddsPrev: null } } });
  const prop = (propName1: string, propName2: string, ...offers: ReturnType<typeof offer>[]): RawProp => ({ propName1, propName2, offers: { edges: offers } });
  const bout: FightOddsBout = {
    slug: "s", url: "https://fightodds.io/fights/s/odds", propCount: 9, quotes: [],
    f1: { id: "262d32ebda89efc4", name: "Natalia Cristina da Silva", last: "da Silva" },
    f2: { id: "2997e7fe3c9d3d4a", name: "Cong Wang", last: "Wang" },
  };
  const props = [
    prop("Natalia Cristina da Silva", "Cong Wang", offer("Circa", -215, 185)),
    prop("Cristina da Silva wins by TKO/KO", "Cristina da Silva doesn't win by TKO/KO", offer("FanDuel", 700, null, 650), offer("Kalshi", 669)),
    prop("Wang wins by submission", "Wang doesn't win by submission", offer("Pinnacle", 1995, -10694), offer("Kalshi", 4900)),
    prop("Over 2.5 rounds", "Under 2.5 rounds", offer("Betway", -549, 350), offer("BetRivers", -625, 350)),
    prop("Over 0.5 rounds", "Under 0.5 rounds", offer("Bovada", -3300, 1200)),
    prop("Fight goes the distance", "Fight ends inside distance", offer("Pinnacle", -259, 207)),
    prop("Fight ends in Round 1 - Submission", "Fight doesn't end in Round 1 - Submission", offer("DraftKings", 2500)),
    prop("Wang wins in round 3 - KO, TKO or DQ", "Wang doesn't win in round 3 - KO, TKO or DQ", offer("Bovada", 3500)),
    prop("Wang wins in round 3", "Wang doesn't win in round 3", offer("Caesars", 2100)),
  ];
  // Our card lists Wang in the red corner.
  const odds = boutProps(props, bout, true, ["Wang Cong", "Natalia Silva"]);
  assert.equal(odds.sourceUrl, bout.url);
  assert.deepEqual(odds.f2, { ko: { label: "Natalia Silva wins by TKO/KO", prices: [{ bookmaker: "FanDuel", line: "+700", move: "up" }] } });
  assert.deepEqual(odds.f1, { submission: { label: "Wang Cong wins by submission", prices: [{ bookmaker: "Pinnacle", line: "+1995" }] } });
  assert.deepEqual(odds.additional.map((quote) => `${quote.label} ${quote.prices.map((price) => price.line).join(" ")}`), [
    "Over 2½ rounds -549 -625",
    "Under 2½ rounds +350 +350",
    "Fight goes to decision -259",
    "Fight doesn't go to decision +207",
    "Fight ends in submission in round 1 +2500",
    "Wang Cong wins by TKO/KO in round 3 +3500",
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  alignScrapedOdds,
  BoardMarkupError,
  closingLine,
  methodOddsForFight,
  parseEventMethodOddsHtml,
  upcomingEventBoards,
  type ScrapedOdds,
} from "./odds.ts";

const odds: ScrapedOdds = {
  f1: { open: "+525", close: "+700", history: ["+525", "+400", "+700"] },
  f2: { open: "-700", close: "-549", history: ["-700", "-1250", "-549"] },
  sourceUrl: "https://www.bestfightodds.com/fighters/umar-nurmagomedov-9365",
};

test("odds remain attached to fighters when the event page swaps corners", () => {
  const requested = { f1_name: "Song Yadong", f2_name: "Umar Nurmagomedov" };
  assert.equal(alignScrapedOdds(odds, requested, requested), odds);

  const aligned = alignScrapedOdds(odds, requested, {
    f1_name: "Umar Nurmagomedov",
    f2_name: "Song Yadong",
  });
  assert.equal(aligned.f1.close, "-549");
  assert.equal(aligned.f2.close, "+700");
  assert.deepEqual(aligned.f1.history, odds.f2.history);
  assert.deepEqual(aligned.f2.history, odds.f1.history);
});

test("odds are discarded when the matchup changed instead of being misassigned", () => {
  assert.throws(
    () => alignScrapedOdds(odds,
      { f1_name: "Song Yadong", f2_name: "Umar Nurmagomedov" },
      { f1_name: "Song Yadong", f2_name: "Replacement Fighter" }),
    /fight changed while odds were loading/,
  );
});

const methodHtml = `
  <table class="odds-table">
    <thead><tr><th></th><th data-b="21">FanDuel</th><th data-b="22">DraftKings</th><th>Props</th></tr></thead>
    <tbody>
      <tr><th><a href="/cnadm/matchups/42">42</a><a href="/fighters/alex-pereira-1">Alex Pereira</a></th></tr>
      <tr><th><a href="/fighters/jamahal-hill-2">Jamahal Hill</a></th></tr>
      <tr><th>Pereira wins by TKO/KO</th><td data-li="[21,1,42,8,1]"><span>+115</span><span class="aru arage-1">▲</span></td><td data-li="[22,1,42,8,1]"><span>+110</span><span class="ard arage-2">▼</span></td></tr>
      <tr><th>Hill wins by TKO/KO</th><td data-li="[21,1,42,8,2]"><span>+195</span></td></tr>
      <tr><th>Pereira wins by submission</th><td data-li="[21,1,42,9,1]"><span>+2000</span></td></tr>
      <tr><th>Hill wins by submission</th><td data-li="[21,1,42,9,2]"><span>+1500</span></td></tr>
      <tr><th>Pereira wins by decision</th><td data-li="[21,1,42,11,1]"><span>+800</span></td></tr>
      <tr><th>Hill wins by decision</th><td data-li="[21,1,42,11,2]"><span>+650</span></td></tr>
      <tr><th>Fight goes to decision</th><td data-li="[21,1,42,3,1]"><span>+360</span></td></tr>
      <tr><th>Over 2½ rounds</th><td data-li="[21,1,42,2,1]"><span>-110</span></td></tr>
      <tr><th>Malformed</th><td data-li="[21,1,42,2,1]"><span>1.91</span></td></tr>
    </tbody>
  </table>
`;

test("method prices retain named-book provenance and align to exact UFCStats fighters", () => {
  const board = parseEventMethodOddsHtml(methodHtml, "https://www.bestfightodds.com/events/ufc-300-3205");
  const odds = methodOddsForFight(board, "Jamahal Hill", "Alex Pereira");
  assert.ok(odds);
  assert.equal(odds.f1.ko?.prices[0].line, "+195");
  assert.equal(odds.f2.ko?.prices[0].bookmaker, "FanDuel");
  assert.equal(odds.f2.ko?.prices[1].bookmaker, "DraftKings");
  assert.equal(odds.f2.ko?.prices[0].move, "up");
  assert.equal(odds.f2.ko?.prices[1].move, "down");
  assert.equal(odds.f1.ko?.prices[0].move, undefined);
  assert.equal(odds.f1.decision?.prices[0].line, "+650");
  assert.equal(odds.f2.decision?.prices[0].line, "+800");
  assert.equal(odds.additional[0].label, "Fight goes to decision");
  assert.equal(odds.additional.length, 2);
});

// BestFightOdds since October 2026: the matchup id is on the first corner's
// row header, with no /cnadm/ link (UFC Doha, 2026-11-21, trimmed).
const currentBoard = (header: (id: number) => string) => `
  <table class="odds-table">
    <thead><tr><th></th><th data-b="21">FanDuel</th><th data-b="25">BetMGM</th><th>Props</th></tr></thead>
    <tbody>
      <tr ><th ${header(45574)}><a href="/fighters/jiri-prochazka-6058"><span class="t-b-fcc">Jiri Prochazka</span></a></th><td class="but-sg" data-li="[21,1,45574]"><span>+132</span></td><td class="but-sg" data-li="[25,1,45574]"><span>+130</span></td><td class="button-cell but-si" data-li="[1,45574]"></td><td class="prop-cell prop-cell-exp" data-mu="45574">92</td></tr>
      <tr ><th scope="row"><a href="/fighters/navajo-stirling-18344"><span class="t-b-fcc">Navajo Stirling</span></a></th><td class="but-sg" data-li="[21,2,45574]"><span>-170</span></td><td class="but-sg" data-li="[25,2,45574]"><span>-162</span></td><td class="button-cell but-si" data-li="[2,45574]"></td><td class="prop-cell prop-cell-exp" data-mu="45574">92</td></tr>
      <tr class="pr"><th scope="row">Over 1&#189; rounds</th><td class="but-sgp" data-li="[21,1,45574,32,0]"><span>-152</span></td><td class="but-sgp" data-li="[25,1,45574,32,0]"><span>-167</span></td><td class="button-cell but-sip" data-li="[1,45574,32,0]"></td></tr>
      <tr class="pr"><th scope="row">Prochazka wins by TKO/KO</th><td class="but-sgp" data-li="[21,1,45574,8,1]"><span>+250</span></td><td></td><td class="button-cell but-sip" data-li="[1,45574,8,1]"></td></tr>
      <tr ><th ${header(45575)}><a href="/fighters/first-one-1"><span class="t-b-fcc">First One</span></a></th><td class="but-sg" data-li="[21,1,45575]"><span>-200</span></td><td class="button-cell but-si" data-li="[1,45575]"></td></tr>
      <tr ><th scope="row"><a href="/fighters/second-two-2"><span class="t-b-fcc">Second Two</span></a></th><td class="but-sg" data-li="[21,2,45575]"><span>+170</span></td><td class="button-cell but-si" data-li="[2,45575]"></td></tr>
      <tr class="pr"><th scope="row">Two wins by submission</th><td class="but-sgp" data-li="[21,1,45575,9,2]"><span>+900</span></td><td class="button-cell but-sip" data-li="[1,45575,9,2]"></td></tr>
    </tbody>
  </table>`;

test("the current board markup keys each bout by its row header, and its props stay with that bout", () => {
  for (const header of [(id: number) => `scope="row" data-admin-matchup="${id}"`, () => `scope="row"`]) {
    const board = parseEventMethodOddsHtml(currentBoard(header), "https://www.bestfightodds.com/events/ufc-doha-4440");
    assert.deepEqual(board.map((bout) => [bout.f1Name, bout.f2Name]), [["Jiri Prochazka", "Navajo Stirling"], ["First One", "Second Two"]]);
    const odds = methodOddsForFight(board, "Navajo Stirling", "Jiri Prochazka");
    assert.ok(odds);
    assert.deepEqual(odds.moneylineKeys, { f1: [2, 45574], f2: [1, 45574] });
    assert.equal(odds.f2.ko?.prices[0].line, "+250");
    assert.equal(odds.f1.ko, undefined);
    assert.deepEqual(odds.additional.map((quote) => quote.prices.map((price) => price.line)), [["-152", "-167"]]);
    assert.equal(methodOddsForFight(board, "First One", "Second Two")?.f2.submission?.prices[0].line, "+900");
  }
});

test("a board whose priced bouts can't be read fails loudly; one with no prices yet reads as empty", () => {
  const url = "https://www.bestfightodds.com/events/ufc-doha-4440";
  // Fighter links in a new shape: priced first corners tie to no fighter.
  assert.throws(() => parseEventMethodOddsHtml(currentBoard(() => `scope="row"`).replaceAll('href="/fighters/', 'href="/athletes/'), url), BoardMarkupError);
  // One bout unreadable is still a broken board, not a shorter one.
  assert.throws(() => parseEventMethodOddsHtml(currentBoard(() => `scope="row"`).replace('href="/fighters/first-one-1"', 'href="/athletes/first-one-1"'), url), BoardMarkupError);
  // A spacer between a bout's corners leaves its first corner without a second.
  assert.throws(() => parseEventMethodOddsHtml(currentBoard((id) => `scope="row" data-admin-matchup="${id}"`)
    .replace('<tr ><th scope="row"><a href="/fighters/navajo-stirling', '<tr><td></td></tr><tr ><th scope="row"><a href="/fighters/navajo-stirling'), url), BoardMarkupError);
  // A blank or malformed id falls through to the chart key.
  assert.equal(parseEventMethodOddsHtml(currentBoard(() => `scope="row" data-admin-matchup=""`), url).length, 2);
  const unpriced = currentBoard(() => `scope="row"`).replaceAll(/ data-li="[^"]*"/g, "");
  assert.deepEqual(parseEventMethodOddsHtml(unpriced, url), []);
  assert.deepEqual(parseEventMethodOddsHtml("<html>No table</html>", "https://www.bestfightodds.com/events/x"), []);
});

test("method odds reject a merely similar fighter pair", () => {
  const board = parseEventMethodOddsHtml(methodHtml, "https://www.bestfightodds.com/events/ufc-300-3205");
  assert.equal(methodOddsForFight(board, "Michel Pereira", "Jamahal Hill"), null);
  assert.equal(methodOddsForFight(board, "Michel Pereira", "James Hill"), null);
});

test("one exact name plus a spelling variant of the opponent still aligns corners", () => {
  const board = parseEventMethodOddsHtml(methodHtml.replace("Jamahal Hill</a>", "Jam Hill</a>"), "https://www.bestfightodds.com/events/test");
  assert.equal(methodOddsForFight(board, "Jamahal Hill", "Alex Pereira")?.f1.ko?.prices[0].line, "+195");
  const mononym = parseEventMethodOddsHtml(methodHtml.replace("Jamahal Hill</a>", "Sumudaerji Sumudaerji</a>").replaceAll("Hill wins", "Sumudaerji wins"), "https://www.bestfightodds.com/events/test");
  assert.equal(methodOddsForFight(mononym, "Alex Pereira", "Sumudaerji")?.f2.ko?.prices[0].line, "+195");
});

test("a typo in each name still matches when both agree on surname and initial", () => {
  const html = methodHtml
    .replace("Alex Pereira</a>", "Elizeu Zaleski</a>").replaceAll("Pereira wins", "Zaleski wins")
    .replace("Jamahal Hill</a>", "Luigi Vandramini</a>").replaceAll("Hill wins", "Vandramini wins");
  const board = parseEventMethodOddsHtml(html, "https://www.bestfightodds.com/events/ufc-fight-night-137-1544");
  assert.equal(methodOddsForFight(board, "Luigi Vendramini", "Elizeu Zaleski dos Santos")?.f1.ko?.prices[0].line, "+195");
  assert.equal(methodOddsForFight(board, "Luigi Vendramini", "Edson Barboza"), null);
});

test("a ring name matches through the fighter's career-record alias", () => {
  // UFCStats: "Patricio Pitbull" vs "Dooho Choi"; the source: "Patricio Freire" vs "Doo Ho Choi".
  const html = methodHtml
    .replace("Alex Pereira</a>", "Patricio Freire</a>").replaceAll("Pereira wins", "Freire wins")
    .replace("Jamahal Hill</a>", "Doo Ho Choi</a>").replaceAll("Hill wins", "Choi wins");
  const board = parseEventMethodOddsHtml(html, "https://www.bestfightodds.com/events/ufc-331-4302");
  assert.equal(methodOddsForFight(board, "Patricio Pitbull", "Dooho Choi"), null, "the ring name alone is not an identity");
  const odds = methodOddsForFight(board, "Dooho Choi", ["Patricio Pitbull", "Patricio Freire"]);
  assert.equal(odds?.f1.ko?.prices[0].line, "+195");
  assert.equal(odds?.f2.ko?.prices[0].line, "+115");
  assert.equal(methodOddsForFight(board, "Dooho Choi", ["Patricio Pitbull", "Maicon Patricio"]), null);

  // UFCStats: "Michael Aswell Jr." vs "JooSang Yoo"; the source drops the suffix and spaces the name.
  const suffixed = parseEventMethodOddsHtml(methodHtml
    .replace("Alex Pereira</a>", "Michael Aswell</a>").replaceAll("Pereira wins", "Aswell wins")
    .replace("Jamahal Hill</a>", "Joo Sang Yoo</a>").replaceAll("Hill wins", "Yoo wins"), "https://www.bestfightodds.com/events/test");
  assert.equal(methodOddsForFight(suffixed, ["JooSang Yoo", "Joo Sang Yoo"], ["Michael Aswell Jr.", "Michael Aswell"])?.f2.ko?.prices[0].line, "+115");
});

test("method odds reject cells attached to another matchup and invalid American prices", () => {
  const html = methodHtml.replaceAll("[21,1,42,8,1]", "[21,1,99,8,1]").replaceAll("+110", "+0");
  const board = parseEventMethodOddsHtml(html, "https://www.bestfightodds.com/events/test");
  assert.equal(board[0].f1.ko, undefined);
  assert.equal(board[0].f2.ko?.prices[0].line, "+195");
});

test("markets the card does not display are not kept", () => {
  const labels = ["Pereira wins in round 2", "Hill wins by split/majority decision", "Fight won't start round 3", "Pereira wins inside distance"];
  for (const label of labels) {
    const board = parseEventMethodOddsHtml(methodHtml.replace("Over 2½ rounds", label), "https://www.bestfightodds.com/events/test");
    assert.ok(!board[0].additional.some(q => q.label === label));
  }
});

test("fighter method by round is kept only for a fighter on this matchup", () => {
  const kept = parseEventMethodOddsHtml(methodHtml.replace("Over 2½ rounds", "Pereira wins by submission in round 2"), "https://www.bestfightodds.com/events/test");
  assert.ok(kept[0].additional.some(q => q.label === "Pereira wins by submission in round 2"));
  const other = parseEventMethodOddsHtml(methodHtml.replace("Over 2½ rounds", "Jones wins by submission in round 2"), "https://www.bestfightodds.com/events/test");
  assert.ok(!other[0].additional.some(q => q.label === "Jones wins by submission in round 2"));
});

test("aggregate KO and submission by round markets are retained", () => {
  const labels = ["Fight ends in TKO/KO/DQ in round 1", "Fight ends in submission in round 3"];
  for (const label of labels) {
    const board = parseEventMethodOddsHtml(methodHtml.replace("Over 2½ rounds", label), "https://www.bestfightodds.com/events/test");
    assert.ok(board[0].additional.some(q => q.label === label));
  }
});

test("under markets use the negative outcome key without being discarded", () => {
  const html = methodHtml.replace("Over 2½ rounds", "Under 2½ rounds").replaceAll("[21,1,42,2,1]", "[21,2,42,33,0]");
  const board = parseEventMethodOddsHtml(html, "https://www.bestfightodds.com/events/test");
  assert.equal(board[0].additional.find(q => q.label === "Under 2½ rounds")?.prices[0].line, "-110");
});

test("rows without a surviving book column keep a verified mean-chart key instead", () => {
  const html = methodHtml
    .replace('<td data-li="[21,1,42,8,1]"><span>+115</span><span class="aru arage-1">▲</span></td><td data-li="[22,1,42,8,1]"><span>+110</span><span class="ard arage-2">▼</span></td>', '<td></td><td class="button-cell but-sip" data-li="[1,42,8,1]"></td>')
    .replace('<td data-li="[21,1,42,8,2]"><span>+195</span></td>', '<td class="button-cell but-sip" data-li="[1,42,8,1]"></td>')
    .replace('<td data-li="[21,1,42,2,1]"><span>-110</span></td>', '<td class="button-cell but-sip" data-li="[2,42,33,0]"></td>');
  const [matchup] = parseEventMethodOddsHtml(html, "https://www.bestfightodds.com/events/test");
  assert.deepEqual(matchup.f1.ko, { label: "Pereira wins by TKO/KO", prices: [], meanKey: [1, 42, 8, 1] });
  // A key naming the other corner is never attached to this fighter.
  assert.equal(matchup.f2.ko, undefined);
  assert.deepEqual(matchup.additional.find(q => q.label === "Over 2½ rounds")?.meanKey, [2, 42, 33, 0]);
});

test("method cells must agree with both the stated method and fighter corner", () => {
  const html = methodHtml.replaceAll("[21,1,42,8,1]", "[21,1,42,8,2]").replaceAll("[22,1,42,8,1]", "[22,1,42,9,1]");
  const board = parseEventMethodOddsHtml(html, "https://www.bestfightodds.com/events/test");
  assert.equal(board[0].f1.ko, undefined);
});

test("board moneyline chart keys follow the fighter when corners are swapped", () => {
  const html = methodHtml
    .replace('<a href="/fighters/alex-pereira-1">Alex Pereira</a></th>', '<a href="/fighters/alex-pereira-1">Alex Pereira</a></th><td class="but-si" data-li="[1,42]"></td>')
    .replace('<a href="/fighters/jamahal-hill-2">Jamahal Hill</a></th>', '<a href="/fighters/jamahal-hill-2">Jamahal Hill</a></th><td class="but-si" data-li="[2,42]"></td>');
  const board = parseEventMethodOddsHtml(html, "https://www.bestfightodds.com/events/test");
  assert.deepEqual(methodOddsForFight(board, "Alex Pereira", "Jamahal Hill")?.moneylineKeys, { f1: [1, 42], f2: [2, 42] });
  assert.deepEqual(methodOddsForFight(board, "Jamahal Hill", "Alex Pereira")?.moneylineKeys, { f1: [2, 42], f2: [1, 42] });
  // A key for another matchup is never used.
  const other = parseEventMethodOddsHtml(html.replace("[2,42]", "[2,99]"), "https://www.bestfightodds.com/events/test");
  assert.equal(other[0].moneylineKeys, undefined);
});

test("an exact opponent carries the source's own typo of the other name", () => {
  const board = (a: string, b: string) => parseEventMethodOddsHtml(methodHtml
    .replace("Alex Pereira</a>", `${a}</a>`).replaceAll("Pereira wins", `${a.split(" ").at(-1)} wins`)
    .replace("Jamahal Hill</a>", `${b}</a>`).replaceAll("Hill wins", `${b.split(" ").at(-1)} wins`), "https://www.bestfightodds.com/events/test");
  assert.ok(methodOddsForFight(board("Bogdan Grad", "Dennis Buzukia"), "Bogdan Grad", "Dennis Buzukja"));
  assert.ok(methodOddsForFight(board("Dustin Jacoby", "Muhammad Said"), "Muhammad Saidov", "Dustin Jacoby"));
  assert.ok(methodOddsForFight(board("Damien Anderson", "Erza Elliot"), "Ezra Elliott", "Damien Anderson"));
  assert.ok(methodOddsForFight(board("Carlos Leal Miranda", "Muslim Salikhov"), "Muslim Salikhov", "Carlos Leal"));
  assert.ok(methodOddsForFight(board("Dong Hoon Choi", "Kiru Sahota"), "DongHun Choi", "Kiru Sahota"));
  assert.equal(methodOddsForFight(board("Charles Johnson", "Jose Ochoa"), "Charles Johnson", "Eduardo Chapolin"), null, "a replacement opponent is a different bout");
  assert.equal(methodOddsForFight(board("Alex Perez", "Michael Johnson"), "Alex Perez", "Charles Johnson"), null);
});

test("a close variant beside the source's typo of the opponent still matches", () => {
  const board = (a: string, b: string) => parseEventMethodOddsHtml(methodHtml
    .replace("Alex Pereira</a>", `${a}</a>`).replaceAll("Pereira wins", `${a.split(" ").at(-1)} wins`)
    .replace("Jamahal Hill</a>", `${b}</a>`).replaceAll("Hill wins", `${b.split(" ").at(-1)} wins`), "https://www.bestfightodds.com/events/test");
  assert.ok(methodOddsForFight(board("Hayisaer Maheshate", "Viacheslav Borschev"), ["Viacheslav Borshchev"], ["Maheshate", "Maheshate Hayisaer"]));
  // A surname or first name alone never pins a corner, however the other matches.
  assert.equal(methodOddsForFight(board("Alex Volkanovski", "Alexsandre Topuria"), "Ilia Topuria", "Alexander Volkanovski"), null);
  assert.equal(methodOddsForFight(board("C.J. Vergara", "Daniel da Silva"), "CJ Vergara", "Daniel Lacerda"), null);
});

test("the closing line is the middle of the closing range, in win probability", () => {
  // Topuria vs Gaethje: tops of the two ranges add up to 93%, middles to 104%.
  assert.equal(closingLine(["-500", "-500", "-250"]), "-342");
  assert.equal(closingLine(["+385", "+210", "+360"]), "+270");
  assert.equal(closingLine(["+220", "+175", "+220"]), "+196");
  // A range across even money lands on the favourite's side of it.
  assert.equal(closingLine(["-110", "-140", "+110"]), "-113");
  // No range: the one price there is.
  assert.equal(closingLine(["-150", "-150"]), "-150");
  assert.equal(closingLine(["+200"]), "+200");
  assert.equal(closingLine([]), null);
});

test("front-page boards are dated to the nearest year, including a card split over two days", () => {
  const html = `<a href="/events/ufc-4380"><h1>UFC Odds</h1></a><span class="table-header-date">October 3rd</span>
    <a href="/events/ufc-332-4330"><h1>UFC 332</h1></a><span class="table-header-date">October 4th</span>
    <a href="/events/ufc-340-1"><h1>UFC 340</h1></a><span class="table-header-date">January 2nd</span>`;
  assert.deepEqual(upcomingEventBoards(html, new Date("2026-12-20T12:00:00Z")), [
    ["2026-10-03", "https://www.bestfightodds.com/events/ufc-4380"],
    ["2026-10-04", "https://www.bestfightodds.com/events/ufc-332-4330"],
    ["2027-01-02", "https://www.bestfightodds.com/events/ufc-340-1"],
  ]);
});

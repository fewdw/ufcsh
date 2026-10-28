import test from "node:test";
import assert from "node:assert/strict";
import { money, payoutPost, placeName, postForCard, readPurses, rowName, wikipediaBonuses, wikipediaPurses, type PayBout } from "./payouts.ts";

const ufc229: PayBout[] = [
  { id: "a", f1: "Khabib Nurmagomedov", f2: "Conor McGregor", f1Outcome: "win", f2Outcome: "loss" },
  { id: "b", f1: "Tony Ferguson", f2: "Anthony Pettis", f1Outcome: "win", f2Outcome: "loss" },
  { id: "c", f1: "Kevin Aguilar", f2: "Rick Glenn", f1Outcome: "win", f2Outcome: "loss" },
  { id: "d", f1: "Cristiane Justino", f2: "Yana Kunitskaya", f1Outcome: "win", f2Outcome: "loss" },
];

const article = `{{Infobox MMA event|name=UFC 229}}
==Reported payout==
The following is the reported payout to the fighters as reported to the [[Nevada Athletic Commission|Nevada State Athletic Commission]]. It does not include sponsor money and also does not include the UFC's traditional "fight night" bonuses. The total disclosed payout for the event was $6,636,000.<ref name="payouts">{{Cite news|url=https://mmajunkie.com/2018/10/ufc-229-salaries|title=UFC 229 salaries|publisher=mmajunkie.com|date=2018-10-07}}</ref>

* '''Khabib Nurmagomedov''': $2,000,000 (no win bonus) def. Conor McGregor: $3,000,000
* '''Tony Ferguson''': $250,000 (includes $50,000 win bonus) def. Anthony Pettis: $100,000
*'''Kevin Aguilar:''' $25,000 ($10,000 win bonus) def. Rick Glenn: $20,000**
* '''Cris Cyborg:''' $500,000 (no win bonus) def. Yana Kunitskaya: $100,000

<nowiki>**</nowiki> ''Rick Glenn was fined $5,000, 20 percent of his purse for failing to make the required weight. That money was issued to Aguilar, an NSAC official confirmed''<ref name="payouts"/><br />

==See also==`;

test("a Reported payout section gives each corner's purse as written, with its commission, caveat, footnotes and citation", () => {
  const read = wikipediaPurses(article, ufc229)!;
  assert.equal(read.commission, "Nevada State Athletic Commission");
  assert.match(read.caveat!, /does not include sponsor money/);
  assert.deepEqual(read.citation, { label: "MMA Junkie", url: "https://mmajunkie.com/2018/10/ufc-229-salaries" });
  assert.deepEqual(read.purses.get("a"), {
    f1: { total: 2_000_000, show: 2_000_000, win: 0, note: null },
    f2: { total: 3_000_000, show: null, win: null, note: null },
  });
  // A total that includes a win bonus never has show money derived from it:
  // a fine moved from the opponent can be inside it.
  assert.deepEqual(read.purses.get("b")?.f1, { total: 250_000, show: null, win: 50_000, note: null });
  assert.match(read.purses.get("c")!.f2!.note!, /^Rick Glenn was fined \$5,000/);
  // One corner known on an "A def. B" line places the other, under any name.
  assert.equal(read.purses.get("d")?.f1?.total, 500_000);
  assert.equal(read.purses.get("d")?.f2?.total, 100_000);
  assert.deepEqual(read.unread, []);
});

test("the 2006 payroll is one line of names, each placed on its own bout", () => {
  const read = wikipediaPurses(`==Reported payout==
'''Chuck Liddell:''' $250,000   '''Randy Couture:''' $225,000   '''Frank Mir:''' $26,000
==Next==`, [
    { id: "a", f1: "Chuck Liddell", f2: "Randy Couture" },
    { id: "b", f1: "Frank Mir", f2: "Dan Christison" },
  ])!;
  assert.equal(read.purses.get("a")?.f1?.total, 250_000);
  assert.equal(read.purses.get("a")?.f2?.total, 225_000);
  assert.equal(read.purses.get("b")?.f1?.total, 26_000);
  assert.equal(read.purses.get("b")?.f2, undefined);
  // "Disclosed Fighter Payroll: $539,000" is a total, not a fighter.
  assert.equal(rowName("Disclosed Fighter Payroll:"), null);
});

test("a bout cancelled on the night is a row to report, not a purse to place", () => {
  const read = readPurses(["Stefan Struve: $80,000 (includes $40,000 win bonus) vs. Matt Mitrione: $60,000 (includes $30,000 win bonus) ^"], ufc229);
  assert.equal(read.purses.size, 0);
  assert.equal(read.unread.length, 2);
});

test("MMA Payout's salary formats read the same purses, and a typo is never guessed", () => {
  const card: PayBout[] = [
    { id: "a", f1: "Jiri Prochazka", f2: "Jamahal Hill", f1Outcome: "win", f2Outcome: "loss" },
    { id: "b", f1: "Alexa Grasso", f2: "Maycee Barber", f1Outcome: "win", f2Outcome: "loss" },
    { id: "c", f1: "Puja Tomar", f2: "Rayanne dos Santos", f1Outcome: "win", f2Outcome: "loss" },
    { id: "d", f1: "Henry Cejudo", f2: "Merab Dvalishvili", f1Outcome: "loss", f2Outcome: "win" },
    { id: "e", f1: "Lance Gibson Jr.", f2: "Chase Hooper", f1Outcome: "win", f2Outcome: "loss" },
  ];
  const read = readPurses([
    "Jiri Prochazka: $200,000 + $50,000 win bonus – Jamahal Hill: $200,000",
    "Alexa Grasso $260K total ($130K/$130K) def Maycee Barber $85K",
    "Puja Tomar $10,000 show/$10,00 win",
    "Gleaning from the sheet, top earners include Henry Cejudo ($150,000 to show/$150,000 to win), Merab Dvalishvili ($105,000 to show/$105,000 to win).",
    "Lance Gibson, Jr. $24K ($12K/$12K) def Chase Hooper $90K",
    "Joe Pyfer, who stopped Adesanya, earned $275,000 and with the win earned $125,000 for a total of $400,00.",
  ], card);
  assert.deepEqual(read.purses.get("a")?.f1, { total: 250_000, show: 200_000, win: 50_000, note: null });
  assert.equal(read.purses.get("a")?.f2?.total, 200_000);
  assert.deepEqual(read.purses.get("b")?.f1, { total: 260_000, show: 130_000, win: 130_000, note: null });
  assert.equal(read.purses.get("b")?.f2?.total, 85_000);
  assert.equal(read.purses.get("c"), undefined);
  assert.deepEqual(read.unread, ["Puja Tomar $10,000 show/$10,00 win"]);
  // A contract's "to win" figure was not earned by the fighter who lost.
  assert.deepEqual(read.purses.get("d")?.f1, { total: 150_000, show: 150_000, win: 0, note: null });
  assert.deepEqual(read.purses.get("d")?.f2, { total: 210_000, show: 105_000, win: 105_000, note: null });
  assert.equal(read.purses.get("e")?.f1?.total, 24_000);
});

test("amounts are whole dollars or nothing", () => {
  assert.equal(money("2,000,000"), 2_000_000);
  assert.equal(money("130", "K"), 130_000);
  assert.equal(money("1.5", "million"), 1_500_000);
  assert.equal(money("10,000."), 10_000);
  assert.equal(money("10,00"), null);
  assert.equal(money("400,00"), null);
  assert.equal(money("500"), null);
});

test("names are placed by full name, either order, a unique surname or a former name, and never by a guess between two", () => {
  const card: PayBout[] = [
    { id: "a", f1: "Doo Ho Choi", f2: "Patricio Pitbull" },
    { id: "b", f1: "Tecia Pennington", f2: "Diego Ferreira", f1Aliases: ["Tecia Torres"] },
    { id: "c", f1: "Brunno Ferreira", f2: "Jose Silva" },
    { id: "d", f1: "Rafael Silva", f2: "Zach Reese" },
  ];
  assert.equal(placeName("Choi Doo-ho", card)?.bout.id, "a");
  assert.equal(placeName("Tecia Torres", card)?.bout.id, "b");
  assert.deepEqual(placeName("Carlos Diego Ferreira", card)?.corner, "f2");
  assert.equal(placeName("Zachary Reese", card)?.bout.id, "d");
  // Two Silvas and two Ferreiras: a surname alone settles nothing.
  assert.equal(placeName("Bruno Silva", card), null);
});

const bonusArticle = (body: string) => `==Bonus awards==\n${body}\n==See also==`;

test("bonus awards take the section's one figure, a line's own figure, and leave anyone a note names without one", () => {
  const plain = wikipediaBonuses(bonusArticle(`The following fighters received $50,000 bonuses.<ref>{{cite web|url=https://example.test/bonuses|title=x|website=MMA Junkie}}</ref>
*'''Fight of the Night: Pedro Munhoz vs. Cody Garbrandt'''
*'''Performance of the Night: Johnny Walker''' and '''Diego Sanchez'''`))!;
  assert.deepEqual(plain.awards.map((a) => [a.kind, a.names[0], a.amount]), [
    ["fotn", "Pedro Munhoz", 50_000], ["fotn", "Cody Garbrandt", 50_000],
    ["potn", "Johnny Walker", 50_000], ["potn", "Diego Sanchez", 50_000],
  ]);
  const lines = wikipediaBonuses(bonusArticle(`The following fighters were awarded $50,000 bonuses:
*'''Fight of the Night ($100,000): Robert Whittaker''' (Yoel Romero was unable to receive his share of the bonus money due to missing weight).
*'''Performance of the Night ($25,000): Ovince Saint Preux''' and '''Ricardo Ramos '''
*'''Submission of the Night: Mark Bocek and Jim Miller''' (split, $50,000 each)`))!;
  assert.deepEqual(lines.awards.map((a) => [a.names[0], a.amount]), [
    ["Robert Whittaker", 100_000], ["Ovince Saint Preux", 25_000], ["Ricardo Ramos", 25_000], ["Mark Bocek", 50_000], ["Jim Miller", 50_000],
  ]);
  const forfeit = wikipediaBonuses(bonusArticle(`The following fighters received $50,000 bonuses.
*'''Fight of the Night: Gregor Gillespie vs. Carlos Diego Ferreira'''{{ref|note1|1}}
*'''Performance of the Night: Alex Morono''' and ''' Carlston Harris'''
:{{note|note1}} {{small| 1. Ferreira was disqualified for the Fight of the Night bonus due to missing weight, as a result his award was given to Gillespie.}}`))!;
  assert.deepEqual(forfeit.awards.map((a) => [a.names[0], a.amount]), [
    ["Gregor Gillespie", null], ["Carlos Diego Ferreira", null], ["Alex Morono", 50_000], ["Carlston Harris", 50_000],
  ]);
  assert.match(forfeit.awards[0].note!, /given to Gillespie/);
});

test("2026's finish bonus is read with its exceptions, and older wordings of the one figure still count", () => {
  const finish = wikipediaBonuses(bonusArticle(`The following fighters received $100,000 bonuses. The other finishes received $25,000 additional bonuses, with the exception of Alex Perez, as he missed weight for his bout.
*'''Fight of the Night: Alexander Volkanovski vs. Diego Lopes'''
*'''Performance of the Night: Maurício Ruffy''' and '''Quillan Salkilld'''`))!;
  assert.deepEqual(finish.finish, { amount: 25_000, except: ["Alex Perez"] });
  assert.equal(finish.awards[0].amount, 100_000);
  const given = wikipediaBonuses(bonusArticle(`The following fighters received $100,000 bonuses. $25,000 was given to Joselyne Edwards for the additional finish bonus.
*'''Performance of the Night: Sean Strickland'''`))!;
  assert.deepEqual(given.awards.map((a) => [a.kind, a.names[0], a.amount]), [["potn", "Sean Strickland", 100_000], ["finish", "Joselyne Edwards", 25_000]]);
  assert.equal(given.finish, null);
  for (const intro of ["The following fighters received $65,000.", "The following fighters received bonuses: $100,000.", "The following fighters received two $50,000 bonuses totaling $100,000.", "The following fighters earned $50,000 bonuses:"]) {
    const read = wikipediaBonuses(bonusArticle(`${intro}\n*'''Performance of the Night: Niko Price'''`))!;
    assert.notEqual(read.awards[0].amount, null, intro);
  }
});

test("a salary post's table is read row by row, without its photo captions or struck-through bouts", () => {
  const post = payoutPost("2024-06-19T09:00:00", "https://mmapayout.com/2024/06/19/ufc-on-espn-57-salaries/", "UFC on ESPN 57 salaries",
    `<p>The salaries from UFC on ESPN 57 were disclosed last week.</p><figure><img src="x.jpg"/><figcaption>Dominick Reyes $1,000,000 at weigh-ins</figcaption></figure>
<figure class="wp-block-table"><table><tbody><tr><td>Dominick Reyes</td><td>$125,000 show/$125,000 win</td><td>Dustin Jacoby</td><td>$100,000</td></tr>
<tr><td><s>Michael Johnson</s></td><td><s>$90,000</s></td></tr></tbody></table></figure>`)!;
  const card: PayBout[] = [
    { id: "a", f1: "Dominick Reyes", f2: "Dustin Jacoby", f1Outcome: "win", f2Outcome: "loss" },
    { id: "b", f1: "Charles Johnson", f2: "Ramazan Temirov" },
  ];
  assert.equal(postForCard([post], "2024-06-15", card), post);
  assert.equal(postForCard([post], "2024-03-01", card), null);
  const read = readPurses(post.text.split("\n"), card);
  assert.deepEqual(read.purses.get("a"), {
    f1: { total: 250_000, show: 125_000, win: 125_000, note: null },
    f2: { total: 100_000, show: null, win: null, note: null },
  });
  assert.equal(read.purses.get("b"), undefined);
  // The only Johnson on the card is Charles: "Michael Johnson" is not him.
  assert.equal(placeName("Michael Johnson", card), null);
  assert.equal(payoutPost("2026-01-01", "x", "UFC 311 Payout Perspective", "<p>x</p>"), null);
  assert.equal(payoutPost("2026-01-01", "x", "UFC 327 Uniform Compliance Pay", "<p>x</p>"), null);
});

test("MMA Payout's other wordings: paid sums, contracts by result, and a winner's lone amount left unread", () => {
  const card: PayBout[] = [
    { id: "a", f1: "Jorge Masvidal", f2: "Ben Askren", f1Outcome: "win", f2Outcome: "loss" },
    { id: "b", f1: "Antonio Rodrigo Nogueira", f2: "Randy Couture", f1Outcome: "win", f2Outcome: "loss" },
    { id: "c", f1: "Michel Pereira", f2: "Andre Fialho", f1Outcome: "win", f2Outcome: "loss" },
    { id: "d", f1: "Brandon Moreno", f2: "Deiveson Figueiredo", f1Outcome: "loss", f2Outcome: "win" },
    { id: "e", f1: "Cody Garbrandt", f2: "Raphael Assuncao", f1Outcome: "win", f2Outcome: "loss" },
  ];
  const read = readPurses([
    "Ben Askren($210,000; $160,000 win bonus) vs. Jorge Masvidal ($100,000; $100,000 win bonus)",
    "Antonio Nogueira ($250,000 + $150,000 = $400,000) d. Randy Couture ($250,000)",
    "Michel Pereira $50,000 ($50,000 win)",
    "Brandon Moreno: $100,000",
    "Deiveson Figueiredo: $210,000",
    "Cody Garbrandt: $130K/$130K *$50K bonus",
  ], card, new Map(), "unclear");
  assert.deepEqual(read.purses.get("a"), {
    f1: { total: 200_000, show: 100_000, win: 100_000, note: null },
    f2: { total: 210_000, show: 210_000, win: 0, note: null },
  });
  assert.deepEqual(read.purses.get("b")?.f1, { total: 400_000, show: 250_000, win: 150_000, note: null });
  assert.equal(read.purses.get("c")?.f1?.total, 100_000);
  assert.equal(read.purses.get("d")?.f1?.total, 100_000);
  // Did Figueiredo's $210,000 hold his win bonus? The post doesn't say.
  assert.equal(read.purses.get("d")?.f2, undefined);
  assert.deepEqual([...read.unclear.keys()], ["d:f2"]);
  assert.equal(read.purses.get("e")?.f1?.total, 260_000);
  // Wikipedia's "($X win bonus)" is always inside the total.
  assert.equal(readPurses(["Jake Shields: $150,000 ($70,000 win bonus) def. Martin Kampmann: $27,000"], [{ id: "x", f1: "Jake Shields", f2: "Martin Kampmann", f1Outcome: "win" }]).purses.get("x")?.f1?.total, 150_000);
});

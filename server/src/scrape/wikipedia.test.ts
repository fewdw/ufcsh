import test from "node:test";
import assert from "node:assert/strict";
import { boutChanges, catchweights, eventSection, infoboxDate, namesCard, plainText, recordCatchweight, rosterChanges, samePlace, weightMisses } from "./wikipedia.ts";

const article = (background: string, results = "") =>
  `{{Infobox MMA event\n| date = {{start date|2024|01|20}}\n}}\n==Background==\n${background}\n==Results==\n${results}`;

test("infobox dates read both the template and written forms", () => {
  assert.equal(infoboxDate(article("")), "2024-01-20");
  assert.equal(infoboxDate("| date = August 11, 2012\n"), "2012-08-11");
  // A maintenance tag's month-only date above the infobox is not the event's.
  assert.equal(infoboxDate("{{Use mdy dates|date=June 2021}}\n{{Infobox MMA event\n| date = {{Start date|2021|9|25}}\n}}"), "2021-09-25");
  assert.equal(infoboxDate("{{Use mdy dates|date=July 2022}}\n{{Infobox MMA event\n| date = November 2, 2019\n}}"), "2019-11-02");
  // A year summary with no infobox is not read past its first date field.
  assert.equal(infoboxDate("Intro\n{{cite web |date=January 28, 2012 |title=x}}\n{{cite web |date=July 21, 2012}}"), "2012-01-28");
});

test("plain text drops references and templates and keeps link text", () => {
  assert.equal(plainText("[[Malcolm Gordon (fighter)|Malcolm Gordon]] missed<ref name=x>{{cite web|a=b}}</ref> weight."), "Malcolm Gordon missed weight.");
});

test("two misses named in one sentence pair with their weights in order", () => {
  const text = article("At the weigh-ins, Ramon Taveras and [[Malcolm Gordon (fighter)|Malcolm Gordon]] missed weight. Taveras weighed in at 139.75 pounds, three and three quarters pounds over the bantamweight non-title fight limit. Gordon weighed in at 127.5 pounds, one and a half pounds over the flyweight non-title fight limit.");
  assert.deepEqual(weightMisses(text, ["Ramon Taveras", "Charles Johnson", "Malcolm Gordon", "Aoriqileng"]), [
    { name: "Ramon Taveras", pounds: 139.75 },
    { name: "Malcolm Gordon", pounds: 127.5 },
  ]);
  const both = article("At the weigh ins, both fighters missed weight. Cháirez weighed in at 131 pounds and Lacerda at 127 pounds, five pounds and one pound over the flyweight non-title fight limit, respectively.");
  assert.deepEqual(weightMisses(both, ["Edgar Chairez", "Daniel Lacerda"]), [
    { name: "Edgar Chairez", pounds: 131 },
    { name: "Daniel Lacerda", pounds: 127 },
  ]);
});

test("one weight stated for two fighters applies to both", () => {
  const text = article("At the weigh-ins, four fighters missed weight:\n*Wang Cong and Eduarda Moura weighed in at 127.5 pounds, one and a half pounds over the women's flyweight non-title fight limit, respectively.\n*Muin Gafurov weighed in at 141 pounds, five pounds over the bantamweight non-title fight limit.\n\nGafurov was fined 25 percent of his purse which went to his opponent Jakub Wikłacz.");
  assert.deepEqual(weightMisses(text, ["Wang Cong", "Eduarda Moura", "Jakub Wiklacz", "Muin Gafurov"]), [
    { name: "Wang Cong", pounds: 127.5 },
    { name: "Eduarda Moura", pounds: 127.5 },
    { name: "Muin Gafurov", pounds: 141 },
  ]);
});

test("the opponent who receives the fine is never marked", () => {
  const text = article("At the weigh-ins, Mullins weighed in at 137 pounds, one pound over the bantamweight non-title fight limit. The bout proceeded at catchweight and she was fined 20 percent of her purse, which went to Syguła.");
  assert.deepEqual(weightMisses(text, ["Melissa Mullins", "Klaudia Sygula"]), [{ name: "Melissa Mullins", pounds: 137 }]);
  const fined = article("Diego Brandão weighed in seven pounds over the featherweight limit of 146 lb. Half of the fine went to Dustin Poirier.");
  assert.deepEqual(weightMisses(fined, ["Diego Brandao", "Dustin Poirier"]), [{ name: "Diego Brandao", pounds: null }]);
});

test("a missing weight falls back to the catchweight the bout went ahead at", () => {
  const text = article(
    "At the weigh-ins, Melvin Guillard was the only one of 20 fighters who missed weight.",
    "{{MMAevent bout |Catchweight (157.5 lb) |Donald Cerrone |def. |[[Melvin Guillard]] |KO |1 |1:16}}",
  );
  assert.deepEqual(weightMisses(text, ["Donald Cerrone", "Melvin Guillard"]), [{ name: "Melvin Guillard", pounds: 157.5 }]);
});

test("misses at other events and fighters who made weight are ignored", () => {
  const text = article("Jeremy Stephens, who missed weight at UFC 189, faced Calvin Kattar. Both fighters made weight on their second attempt.");
  assert.deepEqual(weightMisses(text, ["Jeremy Stephens", "Calvin Kattar"]), []);
});

test("a page covering many events yields only this event's section", () => {
  const page = "Intro\n{{Infobox MMA event\n|date=January 28, 2012\n}}\nEvans prose.\n==Results==\n"
    + "{{Infobox MMA event\n|date=February 15, 2012\n}}\nSanchez missed weight.\n";
  assert.ok(eventSection(page, "2012-01-28")?.includes("Evans prose"));
  assert.ok(!eventSection(page, "2012-01-28")?.includes("Sanchez"));
  assert.ok(eventSection(page, "2012-02-15")?.startsWith("{{Infobox MMA event\n|date=February 15"));
  assert.equal(eventSection(page, "2012-03-01"), null);
});

test("an article must name most of the card", () => {
  const text = "==Results==\n[[Thiago Santos]] def. [[Eryk Anders]]\nAlex Oliveira def. Carlo Pedersoli Jr.";
  assert.ok(namesCard(text, ["Thiago Santos", "Eryk Anders", "Alex Oliveira", "Carlo Pedersoli Jr."]));
  assert.ok(!namesCard(text, ["Thiago Santos", "Conor McGregor", "Nate Diaz", "Jose Aldo"]));
  assert.ok(namesCard(text, []));
});

test("an article must be held where the card was", () => {
  assert.ok(samePlace("Enterprise, Nevada United States", "Las Vegas, Nevada, USA"));
  assert.ok(samePlace("Al Rayyan, Qatar", "Doha, Qatar"));
  assert.ok(samePlace("Gdańsk/Sopot, Poland", "Gdansk, Poland"));
  assert.ok(samePlace(null, "Belfast, Northern Ireland, United Kingdom"));
  // Same night, another continent; a year summary's first card.
  assert.ok(!samePlace("São Paulo, Brazil", "Belfast, Northern Ireland, United Kingdom"));
  assert.ok(!samePlace("Chicago, Illinois", "Calgary, Alberta, Canada"));
  assert.ok(!samePlace("London, United Kingdom", "Dallas, Texas, United States"));
});

test("a follow-up sentence belongs to the fighter named first, not the first on the card", () => {
  const text = article("At the weigh-ins, [[Charles Oliveira]] failed to make the featherweight limit for his fight with [[Ricardo Lamas]], coming in nine pounds over the 146 lb weight allowance. He was fined 30 percent of his earnings, and Lamas insisted that Oliveira not weigh more than 160 lb the day of the fight. [[Felipe Arantes]] also missed weight for his bout against [[Erik Pérez]], coming in two pounds over the bantamweight weight allowance. He was fined 20 percent of his purse.");
  assert.deepEqual(weightMisses(text, ["Ricardo Lamas", "Charles Oliveira", "Erik Perez", "Felipe Arantes"]), [
    { name: "Charles Oliveira", pounds: null },
    { name: "Felipe Arantes", pounds: null },
  ]);
});

test("catchweights reads the results table, including a non-breaking space and a differently spelled corner", () => {
  const wikitext = `==Results==
{{MMAevent bout
|Catchweight (130 lb)
|[[Charles Johnson (fighter)|Charles Johnson]]
|def.
|Eduardo Henrique
|Submission (twister)
|3
|1:36
|
}}
{{MMAevent bout|Catchweight (215&nbsp;lb)|[[Kimbo Slice]]|def.|[[Houston Alexander]]|Decision (unanimous)|3|5:00|
}}`;
  const found = catchweights(wikitext, [
    { id: "a", f1: "Charles Johnson", f2: "Eduardo Chapolin" },
    { id: "b", f1: "Kevin Ferguson", f2: "Houston Alexander" },
  ]);
  assert.equal(found.get("a"), 130);
  assert.equal(found.get("b"), 215);
});

test("catchweights falls back to prose naming a fighter", () => {
  const found = catchweights("Charles Johnson was expected to face Jose Ochoa in a 130 pound catchweight bout.", [
    { id: "a", f1: "Charles Johnson", f2: "Eduardo Chapolin" },
  ]);
  assert.equal(found.get("a"), 130);
});

test("recordCatchweight finds the bout on its date against its opponent", () => {
  const record = `{| class="wikitable"
|-
| {{no2}}Loss
| [[Vitor Belfort]]
| TKO (punches)
| [[UFC 103]]
| {{dts|2009|September|19|format=mdy}}
| {{small|Catchweight (195 lbs) bout.}}
|-
| {{yes2}}Win
| [[Wanderlei Silva]]
| {{dts|2012|June|23|format=mdy}}
| {{small|Catchweight (190 lbs) bout.}}
|}`;
  assert.equal(recordCatchweight(record, "Vitor Belfort", "2009-09-19"), 195);
  assert.equal(recordCatchweight(record, "Wanderlei Silva", "2012-06-23"), 190);
  assert.equal(recordCatchweight(record, "Vitor Belfort", "2012-06-23"), null);
});

test("reads recent signings and releases by their column headings", () => {
  const wikitext = `
== Recent releases and retirements ==
Fighters released over the last month.
{| class="wikitable sortable"
! width=10%|Date
! width=3%|{{small|Country}}
! width=14%|Name
! width=14%|Nickname
! width=15%|Reason
! width=17%|Division
! width=3%| Ref
! width=11%|MMA record
|-
|rowspan="2"|{{dts|2026|Sep|16}}
|{{flagicon|USA}}
|{{sortname|Lyman|Good}}
|''Cyborg''
|Released
|Welterweight
|<ref name="cuts">{{Cite web
|url=https://example.com/cuts|title=Cuts}}</ref>
|{{ntsh|21.78}}21–6 (1 NC)
|-
|{{flagicon|ENG}}
|[[Michael Page (fighter)|Michael Page]]
|
|Contract not renewed
|Middleweight
|<ref name="cuts"/>
|{{ntsh|26.90}}26–3
|}

== Recent signings ==
{| class="wikitable sortable"
! width=13%|Date
! width=3%|{{small|[[ISO 3166-1 alpha-3|ISO]]}}
! width=13%|Name
! width=13%|Nickname
! width=13%|Division
! width=29%|Status / next fight / Info
! width=3%|Ref
! width=14%|MMA record
|-
|December 13, 2024
|{{flagicon|CHI}}
|Kennedy Freeman
|''The Machine 2.0''
|Women's Flyweight
|
|
|{{ntsh|7.0}}6–0
|}

== Suspended fighters ==
`;
  const { signed, cut } = rosterChanges(wikitext);
  assert.deepEqual(cut, [
    { date: "2026-09-16", name: "Lyman Good", nickname: "Cyborg", country: "US", division: "Welterweight", reason: "Released", record: "21–6 (1 NC)" },
    { date: "2026-09-16", name: "Michael Page", nickname: null, country: "EN", division: "Middleweight", reason: "Contract not renewed", record: "26–3" },
  ]);
  assert.deepEqual(signed, [
    { date: "2024-12-13", name: "Kennedy Freeman", nickname: "The Machine 2.0", country: "CL", division: "Women's Flyweight", reason: null, record: "6–0" },
  ]);
});

test("roster flags read Wikipedia's Lua icon syntax and template syntax", () => {
  const table = (flag: string) => `{| class="wikitable"
! Date
! Country
! Name
! Division
! MMA record
|-
|September 16, 2026
|${flag}
|Example Fighter
|Bantamweight
|7–0
|}`;
  const text = `\n== Recent signings ==\n${table("{{#invoke:flag|icon|CAN}}")}\n== Recent releases and retirements ==\n${table("{{FLAGICON|USA}}")}\n`;
  const moves = rosterChanges(text);
  assert.equal(moves.signed[0].country, "CA");
  assert.equal(moves.cut[0].country, "US");
});

test("replacements name whom they replaced, completing surnames from earlier prose", () => {
  const text = article([
    "A light heavyweight bout between former champion [[Jamahal Hill]] and [[Khalil Rountree Jr.]] was expected to serve as the co-headliner for this event.",
    "However, Rountree withdrew from the event after unintentionally ingesting [[DHEA]].",
    "He was replaced by [[Carlos Ulberg]].",
    "In turn, Hill pulled out due to injury and was replaced by former title challenger [[Anthony Smith (fighter)|Anthony Smith]].",
    "Subsequently, for unknown reasons, Ulberg pulled out and was replaced by [[Roman Dolidze]].",
    "A flyweight bout between [[Matt Schnell]] and Alessandro Costa was expected to take place at the event.",
    "However, Costa withdrew from the bout due to a shoulder injury and was replaced by [[Cody Durden]] in a bantamweight bout.",
    "However, Walker withdrew from the fight due to an injury and was replaced by promotional newcomer Billy Elekana.",
  ].join(" ").replace("Walker withdrew", "[[Johnny Walker (fighter)|Johnny Walker]] was set for [[UFC Fight Night: Santos vs. Walker]]. However, Walker withdrew"));
  assert.deepEqual(boutChanges(text, [["Anthony Smith", "Roman Dolidze"], ["Matt Schnell", "Cody Durden"], ["Billy Elekana", "Rodolfo Bellato"]]), [
    { name: "Anthony Smith", replaced: "Jamahal Hill", shortNotice: false },
    { name: "Roman Dolidze", replaced: "Carlos Ulberg", shortNotice: false },
    { name: "Cody Durden", replaced: "Alessandro Costa", shortNotice: false },
    { name: "Billy Elekana", replaced: "Johnny Walker", shortNotice: false },
  ]);
});

test("short notice is what the article says, or a fight-week withdrawal", () => {
  const text = article([
    "A UFC Lightweight Championship bout between current lightweight champion [[Islam Makhachev]] and [[Arman Tsarukyan]] was originally scheduled to headline the event.",
    "One day before the event, it was reported that Tsarukyan suffered an injury that forced him to pull out of the fight.",
    "[[Renato Moicano]], who was originally set to face [[Beneil Dariush]] at the same event, stepped in as a replacement for Tsarukyan.",
    "A day before the event, the bout between Brian Ortega and [[Diego Lopes]] was changed to a lightweight bout.",
    "Subsequently, on the day of the event, Ortega withdrew from the bout due to an illness.",
    "He was replaced by [[Dan Ige]] just hours before the bout took place.",
    "[[Jai Herbert]] will make his debut on short notice.",
  ].join(" "));
  assert.deepEqual(boutChanges(text, [["Islam Makhachev", "Renato Moicano"], ["Diego Lopes", "Dan Ige"], ["Jai Herbert", "Someone Else"]]), [
    { name: "Renato Moicano", replaced: "Arman Tsarukyan", shortNotice: true },
    { name: "Dan Ige", replaced: "Brian Ortega", shortNotice: true },
    { name: "Jai Herbert", replaced: null, shortNotice: true },
  ]);
});

test("a change at another card is history, and nobody replaces their own opponent", () => {
  const text = article("They were originally expected to face each other at [[UFC 307]], but [[Aljamain Sterling]] withdrew due to an injury and was replaced by [[Movsar Evloev]]. Evloev stepped in for Sterling against him.");
  assert.deepEqual(boutChanges(text, [["Movsar Evloev", "Aljamain Sterling"]]), [{ name: "Movsar Evloev", replaced: "", shortNotice: false }]);
});

test("backups, other cards' history and partial names are read with care", () => {
  const text = article([
    "Former champion [[Jiří Procházka]], who met [[Khalil Rountree Jr.]] at the event, served as backup and potential replacement for this fight.",
    "Holland was expected to face [[Gilbert Burns]] at [[UFC 279: Chimaev vs. Diaz]], but the promotion opted to book them on short notice against different opponents.",
    "A women's bantamweight bout between [[Mayra Bueno Silva]] and [[Priscila Cachoeira]] was scheduled.",
    "However, Bueno Silva withdrew and was replaced by [[Joselyne Edwards]].",
    "However, Haddon withdrew and was replaced by [[Colby Thicknesse]].",
  ].join(" ").replace("Holland was", "[[Kevin Holland]] was"));
  assert.deepEqual(boutChanges(text, [["Jiri Prochazka", "Khalil Rountree Jr."], ["Kevin Holland", "Daniel Rodriguez"], ["Joselyne Edwards", "Priscila Cachoeira"], ["Aleksandre Topuria", "Colby Thicknesse"]]), [
    { name: "Joselyne Edwards", replaced: "Mayra Bueno Silva", shortNotice: false },
    { name: "Colby Thicknesse", replaced: "Haddon", shortNotice: false },
  ]);
});

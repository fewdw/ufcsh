import test from "node:test";
import assert from "node:assert/strict";
import { cardChanges, catchweights, eventSection, infoboxDate, namesCard, plainText, recordCatchweight, rosterChanges, samePlace, weightMisses } from "./wikipedia.ts";

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

test("a surname shared with someone off the card is not attributed to the card's fighter", () => {
  const text = article("A welterweight bout between [[Stephen Thompson (fighter)|Stephen Thompson]] and [[Michel Pereira]] was rescheduled for this event. At the weigh-ins, Pereira weighed in at 174 pounds, three pounds over the welterweight non-title fight limit. As a result, the bout was scrapped. Vinicius Salvador weighed in at 128.5 pounds, two and a half pounds over the flyweight non-title fight limit.");
  assert.deepEqual(weightMisses(text, ["Alex Pereira", "Jan Blachowicz", "CJ Vergara", "Vinicius Salvador"]), [{ name: "Vinicius Salvador", pounds: 128.5 }]);
  const own = article("[[Alex Pereira]] headlined. At the weigh-ins, Pereira weighed in at 207 pounds, one pound over the light heavyweight non-title fight limit.");
  assert.deepEqual(weightMisses(own, ["Alex Pereira", "Jan Blachowicz"]), [{ name: "Alex Pereira", pounds: 207 }]);
  // The article's spelling of a card fighter's own name is still that fighter.
  const variants = article("At the weigh-ins, two fighters missed weight:\n*Jose Miguel Delgado weighed in at 147 pounds, one pound over the featherweight non-title fight limit.\n*Philip Rowe weighed in at 173.5 pounds, two and a half pounds over the welterweight non-title fight limit.\n\nDelgado and Rowe's bouts proceeded at catchweight.");
  assert.deepEqual(weightMisses(variants, ["Jose Delgado", "Phil Rowe"]), [{ name: "Jose Delgado", pounds: 147 }, { name: "Phil Rowe", pounds: 173.5 }]);
  // A namesake named in another paragraph does not take over the surname.
  const apart = article("Marcelo Rojo was rescheduled to face [[Jonathan Martinez]] the following week.\n\nAt the weigh-ins, Martinez weighed in at 140 pounds, four pounds over the bantamweight non-title fight limit.");
  assert.deepEqual(weightMisses(apart, ["Mana Martinez", "Guido Cannetti"]), [{ name: "Mana Martinez", pounds: 140 }]);
});

test("a list of weights pairs with the fighters named in the same order", () => {
  const text = article("[[Jessica-Rose Clark]], [[Ryan Benoit]], [[Frank Camacho]], and [[Nadia Kassem]] missed weight at the official weigh-ins, coming in at 128, 129, 160 and 120 pounds, respectively.");
  assert.deepEqual(weightMisses(text, ["Jessica-Rose Clark", "Bec Rawlings", "Ryan Benoit", "Frank Camacho", "Nadia Kassem"]), [
    { name: "Jessica-Rose Clark", pounds: 128 },
    { name: "Ryan Benoit", pounds: 129 },
    { name: "Frank Camacho", pounds: 160 },
    { name: "Nadia Kassem", pounds: 120 },
  ]);
});

test("the bout's other fighter, named only to say which bout, did not miss", () => {
  const text = article("In addition, at the weigh-ins, the originally contracted bantamweight bout between [[Farid Basharat]] and Victor Hugo was changed to a featherweight bout after Hugo weighed in at 145.5 pounds, 9.5 pounds over the bantamweight non-title fight limit; although Basharat weighed in at 137 pounds, he agreed to allow the fight to take place at featherweight.");
  assert.deepEqual(weightMisses(text, ["Farid Basharat", "Victor Hugo"]), [{ name: "Victor Hugo", pounds: 145.5 }]);
  // With no one named after the pair, the pair is still who missed.
  const both = article("The bout between Ramon Taveras and Malcolm Gordon proceeded at a catchweight after both fighters missed weight.");
  assert.deepEqual(weightMisses(both, ["Ramon Taveras", "Malcolm Gordon"]).map((miss) => miss.name), ["Ramon Taveras", "Malcolm Gordon"]);
});

test("a surname with a particle belongs to someone else", () => {
  const text = article("A flyweight bout between Daniel da Silva and Vinicius Salvador was expected to take place at the event. However, after the official weigh-ins, in which da Silva weighed in at 129 pounds, three pounds over the flyweight non-title fight limit, it was announced he had been pulled from the card.");
  assert.deepEqual(weightMisses(text, ["TJ Brown", "Erik Silva"]), []);
  const own = article("At the weigh-ins, Bruno da Silva weighed in at 128 pounds, two pounds over the flyweight non-title fight limit. Da Silva was fined 20 percent.");
  assert.deepEqual(weightMisses(own, ["Bruno da Silva", "Erik Silva"]), [{ name: "Bruno da Silva", pounds: 128 }]);
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
  assert.deepEqual(cardChanges(text, [["Anthony Smith", "Roman Dolidze"], ["Matt Schnell", "Cody Durden"], ["Billy Elekana", "Rodolfo Bellato"]]).changes, [
    { name: "Anthony Smith", replaced: "Jamahal Hill", shortNotice: false, notice: null },
    { name: "Roman Dolidze", replaced: "Carlos Ulberg", shortNotice: false, notice: null },
    { name: "Cody Durden", replaced: "Alessandro Costa", shortNotice: false, notice: null },
    { name: "Billy Elekana", replaced: "Johnny Walker", shortNotice: false, notice: null },
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
  assert.deepEqual(cardChanges(text, [["Islam Makhachev", "Renato Moicano"], ["Diego Lopes", "Dan Ige"], ["Jai Herbert", "Someone Else"]]).changes, [
    { name: "Renato Moicano", replaced: "Arman Tsarukyan", shortNotice: true, notice: "1 day" },
    { name: "Dan Ige", replaced: "Brian Ortega", shortNotice: true, notice: "hours" },
    { name: "Jai Herbert", replaced: null, shortNotice: true, notice: null },
  ]);
});

test("a change at another card is history, and nobody replaces their own opponent", () => {
  const text = article("They were originally expected to face each other at [[UFC 307]], but [[Aljamain Sterling]] withdrew due to an injury and was replaced by [[Movsar Evloev]]. Evloev stepped in for Sterling against him.");
  assert.deepEqual(cardChanges(text, [["Movsar Evloev", "Aljamain Sterling"]]).changes, [{ name: "Movsar Evloev", replaced: "", shortNotice: false, notice: null }]);
});

test("backups, other cards' history and partial names are read with care", () => {
  const text = article([
    "Former champion [[Jiří Procházka]], who met [[Khalil Rountree Jr.]] at the event, served as backup and potential replacement for this fight.",
    "Holland was expected to face [[Gilbert Burns]] at [[UFC 279: Chimaev vs. Diaz]], but the promotion opted to book them on short notice against different opponents.",
    "A women's bantamweight bout between [[Mayra Bueno Silva]] and [[Priscila Cachoeira]] was scheduled.",
    "However, Bueno Silva withdrew and was replaced by [[Joselyne Edwards]].",
    "However, Haddon withdrew and was replaced by [[Colby Thicknesse]].",
  ].join(" ").replace("Holland was", "[[Kevin Holland]] was"));
  assert.deepEqual(cardChanges(text, [["Jiri Prochazka", "Khalil Rountree Jr."], ["Kevin Holland", "Daniel Rodriguez"], ["Joselyne Edwards", "Priscila Cachoeira"], ["Aleksandre Topuria", "Colby Thicknesse"]]).changes, [
    { name: "Joselyne Edwards", replaced: "Mayra Bueno Silva", shortNotice: false, notice: null },
    { name: "Colby Thicknesse", replaced: "Haddon", shortNotice: false, notice: null },
  ]);
});

test("notice is read as the article states it", () => {
  const text = article([
    "However, Rountree withdrew less than two weeks before the event and was replaced by [[Bogdan Guskov]].",
    "However, Dumas pulled out during fight week and was replaced by [[Azamat Bekoev]].",
    "[[Kevin Holland]] stepped in on 10 days' notice to replace Michael Page.",
    "However, Teixeira withdrew and was replaced by [[Kennedy Nzechukwu]] on two weeks' notice.",
  ].join(" "));
  const notices = cardChanges(text, [["Magomed Ankalaev", "Bogdan Guskov"], ["Zach Reese", "Azamat Bekoev"], ["Kevin Holland", "Reinier de Ridder"], ["Kennedy Nzechukwu", "Lukasz Brzeski"]])
    .changes.map((change) => [change.name, change.notice, change.shortNotice]);
  assert.deepEqual(notices, [
    ["Bogdan Guskov", "under 2 weeks", true],
    ["Azamat Bekoev", "fight week", true],
    ["Kevin Holland", "10 days", true],
    ["Kennedy Nzechukwu", "2 weeks", true],
  ]);
});

test("cancelled bouts are the announced pairings that were scrapped, not replaced or moved", () => {
  const text = article([
    "A heavyweight bout between [[Tallison Teixeira]] and Łukasz Brzeski was scheduled for this event.",
    "However, Teixeira withdrew from the fight due to injury and was replaced by [[Kennedy Nzechukwu]].",
    "In addition, Martin Buday and [[Rizvan Kuniev]] were scheduled to meet in a heavyweight bout.",
    "A heavyweight bout between former [[UFC Heavyweight Championship|UFC Heavyweight Champion]] [[Andrei Arlovski]] and [[Martin Buday]] was scheduled for this event.",
    "However, Buday withdrew due to an injury and the bout was removed from the card.",
    "A women's strawweight bout between [[Tatiana Suarez]] and [[Virna Jandiroba]] was scheduled for this event.",
    "However, Suarez withdrew from the fight due to an unspecified health issue and the bout was subsequently removed from the card.",
    "A middleweight bout between [[Paulo Costa]] and [[Sharabutdin Magomedov]] was expected to take place at this event.",
    "However, the bout was moved to [[UFC 312]] for undisclosed reasons.",
  ].join(" "));
  assert.deepEqual(cardChanges(text, [["Kennedy Nzechukwu", "Lukasz Brzeski"]]).cancelled, [
    { f1: "Andrei Arlovski", f2: "Martin Buday", division: "heavyweight", reason: "Martin Buday withdrew (injury)" },
    { f1: "Tatiana Suarez", f2: "Virna Jandiroba", division: "women's strawweight", reason: "Tatiana Suarez withdrew (unspecified health issue)" },
  ]);
});

test("an opponent who faced the stranded fighter instead replaced the one who left", () => {
  const text = article([
    "A UFC Welterweight Championship bout between current champion [[Belal Muhammad]] and undefeated contender [[Shavkat Rakhmonov]] was scheduled to headline the event.",
    "However due to a [[bone infection]] in his foot, Muhammad was forced to withdraw.",
    "Rakhmonov instead faced [[Ian Machado Garry]] in a five-round title eliminator co-main event.",
    "A bantamweight bout between former two-time champion [[Dominick Cruz]] and [[Rob Font]] was scheduled for this event.",
    "However, Cruz withdrew due to an injury.",
    "[[Jean Matsumoto]], who was scheduled to compete at [[UFC 313]], replaced him in a catchweight bout of 140 pounds.",
  ].join(" "));
  const { changes, cancelled } = cardChanges(text, [["Shavkat Rakhmonov", "Ian Machado Garry"], ["Rob Font", "Jean Matsumoto"]]);
  assert.deepEqual(changes.map((change) => [change.name, change.replaced]), [["Ian Machado Garry", "Belal Muhammad"], ["Jean Matsumoto", "Dominick Cruz"]]);
  assert.deepEqual(cancelled, []);
});

test("a month, an acronym or a sentence opener is never the replaced fighter", () => {
  const text = article([
    "A welterweight bout between [[Dakota Bush]] and [[Ludovit Klein]] was scheduled for the event.",
    "However, Bush tested positive for COVID-19 during fight week and was replaced by [[Brandon Jenkins]].",
    "[[Dhiego Lima]] was expected to face [[Mike Malott]].",
    "However, Lima announced his retirement from competition in early February and was replaced by [[André Fialho]].",
    "A lightweight bout between [[Alan Patrick]] and [[Rodrigo Vargas]] was scheduled for this event, but Vargas was removed from the card in early September for undisclosed reasons and replaced by [[Bobby Green]].",
  ].join(" "));
  const changes = cardChanges(text, [["Brandon Jenkins", "Ludovit Klein"], ["Andre Fialho", "Mike Malott"], ["Alan Patrick", "Bobby Green"]]).changes;
  assert.deepEqual(changes.map((change) => [change.name, change.replaced]), [
    ["Brandon Jenkins", "Dakota Bush"], ["Andre Fialho", "Dhiego Lima"], ["Bobby Green", "Rodrigo Vargas"],
  ]);
});

test("he or she is the fighter the replacement's opponent was booked against", () => {
  const text = article([
    "[[Yancy Medeiros]] was expected to face [[Mike Perry (fighter)|Mike Perry]] at the event.",
    "However, he pulled out of the fight in late-June citing a rib injury and was replaced by [[Paul Felder]].",
    "[[Umar Nurmagomedov]] was expected to face [[Nathaniel Wood]] in a bantamweight bout at this event.",
    "However, he pulled out on July 3 after the death of his uncle.",
    "He was replaced by promotional newcomer John Castañeda.",
    "On September 19, promotional newcomer Carlos Felipe was flagged for a potential USADA violation.",
    "Therefore, he was pulled from his UFC debut against [[Christian Colombo]].",
    "He was replaced by fellow promotional newcomer Marcelo Golm.",
  ].join(" "));
  const changes = cardChanges(text, [["Paul Felder", "Mike Perry"], ["John Castaneda", "Nathaniel Wood"], ["Marcelo Golm", "Christian Colombo"]]).changes;
  assert.deepEqual(changes.map((change) => [change.name, change.replaced]), [
    ["Paul Felder", "Yancy Medeiros"], ["John Castaneda", "Umar Nurmagomedov"], ["Marcelo Golm", "Carlos Felipe"],
  ]);
});

test("a surname is completed across hyphens, particles and the article's own misspelling", () => {
  const text = article([
    "[[Abdul-Kareem Al-Selwady]] was expected to face [[Mitch Ramirez]]. However, Al-Selwady withdrew from the fight due to an injury and was replaced by promotional newcomer [[Jordan Vucenic]].",
    "A bout between [[AJ Cunningham]] and [[Ricardo Ramos]] was scheduled. However, Cunninham withdrew from the fight due to an injury and was replaced by [[Gabriel Miranda]].",
    "Dricus du Plessis was expected to face [[Andre Muniz]]. However, du Plessis withdrew and was replaced by [[Eryk Anders]].",
  ].join(" "));
  const changes = cardChanges(text, [["Jordan Vucenic", "Mitch Ramirez"], ["Gabriel Miranda", "Ricardo Ramos"], ["Eryk Anders", "Andre Muniz"]]).changes;
  assert.deepEqual(changes.map((change) => [change.name, change.replaced]), [
    ["Jordan Vucenic", "Abdul-Kareem Al-Selwady"], ["Gabriel Miranda", "AJ Cunningham"], ["Eryk Anders", "Dricus du Plessis"],
  ]);
});

test("notice is counted from a date the replacing sentence states", () => {
  const text = article([
    "[[Ruslan Magomedov]] was expected to face [[Marcos Rogério de Lima]] at the event.",
    "However, on October 24, it was reported that he pulled out of the event due to visa issues and was replaced by [[Adam Wieczorek]].",
    "However, Jason pulled out of the bout on October 31 and was replaced by promotional newcomer [[Renato Moicano]].",
    "[[Chris Weidman]] was expected to face Kelvin Gastelum, but was replaced by [[Uriah Hall]] in a bout originally scheduled for October 1.",
  ].join(" ")).replace("{{start date|2024|01|20}}", "{{start date|2018|11|03}}");
  const changes = cardChanges(text, [["Adam Wieczorek", "Marcos Rogerio de Lima"], ["Renato Moicano", "Tom Niinimaki"], ["Uriah Hall", "Kelvin Gastelum"]]).changes;
  assert.deepEqual(changes.map((change) => [change.name, change.notice]), [["Adam Wieczorek", "10 days"], ["Renato Moicano", "3 days"], ["Uriah Hall", null]]);
});

test("a bout replaced by another bout, or a sentence about a later card, names no replacement", () => {
  const text = article([
    "A bout between George Roop and Francisco Rivera was scheduled for this card, but was moved to UFC Fight Night 31 and replaced by [[Sarah Kaufman]] vs. [[Jessica Eye]].",
    "On Friday April 20, 2025, the UFC confirmed that Overeem has been removed from his fight with Dos Santos and replaced by [[Frank Mir]].",
  ].join(" "));
  assert.deepEqual(cardChanges(text, [["Sarah Kaufman", "Jessica Eye"], ["Frank Mir", "Antonio Rodrigo Nogueira"]]).changes, []);
});

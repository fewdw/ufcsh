import test from "node:test";
import assert from "node:assert/strict";
import { contenderContracts } from "./contender-contracts.ts";

const episode = (date: string, bullets: string, heading = "Contract awards") => `
== Week 1 ==
{{Infobox MMA event|date=${date}|name=Dana White's Contender Series}}
=== ${heading} ===
The following fighters were awarded contracts with the UFC:<ref>{{cite web|url=https://www.ufc.com/news/results}}</ref>
${bullets}`;

test("only explicitly awarded full contracts are retained on their own episode date", () => {
  const text = episode("July 11, 2017", "*'''[[Kurt Holobaugh (fighter)|Kurt Holobaugh]]''' and '''Boston Salmon'''\n*'''Zu Anyanwu''' was not offered a contract but was brought in later.")
    + episode("August 29, 2017", "*Matt Frevola, Lauren Mueller, and Allen Crowder\n*Bevon Lewis was signed to a development league contract");
  assert.deepEqual(contenderContracts(text).map(({ name, date }) => [name, date]), [
    ["Kurt Holobaugh", "2017-07-11"], ["Boston Salmon", "2017-07-11"],
    ["Matt Frevola", "2017-08-29"], ["Lauren Mueller", "2017-08-29"], ["Allen Crowder", "2017-08-29"],
  ]);
});

test("wins, development deals, missing sources and invalid dates never establish signings", () => {
  assert.deepEqual(contenderContracts(episode("June 12, 2018", "*Alonzo Menifield and Greg Hardy")).map(row => row.name), ["Alonzo Menifield"]);
  assert.deepEqual(contenderContracts(episode("February 30, 2024", "*Example Fighter")), []);
  assert.deepEqual(contenderContracts(episode("July 11, 2017", "*Example Fighter", "Results")), []);
  assert.deepEqual(contenderContracts(episode("July 11, 2017", "*Example Fighter").replace("were awarded contracts with the UFC", "won their fights")), []);
  assert.deepEqual(contenderContracts(episode("July 11, 2017", "*Example Fighter").replace("https://www.ufc.com/news/results", "")), []);
});

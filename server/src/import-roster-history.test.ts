import test from "node:test";
import assert from "node:assert/strict";
import { cleanName, undatedReleases } from "./import-roster-history.ts";

test("roster cells keep the name and whether it said retired", () => {
  assert.deepEqual(cleanName("Tim Williams (fighter)| Tim Williams"), { name: "Tim Williams", retired: false });
  assert.deepEqual(cleanName("BJ Penn(retired)"), { name: "BJ Penn", retired: true });
  assert.deepEqual(cleanName("Amanda Ribas - 2 years suspension by USADA"), { name: "Amanda Ribas", retired: false });
});

test("an undated release counts only through a dated report about that fighter leaving", () => {
  const text = `Intro
==Recent cuts==
{| class="wikitable"
! Name
! Division
|-
|[[Ryan Jensen (fighter)|Ryan Jensen]]<ref>{{cite web|url=http://example.com/a|title=Ryan Jensen released by UFC following loss|date=May 3, 2011}}</ref>
|Middleweight
|-
|[[Ricardo Almeida]]<ref name="almeida">{{cite web|url=http://example.com/b|title=Almeida Retires from MMA|date=March 31, 2011}}</ref>
|Welterweight
|-
|[[Oluwale Bamgbose]]<ref>{{cite web|url=http://example.com/c|title=Oluwale Bamgbose's official Sherdog profile|date=September 23, 2015}}</ref>
|Middleweight
|-
|[[Sean McCorkle]]<ref>{{cite web|url=http://example.com/d|title=Four fighters cut by the UFC|date=April 8, 2011}}</ref>
|Heavyweight
|}
==Recent signings==
`;
  assert.deepEqual(undatedReleases(text), [
    { name: "Ryan Jensen", date: "2011-05-03", reason: "Released" },
    { name: "Ricardo Almeida", date: "2011-03-31", reason: "Retired" },
  ]);
});

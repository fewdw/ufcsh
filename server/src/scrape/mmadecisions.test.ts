import test from "node:test";
import assert from "node:assert/strict";
import { parseMmaDecision, parseMmaEventDecisions, parseMmaEvents } from "./mmadecisions.ts";

test("MMA Decisions archive keeps dated UFC events and decision links", () => {
  const listing = `<table>
    <tr><td>Aug 23, 2025</td><td><a href="event/1571/UFC-on-ESPN-115">UFC on ESPN+ 115</a></td></tr>
    <tr><td>Aug 23, 2025</td><td><a href="event/1573/TUF-22-Finale">TUF 22 Finale</a></td></tr>
    <tr><td>Aug 23, 2025</td><td><a href="event/1572/PFL-test">PFL test</a></td></tr>
  </table>`;
  assert.deepEqual(parseMmaEvents(listing), [
    { date: "2025-08-23", path: "event/1571/UFC-on-ESPN-115" },
    { date: "2025-08-23", path: "event/1573/TUF-22-Finale" },
  ]);
  assert.deepEqual(parseMmaEventDecisions(`<a href="decision/15632/Rong-Zhu-vs-Austin-Hubbard\n">one</a>
    <a href="decision/15632/Rong-Zhu-vs-Austin-Hubbard">duplicate</a>`),
    ["decision/15632/Rong-Zhu-vs-Austin-Hubbard"]);
});

test("MMA Decisions judge rounds must sum to the published total", () => {
  const card = (total: number) => `<table><tr><td class="judge">Jane Judge</td></tr>
    <tr class="decision"><td>1</td><td>10</td><td>9</td></tr>
    <tr class="decision"><td>2</td><td>9</td><td>10</td></tr>
    <tr class="decision"><td>3</td><td>10</td><td>9</td></tr>
    <tr class="bottom-row"><td>TOTAL</td><td>${total}</td><td>28</td></tr></table>`;
  const page = (total: number) => `<a href="fighter/1/Rong-Zhu">Rong Zhu</a>
    <a href="fighter/2/Austin-Hubbard">Austin Hubbard</a>${card(total)}`;
  assert.deepEqual(parseMmaDecision(page(29))?.judges[0].rounds,
    [{ round: 1, f1Score: 10, f2Score: 9 }, { round: 2, f1Score: 9, f2Score: 10 }, { round: 3, f1Score: 10, f2Score: 9 }]);
  assert.equal(parseMmaDecision(page(30))?.judges.length, 0);
});

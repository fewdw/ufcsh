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

test("published judge totals can retain names when the source has no round scores", () => {
  const page = `<a href="fighter/1/A">First Fighter</a><a href="fighter/2/B">Second Fighter</a>
    <table><tr><td class="judge">Jane Judge</td></tr><tr class="bottom-row"><td>TOTAL</td><td>29</td><td>28</td></tr></table>`;
  assert.deepEqual(parseMmaDecision(page)?.judges, [{ judge: "Jane Judge", f1Score: 29, f2Score: 28 }]);
  assert.equal(parseMmaDecision(page.replace("<td>29</td>", "<td>--</td>"))?.judges.length, 0);
});

test("MMA Decisions deductions keep the fighter, points, round and reason", () => {
  const page = `<a href="fighter/1/A">Charles Oliveira</a><a href="fighter/2/B">Nate Marquardt</a>
    <table><tr><td colspan="2"><table>
      <tr><td align="left"><img src="tribullet2.png"> Marquardt was deducted 1 point in round 2: <b>Illegal Knee to a Downed Opponent</b></td></tr>
      <tr><td align="left"><img src="tribullet2.png"> Marquardt was deducted 2 points in round 3: <b>Low blow</b></td></tr>
    </table></td></tr></table>`;
  assert.deepEqual(parseMmaDecision(page)?.deductions, [
    { name: "Marquardt", points: 1, round: 2, reason: "Illegal Knee to a Downed Opponent" },
    { name: "Marquardt", points: 2, round: 3, reason: "Low blow" },
  ]);
  assert.deepEqual(parseMmaDecision(page.replace(/<table>[\s\S]*<\/table>/, ""))?.deductions, []);
});

test("MMA Decisions media scores keep the writer, outlet, link, score and winner", () => {
  const row = (who: string, score: string, winner: string) => `<tr class="decision"><td>${who}</td>
    <td><a href='https://x.com/a/status/1' class='external'>${score}</a></td><td>${winner}</td></tr>`;
  const page = `<a href="fighter/1/A">Movsar Evloev</a><a href="fighter/2/B">Lerone Murphy</a>
    <table><tr class="top-row"><td class="top-cell" colspan="3"><b>MEDIA SCORES</b></td></tr>
      ${row("Keith&nbsp;Shillan<br><i><a href='https://x.com/a/status/1'>Sherdog.com</a></i>", "47-47", "<i>DRAW</i>")}
      <tr><td colspan="3"><hr></td></tr>
      ${row(`<a href="https://x.com/mmamania/status/2">&nbsp;MMAMania.com</a>`, "46-48", "Murphy")}
    </table>`;
  assert.deepEqual(parseMmaDecision(page)?.media, [
    { name: "Keith Shillan", outlet: "Sherdog.com", url: "https://x.com/a/status/1", f1Score: 47, f2Score: 47, winner: "DRAW" },
    { name: "", outlet: "MMAMania.com", url: "https://x.com/a/status/1", f1Score: 46, f2Score: 48, winner: "Murphy" },
  ]);
  assert.deepEqual(parseMmaDecision(page.replace("MEDIA SCORES", "FAN SCORING"))?.media, []);
});

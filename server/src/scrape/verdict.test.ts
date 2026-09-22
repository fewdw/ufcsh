import test from "node:test";
import assert from "node:assert/strict";
import { parseVerdictEventPage, parseVerdictFightPage } from "./verdict.ts";

test("Verdict event pages expose dated numbered and client-side fight cards", () => {
  const page = parseVerdictEventPage(`
    <head><meta property="og:title" content="UFC Test"><meta name="description" content="UFC Test — March 2, 2024 · Arena"></head>
    <a href="/rate/fights/event/10/fight/7"><div></div><div><div>Alpha One</div><div>vs.</div><div>Beta Two</div></div></a>
    <article><span style="font:600 16px/21px Poppins">Gamma Three</span><span style="font:600 16px/21px Poppins">Delta Four</span></article>
  `);
  assert.equal(page.date, "2024-03-02");
  assert.deepEqual(page.fights, [
    { eventId: 10, fightNumber: 7, f1Name: "Alpha One", f2Name: "Beta Two" },
    { fightNumber: null, f1Name: "Gamma Three", f2Name: "Delta Four" },
  ]);
});

const grid = (first: string[], second: string[]) => `
  <div style="display:grid;padding:0 4px 10px"><span>Round</span><span>R1</span><span>R2</span><span>R3</span><span>TOT</span></div>
  <div style="display:grid;margin-bottom:6px"><span>${first[0]}</span>${first.slice(1).map(value => `<span>${value}</span>`).join("")}</div>
  <div style="display:grid;margin-bottom:0"><span>${second[0]}</span>${second.slice(1).map(value => `<span>${value}</span>`).join("")}</div>`;

test("Verdict fight pages retain official rounds and community counts and averages", () => {
  const page = parseVerdictFightPage(`
    <head><meta property="og:title" content="Alpha One vs Beta Two"></head><main>
    <section><h2>Verdict Scorecard</h2><div>${grid(["One", "9.25", "10", "9", "28.25"], ["Two", "9.75", "9", "10", "28.75"])}</div>
      <a href="/community-scorecards/event/10/fight/7"><span><span>1,234</span> scorecards</span></a></section>
    <section><div style="border-radius:12px;overflow:hidden"><span>Official Scorecard</span><div><span>Judge:</span><span>Jane Judge</span></div>
      <div>${grid(["One", "9", "10", "9", "28"], ["Two", "10", "9", "10", "29"])}</div></div></section>
    </main>`);
  assert.equal(page?.community?.cards, 1234);
  assert.deepEqual(page?.community?.rounds[0], { round: 1, avg1: 9.25, avg2: 9.75 });
  assert.deepEqual(page?.judges[0], {
    judge: "Jane Judge", f1Name: "One", f2Name: "Two", f1Score: 28, f2Score: 29,
    rounds: [
      { round: 1, f1Score: 9, f2Score: 10 },
      { round: 2, f1Score: 10, f2Score: 9 },
      { round: 3, f1Score: 9, f2Score: 10 },
    ],
  });
});

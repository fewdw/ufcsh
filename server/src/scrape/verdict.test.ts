import test from "node:test";
import assert from "node:assert/strict";
import { parseVerdictDeductions, parseVerdictEventPage, parseVerdictFightPage, parseVerdictLiveCard } from "./verdict.ts";

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

test("a stoppage's community card keeps the rounds scored before it", () => {
  const page = parseVerdictFightPage(`
    <head><meta property="og:title" content="Marlon Vera vs Charles Jourdain"></head><main>
    <section><h2>Verdict Scorecard</h2><div>${grid(["Vera", "9.83", "9.98", "TKO", "19.82"], ["Jourdain", "9.16", "8.69", "", "17.85"])}</div>
      <a href="/community-scorecards/event/1947/fight/4"><span><span>6,481</span> scorecards</span></a></section>
    </main>`);
  assert.deepEqual(page?.community, {
    cards: 6481, f1Name: "Vera", f2Name: "Jourdain", avg1: 19.82, avg2: 17.85,
    rounds: [{ round: 1, avg1: 9.83, avg2: 9.16 }, { round: 2, avg1: 9.98, avg2: 8.69 }],
  });
});

test("a live Verdict card names the bout on and each round's status, from its own card only", () => {
  // Nuxt's flattened payload: every value is an index into the array.
  const flat: unknown[] = [];
  const at = (value: unknown) => flat.push(value) - 1;
  const fighter = (first: string, last: string) => at({ fighterFirstName: at(first), fighterLastName: at(last) });
  const round = (roundNumber: number, roundStatus: number) => at({ roundNumber: at(roundNumber), roundStatus: at(roundStatus) });
  const model = (eventID: number, fightNumber: number, fightStatus: number, rounds: number[], names: [string, string, string, string]) => at({
    eventID: at(eventID), fightNumber: at(fightNumber), fightStatus: at(fightStatus),
    fighter1: fighter(names[0], names[1]), fighter2: fighter(names[2], names[3]),
    rounds: at(["Reactive", at(rounds)]),
  });
  const buckley: [string, string, string, string] = ["Joaquin", "Buckley", "Mike", "Malott"];
  model(1936, 4, 1, [], buckley); // the card's bare copy
  model(1936, 4, 1, [round(1, 3), round(2, 1), round(3, 0)], buckley);
  model(1936, 5, 3, [round(1, 3), round(2, 3), round(3, 3)], ["Erin", "Blanchfield", "Jasmine", "Jasudavicius"]);
  model(1955, 1, 0, [], ["Alexander", "Volkanovski", "Movsar", "Evloev"]); // a rail's other card
  const html = `<html><body></body><script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">${JSON.stringify(flat)}</script></html>`;
  assert.deepEqual(parseVerdictLiveCard(html, 1936), [
    { eventId: 1936, fightNumber: 4, f1Name: "Joaquin Buckley", f2Name: "Mike Malott", status: 1,
      rounds: [{ round: 1, status: 3 }, { round: 2, status: 1 }, { round: 3, status: 0 }] },
    { eventId: 1936, fightNumber: 5, f1Name: "Erin Blanchfield", f2Name: "Jasmine Jasudavicius", status: 3,
      rounds: [{ round: 1, status: 3 }, { round: 2, status: 3 }, { round: 3, status: 3 }] },
  ]);
  assert.deepEqual(parseVerdictLiveCard("<html></html>", 1936), []);
});

test("a split card's other half is listed by its rows, which a model with rounds replaces", () => {
  const flat: unknown[] = [];
  const at = (value: unknown) => flat.push(value) - 1;
  const row = (link: string, f1: string, f2: string, status: number) => at({
    type: at("fighterVersus"), fighter1Name: at(f1), fighter2Name: at(f2), fightStatus: at(status),
    action: at({ title: at("Score"), link: at(link) }),
  });
  row("/event/1965/fight/10", "Francis Marshall", "Dakota Hope", 1);
  row("/event/1965/fight/9", "Zach Reese", "Mickey Gall", 3);
  row("/event/1969/fight/2", "Renato Moicano", "Tom Nolan", 0); // the main card's half
  row("/rate/fights", "Not", "A Bout", 1);
  at({
    eventID: at(1965), fightNumber: at(9), fightStatus: at(3),
    fighter1: at({ fighterFirstName: at("Zach"), fighterLastName: at("Reese") }),
    fighter2: at({ fighterFirstName: at("Mickey"), fighterLastName: at("Gall") }),
    rounds: at([at({ roundNumber: at(1), roundStatus: at(3) })]),
  });
  const html = `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(flat)}</script>`;
  assert.deepEqual(parseVerdictLiveCard(html, 1965), [
    { eventId: 1965, fightNumber: 10, f1Name: "Francis Marshall", f2Name: "Dakota Hope", status: 1, rounds: [] },
    { eventId: 1965, fightNumber: 9, f1Name: "Zach Reese", f2Name: "Mickey Gall", status: 3, rounds: [{ round: 1, status: 3 }] },
  ]);
});

test("a Verdict bout's penalties come from its round models, and only when every copy reads the same", () => {
  const page = (copies: number[][]) => {
    const flat: unknown[] = [];
    const at = (value: unknown) => flat.push(value) - 1;
    const fighter = (first: string, last: string) => at({ fighterFirstName: at(first), fighterLastName: at(last) });
    for (const points of copies) {
      const rounds = [1, 2, 3].map(round => at({ roundNumber: at(round), roundStatus: at(3),
        fighter1PointDeduction: at(points[(round - 1) * 2]), fighter2PointDeduction: at(points[(round - 1) * 2 + 1]) }));
      at({ eventID: at(1956), fightNumber: at(4), fighter1: fighter("Grant", "Dawson"), fighter2: fighter("Nurullo", "Aliev"), rounds: at(["Reactive", at(rounds)]) });
    }
    at({ eventID: at(1956), fightNumber: at(5), fighter1: fighter("Colby", "Thicknesse"), fighter2: fighter("Asaf", "Chopurov"), rounds: at([]) });
    return `<html></html><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(flat)}</script>`;
  };
  const aliev = [0, 1, 0, 0, 0, 0];
  assert.deepEqual(parseVerdictDeductions(page([aliev, aliev]), 1956, 4), { f1Name: "Grant Dawson", f2Name: "Nurullo Aliev",
    rounds: [{ round: 1, deduct1: 0, deduct2: 1 }, { round: 2, deduct1: 0, deduct2: 0 }, { round: 3, deduct1: 0, deduct2: 0 }] });
  assert.equal(parseVerdictDeductions(page([aliev, [0, 0, 0, 0, 0, 0]]), 1956, 4), null, "copies that disagree");
  assert.equal(parseVerdictDeductions(page([[0, null as any, 0, 0, 0, 0]]), 1956, 4), null, "a round without a count");
  assert.equal(parseVerdictDeductions(page([aliev]), 1956, 5), null, "a bout with no rounds yet");
  assert.equal(parseVerdictDeductions(page([aliev]), 1955, 4), null, "another card's bout");
});

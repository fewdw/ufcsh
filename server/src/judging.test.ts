import test from "node:test";
import assert from "node:assert/strict";
import { fightIndex } from "./fight-index.ts";
import { crowdPick, officialsIndex, pick, resultPick } from "./officials.ts";
import {
  CLOSE_MARGIN, MIN_CROWD, TIEBREAKS, controversialList, edgesOf, fitModel, homeRecord, judgeDna, judging, matchupJudging,
  type Edge,
} from "./judging.ts";

const edge = (values: Partial<Edge>): Edge => ({ sig: 0, head: 0, kd: 0, td: 0, ctrl: 0, sub: 0, att: 0, ground: 0, ...values });
const tiebreak = (key: string) => TIEBREAKS.find((entry) => entry.key === key)!;

test("a tiebreak needs each fighter to have one side of it, and reads either corner", () => {
  const control = tiebreak("control");
  assert.equal(control.has(edge({ ctrl: 90, sig: -8 })), true);
  // The second corner had the control: the mirrored round, not this one.
  assert.equal(control.has(edge({ ctrl: -90, sig: 8 })), false);
  // Control and the strikes both: nothing pulled two ways.
  assert.equal(control.has(edge({ ctrl: 90, sig: 8 })), false);
  // Under the minute, or under five strikes, it isn't a clash.
  assert.equal(control.has(edge({ ctrl: 45, sig: -8 })), false);
  assert.equal(control.has(edge({ ctrl: 90, sig: -4 })), false);
  const damage = tiebreak("damage");
  assert.equal(damage.has(edge({ kd: 1, sig: -1 })), true);
  assert.equal(damage.has(edge({ head: 4, sig: -3 })), true);
  // A knockdown each way makes head strikes no tiebreaker.
  assert.equal(damage.has(edge({ kd: -1, head: 6, sig: -4 })), false);
});

test("the stats model recovers the weights it was given", () => {
  // Rounds decided by a known rule: a knockdown worth ten strikes, a minute of control two.
  const truth = [0.2, 0, 2, 0, 0.4, 0];
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = Array.from({ length: 6000 }, () => {
    const x = [Math.round((random() - 0.5) * 40), 0, Math.round((random() - 0.5) * 2), 0, (random() - 0.5) * 6, 0];
    const p = 1 / (1 + Math.exp(-x.reduce((sum, value, i) => sum + value * truth[i], 0)));
    return { x, y: random() < p ? 1 : 0 };
  });
  const weights = fitModel(rows, 0.01);
  assert.ok(Math.abs(weights[0] - 0.2) < 0.03, `strikes ${weights[0]}`);
  assert.ok(Math.abs(weights[2] - 2) < 0.4, `knockdowns ${weights[2]}`);
  assert.ok(Math.abs(weights[4] - 0.4) < 0.08, `control ${weights[4]}`);
});

test("the stats card agrees with real judges on most rounds and gives every round of a decision", () => {
  const state = judging();
  if (state.model.rounds < 1000) return;
  assert.ok(state.model.accuracy > 0.75, `accuracy ${state.model.accuracy}`);
  // More of everything that matters never makes a round less likely.
  assert.ok(state.model.weights.every((weight, i) => i === 1 || weight > 0), String(state.model.weights));
  for (const [id, entry] of [...state.fights].slice(-300)) {
    if (!entry.stats) continue;
    const fight = fightIndex().byId.get(id)!;
    assert.equal(entry.stats.rounds.length, fight.round ?? fight.scheduledRounds, id);
    assert.equal(entry.stats.f1 + entry.stats.f2 <= entry.stats.rounds.length, true);
  }
});

test("every controversial decision meets the rule the page states, from its own fan cards", () => {
  const list = controversialList(new URLSearchParams("sort=closest")) as any;
  const all: any[] = [];
  for (let offset = 0; offset < list.total; offset += list.limit) {
    all.push(...(controversialList(new URLSearchParams(`sort=closest&offset=${offset}`)) as any).rows);
  }
  assert.equal(all.length, list.total);
  for (let i = 1; i < all.length; i++) assert.ok(all[i].margin >= all[i - 1].margin, "closest first");
  const byId = new Map(officialsIndex().fights.map((officiated) => [officiated.fight.id, officiated]));
  for (const row of all) {
    const officiated = byId.get(row.fight_id)!;
    const fans = officiated.fans!;
    assert.ok(fans.cards >= MIN_CROWD, row.fight_id);
    assert.equal(row.margin, Math.round(Math.abs(fans.avg1 - fans.avg2) * 100) / 100);
    assert.equal(row.signals.close, row.margin < CLOSE_MARGIN);
    const result = resultPick(officiated.fight);
    assert.equal(row.signals.fans_other, result != null && crowdPick(fans) !== 0 && crowdPick(fans) !== result, row.fight_id);
    const won = [fans.rounds.filter((round) => round.avg1 > round.avg2).length, fans.rounds.filter((round) => round.avg2 > round.avg1).length];
    assert.deepEqual(row.fan_rounds, won);
    const byRounds = Math.sign(won[0] - won[1]);
    assert.equal(row.signals.rounds_total, byRounds !== 0 && Math.sign(fans.avg1 - fans.avg2) !== 0 && byRounds !== Math.sign(fans.avg1 - fans.avg2));
    assert.ok(row.signals.close || row.signals.fans_other || row.signals.rounds_total, `${row.fight_id} is not controversial`);
  }
});

test("a judge's list adds their cards against a clear crowd, and marks which card is theirs", () => {
  const judge = [...officialsIndex().judges.values()].sort((a, b) => b.fights.length - a.fights.length)[0];
  if (!judge) return;
  const list = controversialList(new URLSearchParams(`judge=${judge.slug}&show=against-fans&sort=widest`)) as any;
  for (const row of list.rows) {
    const card = row.cards[row.mine];
    assert.ok(card.slug === judge.slug, row.fight_id);
    const crowd = Math.abs(row.fans.avg1 - row.fans.avg2) < 0.1 ? 0 : Math.sign(row.fans.avg1 - row.fans.avg2);
    assert.ok(crowd !== 0 && pick(card.f1, card.f2) !== crowd, row.fight_id);
    assert.equal(row.against_fans, true);
  }
  assert.equal(controversialList(new URLSearchParams("judge=no-such-judge")), null);
});

test("a judge's control-versus-striking rate is a plain count of their own rounds", () => {
  const judge = [...officialsIndex().judges.values()].sort((a, b) => b.fights.length - a.fights.length)[0];
  if (!judge) return;
  let n = 0, control = 0;
  for (const officiated of judge.fights) {
    if (!officiated.fight.method?.endsWith("-DEC")) continue;
    const card = officiated.cards.find((entry) => entry.key === judge.key);
    const edges = edgesOf(officiated);
    for (const round of card?.rounds ?? []) {
      const roundEdge = edges[round.round - 1];
      const mine = pick(round.f1, round.f2);
      if (!roundEdge || !mine) continue;
      const side = tiebreak("control").has(roundEdge) ? 1 : tiebreak("control").has({ ...roundEdge, ctrl: -roundEdge.ctrl, sig: -roundEdge.sig } as Edge) ? -1 : 0;
      if (!side) continue;
      n += 1;
      if (mine === side) control += 1;
    }
  }
  const dna = judgeDna(judge.key).tiebreaks.find((entry) => entry.key === "control")!;
  assert.equal(dna.n, n);
  if (n) assert.equal(dna.rate, Math.round((control / n) * 1000) / 10);
  // Three notes at most, each with its evidence.
  const notes = judgeDna(judge.key).notes;
  assert.ok(notes.length <= 3);
  for (const note of notes) assert.match(note.detail, /\d/);
});

test("a matchup's judging names each judge in card order", () => {
  const list = controversialList(new URLSearchParams()) as any;
  const row = list.rows[0];
  if (!row) return;
  const judging = matchupJudging(row.fight_id)!;
  assert.equal(judging.judges.length, row.cards.length);
  judging.judges.forEach((judge, i) => { if (judge && row.cards[i].slug) assert.equal(judge.slug, row.cards[i].slug); });
  assert.equal(judging.controversy?.fight_id, row.fight_id);
});

test("home records count decisions with one fighter from the host country", () => {
  const record = homeRecord("USA");
  if (!record) return;
  assert.deepEqual(record.names, ["United States"]);
  assert.ok(record.won <= record.decisions && record.fans.home <= record.fans.n && record.stats.home <= record.stats.n);
  assert.ok(record.fans.won_against_fans <= record.fans.n);
  assert.equal(homeRecord("Atlantis"), null);
});

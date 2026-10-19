import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { fightIndex, type IndexedFight } from "./fight-index.ts";
import { crowdPick, isTitle, officialsIndex, pick, resultPick, type FanCard, type Officiated } from "./officials.ts";
import { confirmedDeductions } from "./point-deduction-rules.ts";
import {
  CLOSE_MARGIN, MIN_CROWD, TIEBREAKS, comebackLead, comebacksList, controversialList, controversyOf, edgesOf, fitModel, homeRecord, judgeDna, judging, matchupJudging, numbersOf,
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
    const penalized = confirmedDeductions(officiated.fight.row).items.length > 0;
    assert.equal(row.signals.rounds_total, !penalized && byRounds !== 0 && Math.sign(fans.avg1 - fans.avg2) !== 0 && byRounds !== Math.sign(fans.avg1 - fans.avg2));
    assert.ok(row.signals.close || row.signals.fans_other || row.signals.rounds_total, `${row.fight_id} is not controversial`);
  }
});

test("a referee penalty can explain more fan rounds and a different stats pick without controversial judging", () => {
  const fight = { method: "U-DEC", sides: [{ outcome: "win" }, { outcome: "loss" }], row: {
    deductions_json: JSON.stringify({ source: "MMA Decisions", sourceUrl: "https://mmadecisions.com/decision/1", items: [{ side: "f2", round: 3, points: 2, reason: "Low blow" }] }),
    judge_rounds_json: JSON.stringify({ judges: [{ judge: "A Judge", f1Score: 28, f2Score: 27,
      rounds: [{ round: 1, f1Score: 10, f2Score: 9 }, { round: 2, f1Score: 9, f2Score: 10 }, { round: 3, f1Score: 9, f2Score: 8 }] }] }),
  } } as unknown as IndexedFight;
  const fans: FanCard = { cards: 12134, source: "Verdict MMA", url: null, avg1: 28.02, avg2: 26.86,
    rounds: [{ round: 1, avg1: 9.45, avg2: 9.57 }, { round: 2, avg1: 9.19, avg2: 9.82 }, { round: 3, avg1: 9.39, avg2: 7.47 }] };
  const stats = { rounds: [], f1: 1, f2: 2, pick: -1 };
  const result = controversyOf({ fight, fans } as Officiated, stats)!;
  assert.equal(result.fansOther, false);
  assert.equal(result.roundsTotal, false);
  assert.equal(result.statsOther, false);
  assert.equal(result.controversial, false);
  // A genuine fan disagreement still counts after the penalty is applied.
  assert.equal(controversyOf({ fight, fans: { ...fans, avg1: 26, avg2: 28 } } as Officiated, stats)!.fansOther, true);
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

test("a sync check that finds nothing new keeps the judging state", () => {
  const before = judging();
  const event = db.prepare("SELECT id, venue_checked_at FROM events ORDER BY date DESC LIMIT 1").get() as { id: string; venue_checked_at: number | null };
  try {
    db.prepare("UPDATE events SET venue_checked_at = ? WHERE id = ?").run(Date.now(), event.id);
    assert.equal(judging(), before);
  } finally {
    db.prepare("UPDATE events SET venue_checked_at = ? WHERE id = ?").run(event.venue_checked_at, event.id);
  }
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

test("the list opens widest first, and each row's numbers add up round by round", () => {
  const list = controversialList(new URLSearchParams()) as any;
  assert.equal(list.filters.sort, "widest");
  for (let i = 1; i < list.rows.length; i++) assert.ok(list.rows[i].margin <= list.rows[i - 1].margin, "widest first");
  for (const row of list.rows) {
    const numbers = row.numbers;
    if (!numbers) continue;
    assert.deepEqual(numbers.sig, [0, 1].map((side) => numbers.rounds.reduce((sum: number, round: any) => sum + round.sig[side], 0)));
    if (numbers.ctrl) {
      assert.deepEqual(numbers.ctrl, [0, 1].map((side) => numbers.rounds.reduce((sum: number, round: any) => sum + round.ctrl[side], 0)));
      // Two fighters can't control more than the whole fight between them.
      assert.ok(numbers.ctrl[0] + numbers.ctrl[1] <= numbers.seconds + 5, row.fight_id);
    }
  }
});


test("comebacks require two completed rounds won and an actual points lead, in either corner", () => {
  const fight = { method: "KO/TKO", round: 4, sides: [{ outcome: "win" }, { outcome: "loss" }] } as IndexedFight;
  const fans = (scores: [number, number][], cards = MIN_CROWD): FanCard => ({
    cards, source: "test", url: null,
    avg1: scores.reduce((sum, round) => sum + round[0], 0),
    avg2: scores.reduce((sum, round) => sum + round[1], 0),
    rounds: scores.map(([avg1, avg2], i) => ({ round: i + 1, avg1, avg2 })),
  });
  const card = fans([[9, 10], [9, 10], [10, 9]]);
  assert.deepEqual(comebackLead({ fight, fans: card }), { loser: 1, won: [2, 1], lead: 1 });
  assert.deepEqual(comebackLead({ fight: { ...fight, sides: [...fight.sides].reverse() as IndexedFight["sides"] },
    fans: fans([[10, 9], [10, 9], [9, 10]]) }), { loser: 0, won: [2, 1], lead: 1 });
  // Two rounds won can still mean tied or behind after a 10–8 or 10–7.
  for (const lost of [8, 7]) assert.equal(comebackLead({ fight, fans: fans([[9, 10], [9, 10], [10, lost]]) }), null);
  assert.equal(comebackLead({ fight: { ...fight, round: 2 }, fans: fans([[9, 10]]) }), null);
  assert.equal(comebackLead({ fight, fans: fans([[9, 10], [9, 10]]) }), null, "missing round");
  assert.equal(comebackLead({ fight, fans: fans([[9, 10], [9, 10], [10, 9]], MIN_CROWD - 1) }), null);
  for (const method of ["U-DEC", "DQ", "Overturned"]) assert.equal(comebackLead({ fight: { ...fight, method }, fans: card }), null);
  assert.equal(comebackLead({ fight, fans: null }), null);
});

test("comeback lists rank rounds won then domination, paginate, and apply title and booked-round filters", () => {
  const first = comebacksList(new URLSearchParams());
  const rows = [...first.rows];
  for (let offset = first.limit; offset < first.total; offset += first.limit) {
    rows.push(...comebacksList(new URLSearchParams({ offset: String(offset) })).rows);
  }
  assert.equal(rows.length, first.total);
  assert.equal(new Set(rows.map(row => row.fight_id)).size, rows.length);
  for (const row of rows) {
    assert.ok(row.rounds_won[0] >= 2 && row.rounds_won[0] > row.rounds_won[1] && row.lead > 0);
    assert.equal(row.fans.rounds.length, row.round! - 1);
    assert.ok(row.fans.rounds.every(round => round.round < row.round!));
    assert.equal((row.leader === "f1" ? row.f1 : row.f2).outcome, "loss");
    const leading = row.leader === "f1" ? row.fans.avg1 - row.fans.avg2 : row.fans.avg2 - row.fans.avg1;
    assert.ok(Math.abs(leading - row.lead) < 0.001);
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], next = rows[i];
    assert.ok(prev.rounds_won[0] > next.rounds_won[0] || (prev.rounds_won[0] === next.rounds_won[0] && prev.lead >= next.lead));
  }
  for (const rounds of ["3", "5"]) {
    const filtered = comebacksList(new URLSearchParams({ rounds, title: "1" }));
    const expected = rows.filter(row => row.scheduled_rounds === Number(rounds) && isTitle(fightIndex().byId.get(row.fight_id)!));
    assert.equal(filtered.total, expected.length);
    assert.deepEqual(filtered.rows.map(row => row.fight_id), expected.slice(0, first.limit).map(row => row.fight_id));
  }
  if (rows.length) {
    const row = rows[0];
    const search = comebacksList(new URLSearchParams({ q: row.f1.name, from: row.date.slice(0, 4), to: row.date.slice(0, 4), division: row.division }));
    assert.ok(search.rows.some(found => found.fight_id === row.fight_id));
    assert.ok(search.rows.every(found => found.date.slice(0, 4) === row.date.slice(0, 4) && found.division === row.division));
  }
});

test("a finishing round's control uses its actual duration", () => {
  const round = { sig: 5, ctrl: 30 };
  const fight = { round: 3, elapsed: 660, sides: [{ rounds: [round, round, round] }, { rounds: [round, round, round] }] } as IndexedFight;
  const numbers = numbersOf(fight)!;
  assert.deepEqual(numbers.rounds.map(round => round.seconds), [300, 300, 60]);
  assert.equal(numbers.seconds, 660);
  assert.deepEqual(numbers.ctrl, [90, 90]);
});

test("home closing odds compare the same decisions and normalize both corners' prices", () => {
  const state = judging();
  let n = 0, favourites = 0, underdogs = 0, wins = 0, expected = 0;
  for (const { fight } of officialsIndex().fights) {
    const entry = state.fights.get(fight.id);
    if (entry?.country !== "USA" || !entry.home || !resultPick(fight)) continue;
    const [a, b] = fight.sides;
    if (a.prob == null || b.prob == null) continue;
    const chance = (entry.home > 0 ? a.prob : b.prob) / (a.prob + b.prob);
    n++;
    favourites += Number(chance > 0.5);
    underdogs += Number(chance < 0.5);
    wins += Number(resultPick(fight) === entry.home);
    expected += chance;
  }
  const record = homeRecord("USA");
  if (!record) return;
  const pct = (value: number) => n ? Math.round(value / n * 1000) / 10 : null;
  assert.deepEqual(record.odds, { n, favourites, underdogs, rate: pct(expected), favourite_rate: pct(favourites), judges_rate: pct(wins) });
});

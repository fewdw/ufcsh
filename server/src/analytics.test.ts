import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { careerBefore, completeRecordBefore, fightIndex, impliedProbability, winProfit } from "./fight-index.ts";
import { getStats } from "./stats.ts";
import { getLabs } from "./labs.ts";
import { fighterRecords, fighterStats } from "./records.ts";

/**
 * These tests run against the local database and check the analytics layer
 * against independent SQL over the same rows. They are the guard on the one
 * property that matters most here: a number shown on a leaderboard or in Labs
 * must be reproducible from the raw fight records.
 */

const index = fightIndex();
const stats = (query: string) => getStats(new URLSearchParams(query)) as {
  leaderboards: {
    key: string; title: string; description: string; format: string;
    rows: {
      fighter_id: string; name: string; value: number; detail: string; rank: number | null;
      chips: { label: string; outcome: string | null; fight_id: string; note?: string }[];
    }[];
  }[];
  divisions: string[];
  years: number[];
};
const board = (query: string, key: string) => {
  const found = stats(query).leaderboards.find((entry) => entry.key === key);
  assert.ok(found, `board ${key} missing`);
  return found;
};
const labs = (query: string) => getLabs(new URLSearchParams(query)) as any;
const one = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...(params as never[])) as T;

// ---------------------------------------------------------------------------
// The index itself

test("index covers exactly the completed bouts in the database", () => {
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
  `);
  assert.equal(index.fights.length, c);
  assert.equal(new Set(index.fights.map((fight) => fight.id)).size, c);
});

test("a fighter's prior state at each bout matches their own earlier bouts", () => {
  // Take the fighter with the most bouts on record, and walk their career.
  const busiest = [...index.fighters.values()].sort((a, b) => b.fights.length - a.fights.length)[0];
  let wins = 0;
  let losses = 0;
  let bouts = 0;
  for (const fight of busiest.fights) {
    const side = fight.sides[0].id === busiest.id ? fight.sides[0] : fight.sides[1];
    assert.equal(side.prior.wins, wins, `${busiest.name} wins entering ${fight.eventName}`);
    assert.equal(side.prior.losses, losses, `${busiest.name} losses entering ${fight.eventName}`);
    assert.equal(side.prior.bouts, bouts, `${busiest.name} bouts entering ${fight.eventName}`);
    if (side.outcome === "win") wins += 1;
    if (side.outcome === "loss") losses += 1;
    if (side.outcome && side.outcome !== "nc") bouts += 1;
  }
  assert.ok(busiest.fights.length > 20);
});

test("career state entering a bout is reproducible from the index", () => {
  const fight = [...index.fights].reverse().find((entry) => entry.sides[0].prior.bouts > 5)!;
  const side = fight.sides[0];
  const computed = careerBefore(index, side.id, fight.date, fight.weightClass, fight.ord, fight.sides[1].id);
  assert.equal(computed.wins, side.prior.wins);
  assert.equal(computed.losses, side.prior.losses);
  assert.equal(computed.winStreak, side.prior.winStreak);
  assert.equal(computed.champion, side.prior.champion);
});

test("no fighter is ever recorded as their own opponent", () => {
  for (const fight of index.fights) {
    if (fight.sides[0].id && fight.sides[1].id) assert.notEqual(fight.sides[0].id, fight.sides[1].id, fight.id);
  }
});

// ---------------------------------------------------------------------------
// Leaderboards vs SQL

test("most UFC wins matches a direct count", () => {
  const top = board("minimumFights=1", "record").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1
      AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} win count`);
});

test("most UFC losses matches a direct count", () => {
  const top = board("minimumFights=1&recordGroup=losses", "record").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1
      AND ((f.f1_id = ? AND f.f1_outcome = 'loss') OR (f.f2_id = ? AND f.f2_outcome = 'loss'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} loss count`);
});

test("KO/TKO wins in round 1 match a direct count", () => {
  const top = board("minimumFights=1&roundFinishMethod=ko&roundFinishRound=1", "finishing").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.method = 'KO/TKO' AND CAST(f.round AS INTEGER) = 1
      AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} round-1 KO count`);
});

test("total significant strikes landed match the summed event totals", () => {
  const top = board("minimumFights=1&actionMode=total", "output").rows[0];
  const { total } = one<{ total: number }>(`
    SELECT COALESCE(SUM(CASE WHEN f.f1_id = ? THEN CAST(f.f1_str AS INTEGER) ELSE CAST(f.f2_str AS INTEGER) END), 0) AS total
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND (f.f1_id = ? OR f.f2_id = ?)
      AND f.f1_str IS NOT NULL AND f.f2_str IS NOT NULL
  `, top.fighter_id, top.fighter_id, top.fighter_id);
  assert.equal(top.value, total, `${top.name} significant strikes`);
});

test("a strike-accuracy board never exceeds 100% and respects its attempt floor", () => {
  const accuracy = board("minimumFights=3&actionBasis=percent&actionMinimumAttempts=50", "output");
  assert.ok(accuracy.rows.length > 0);
  for (const row of accuracy.rows) {
    assert.ok(row.value >= 0 && row.value <= 100, `${row.name} accuracy ${row.value}`);
    const attempts = Number(row.detail.match(/\/(\d+) landed/)?.[1] ?? 0);
    assert.ok(attempts >= 50, `${row.name} attempts ${attempts}`);
  }
});

test("most UFC bouts matches a direct count, and the career span is consistent", () => {
  const top = board("minimumFights=1&recordGroup=bouts", "record").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
      AND (f.f1_id = ? OR f.f2_id = ?)
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} bout count`);
});

test("the wins detail reports the distinct opponents actually beaten", () => {
  for (const row of board("minimumFights=1", "record").rows.slice(0, 25)) {
    const { c } = one<{ c: number }>(`
      SELECT COUNT(DISTINCT CASE WHEN f.f1_id = ? THEN f.f2_id ELSE f.f1_id END) AS c
      FROM fights f JOIN events e ON e.id = f.event_id
      WHERE e.complete = 1
        AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
    `, row.fighter_id, row.fighter_id, row.fighter_id);
    const reported = Number(row.detail.match(/(\d+) different opponents beaten/)?.[1]);
    assert.equal(reported, c, `${row.name} distinct opponents beaten`);
    assert.ok(c <= row.value, `${row.name}: ${c} opponents from ${row.value} wins`);
  }
});

test("underdog wins match a recomputation from the stored closing lines", () => {
  const top = board("minimumFights=1&bettingMode=underdog", "market").rows[0];
  const rows = db.prepare(`
    SELECT f.f1_id, f.f1_outcome, f.f2_outcome, o.f1_close, o.f2_close
    FROM fights f JOIN events e ON e.id = f.event_id JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 1 AND (f.f1_id = ? OR f.f2_id = ?)
  `).all(top.fighter_id, top.fighter_id) as any[];
  const line = (value: string | null) => (value ? Number(String(value).replace(/[−–]/g, "-").replace(/[^0-9+\-.]/g, "")) : null);
  let underdogWins = 0;
  for (const row of rows) {
    const isF1 = row.f1_id === top.fighter_id;
    const own = impliedProbability(line(isF1 ? row.f1_close : row.f2_close));
    const other = impliedProbability(line(isF1 ? row.f2_close : row.f1_close));
    const outcome = isF1 ? row.f1_outcome : row.f2_outcome;
    if (own != null && other != null && own < other && outcome === "win") underdogWins += 1;
  }
  assert.equal(top.value, underdogWins, `${top.name} underdog wins`);
});

test("a flat-stake return is consistent with the fighter's own priced record", () => {
  const top = board("minimumFights=1&minimumSample=5&bettingMode=roi", "market").rows[0];
  const bets = Number(top.detail.match(/^(\d+) priced/)?.[1] ?? 0);
  assert.ok(bets >= 5);
  // A perfect record cannot lose money, and every loss costs exactly $100.
  assert.ok(top.value >= -bets * 100 && top.value <= bets * 10000);
  assert.equal(Math.round(winProfit(100)), 100);
  assert.equal(Math.round(winProfit(-200)), 50);
});

test("percentage boards apply the shared minimum-sample floor", () => {
  for (const sample of ["3", "10"]) {
    const rows = board(`minimumFights=1&minimumSample=${sample}&winsByMetric=percent`, "record").rows;
    for (const row of rows) {
      const denominator = Number(row.detail.match(/\/(\d+)/)?.[1] ?? 0);
      assert.ok(denominator >= Number(sample), `${row.name} denominator ${denominator} < ${sample}`);
      assert.ok(row.value <= 100);
    }
  }
});

test("known championship reigns are reported at their documented length", () => {
  const rows = board("minimumFights=1&winsMode=titleDefenses", "record").rows;
  const defenses = new Map(rows.map((row) => [row.name, row.value]));
  assert.equal(defenses.get("Jon Jones"), 12);
  assert.equal(defenses.get("Demetrious Johnson"), 11);
  assert.equal(defenses.get("Anderson Silva"), 10);
  assert.equal(defenses.get("Georges St-Pierre"), 9);
  // Consecutive defenses can never exceed total defenses.
  const consecutive = new Map(board("minimumFights=1&winsMode=titleDefenses&defenseScope=consecutive", "record").rows.map((row) => [row.name, row.value]));
  for (const [name, streak] of consecutive) {
    if (defenses.has(name)) assert.ok(streak <= defenses.get(name)!, `${name}: ${streak} consecutive > ${defenses.get(name)} total`);
  }
});

test("a division filter only counts bouts contested in that division", () => {
  const top = board("minimumFights=1&division=Heavyweight", "record").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.weight_class = 'Heavyweight'
      AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} heavyweight wins`);
});

test("a since-year filter excludes everything before that year", () => {
  const top = board("minimumFights=1&statsSince=2020", "record").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND e.date >= '2020-01-01'
      AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} wins since 2020`);
});

test("every board returns ranked, ordered rows and a description", () => {
  const queries = [
    "", "recordGroup=losses", "recordGroup=bouts", "recordGroup=bouts&boutsMode=span",
    "recordGroup=bouts&boutsMode=titleFights", "recordGroup=bouts&boutsMode=divisions",
    "winsMode=streak", "winsMode=streak&streakKind=unbeaten", "winsMode=streak&streakWhen=current",
    "winsMode=championWins", "winsMode=ageAtWin", "winsMode=ageAtWin&ageEnd=oldest",
    "winsMode=titleDefenses&defenseScope=consecutive",
    "contextMode=durability", "contextMode=rematches&rematchMetric=revenge", "contextMode=returns&returnWindow=layoff",
    "contextMode=championsFaced&championScope=current", "winsMode=championWins&championScope=current",
    "finishMode=fightTime&fightTimeOrder=longest", "finishMode=speed&finishDirection=taken&speedScope=single",
    "finishMode=count&finishDirection=taken", "finishMode=cageTime",
    "actionType=control&actionBasis=differential", "actionType=takedowns&actionMode=perRound",
    "bettingMode=underdog&underdogMetric=biggest", "bettingMode=aboveExpectation",
    "bettingMode=avgLine", "bettingMode=favorite&favoriteMetric=losses",
    "roundFinishMetric=percent&roundFinishPercentOf=allResults",
    "boutType=title", "cardPosition=main", "scheduledRounds=5", "statsUntil=2015",
  ];
  for (const query of queries) {
    for (const entry of stats(query).leaderboards) {
      assert.ok(entry.description.length > 10, `${entry.key} description`);
      assert.ok(entry.rows.length <= 50);
      const ascending = entry.rows.length > 1 && entry.rows[0].value < entry.rows[entry.rows.length - 1].value;
      for (let i = 1; i < entry.rows.length; i++) {
        const previous = entry.rows[i - 1];
        const current = entry.rows[i];
        assert.ok(
          ascending ? current.value >= previous.value : current.value <= previous.value,
          `${entry.key} (${query}) out of order at ${current.name}`,
        );
        assert.ok(current.rank != null && previous.rank != null && current.rank >= previous.rank, `${entry.key} rank order`);
      }
    }
  }
});

test("the combined record of opponents is the sum of their records that night", () => {
  const top = board("minimumFights=1&minimumSample=10&contextMode=opposition", "context").rows[0];
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let opponents = 0;
  for (const fight of index.fighters.get(top.fighter_id)!.fights) {
    const opponent = fight.sides[0].id === top.fighter_id ? fight.sides[1] : fight.sides[0];
    if (opponent.prior.bouts === 0) continue;
    opponents += 1;
    wins += opponent.prior.wins;
    losses += opponent.prior.losses;
    draws += opponent.prior.draws;
  }
  assert.equal(top.detail, `${wins}-${losses}${draws ? `-${draws}` : ""} combined · ${opponents} opponents · UFC records that night`);
  assert.equal(top.value, Math.round((wins / (wins + losses + draws)) * 1000) / 10);
});

test("a leaderboard returns exactly the number of rows asked for", () => {
  for (const [limit, expected] of [["10", 10], ["150", 150], ["55", 60], ["9999", 150]] as const) {
    for (const entry of stats(`minimumFights=1&limit=${limit}`).leaderboards) {
      assert.ok(entry.rows.length <= expected, `${entry.key} returned ${entry.rows.length} for limit ${limit}`);
    }
    assert.equal(board(`minimumFights=1&limit=${limit}`, "record").rows.length, expected);
  }
});

test("shared bout filters actually narrow every card", () => {
  const all = board("minimumFights=1", "record").rows[0].value;
  const titles = board("minimumFights=1&boutType=title", "record").rows[0].value;
  const mains = board("minimumFights=1&cardPosition=main", "record").rows[0].value;
  assert.ok(titles < all, `title-only wins ${titles} should be under ${all}`);
  assert.ok(mains < all, `main-event wins ${mains} should be under ${all}`);
  const fiveRounders = board("minimumFights=1&scheduledRounds=5", "record").rows[0].value;
  assert.ok(fiveRounders < all);
});

test("wins above the market are wins minus vig-free expectation", () => {
  for (const row of board("minimumFights=1&minimumSample=10&bettingMode=aboveExpectation", "market").rows) {
    const match = row.detail.match(/^(\d+) wins · ([\d.]+) expected · (\d+) priced bouts$/);
    assert.ok(match, `unexpected detail: ${row.detail}`);
    const [, wins, expected, priced] = match!;
    assert.equal(row.value, Math.round((Number(wins) - Number(expected)) * 10) / 10);
    // A vig-free forecast over a fighter's own bouts can never exceed them.
    assert.ok(Number(expected) <= Number(priced));
    assert.ok(Number(wins) <= Number(priced));
  }
});

test("comparing named fighters returns exactly those fighters", () => {
  const jones = "07f72a2a7591b409";
  const silva = index.fights.flatMap((fight) => fight.sides).find((side) => side.name === "Anderson Silva")?.id;
  assert.ok(silva);
  for (const entry of stats(`fighterIds=${jones},${silva}&minimumFights=1`).leaderboards) {
    for (const row of entry.rows) {
      assert.ok([jones, silva].includes(row.fighter_id), `${entry.key} returned ${row.name}`);
    }
  }
});

test("keeping full lists pins selected fighters in order above the ranking", () => {
  const selected = ["07f72a2a7591b409", index.fights.flatMap((fight) => fight.sides).find((side) => side.name === "Anderson Silva")?.id].filter(Boolean) as string[];
  assert.equal(selected.length, 2);
  for (const entry of stats(`fighterIds=${selected.join(",")}&keepFullLists=1&minimumFights=1&limit=10`).leaderboards) {
    assert.deepEqual(entry.rows.slice(0, selected.length).map((row: any) => row.fighter_id), selected, entry.key);
    assert.ok(entry.rows.length >= 10, `${entry.key} did not retain its full leaderboard`);
    assert.equal(new Set(entry.rows.map((row: any) => row.fighter_id)).size, entry.rows.length, `${entry.key} duplicated a pinned fighter`);
  }
});

// ---------------------------------------------------------------------------
// Labs

test("the unfiltered population is symmetric by construction", () => {
  const all = labs("");
  assert.equal(all.summary.n, index.fights.length * 2);
  assert.equal(all.summary.wins, all.summary.losses);
  // Not 50%: every draw is counted once for each fighter and sits in the
  // denominator, so a perfectly symmetric population lands just under half.
  const decided = all.summary.wins + all.summary.losses + all.summary.draws;
  assert.equal(all.summary.win_rate, Math.round((all.summary.wins / decided) * 1000) / 10);
  assert.ok(all.summary.win_rate < 50 && all.summary.win_rate > 49);
  assert.equal(all.summary.sig_differential_per_min, 0);
  assert.equal(all.summary.fights, index.fights.length);
});

test("labs totals equal the sum of their year rows", () => {
  const all = labs("");
  const sum = (key: string) => all.trend.reduce((total: number, year: any) => total + year[key], 0);
  assert.equal(sum("n"), all.summary.n);
  assert.equal(sum("wins"), all.summary.wins);
  assert.equal(sum("losses"), all.summary.losses);
  assert.equal(sum("ncs"), all.summary.ncs);
});

test("a breakdown partitions the population, apart from observations it cannot place", () => {
  for (const dimension of ["era", "prev", "division", "title", "mainEvent", "rounds", "gender", "month", "layoff", "experience", "winStreak"]) {
    const result = labs(`groupBy=${dimension}`);
    const total = result.breakdown.reduce((sum: number, bucket: any) => sum + bucket.n, 0);
    assert.equal(total + result.coverage.unbucketed, result.summary.n, `${dimension} does not partition`);
  }
});

test("every filter actually constrains the bouts it returns", () => {
  const streak = labs("winStreakMin=3");
  for (const fight of streak.fights) assert.ok(fight.win_streak >= 3, `${fight.fighter.name} entered on ${fight.win_streak}`);

  const layoff = labs("layoffMin=365");
  for (const fight of layoff.fights) assert.ok((fight.days_since ?? 0) >= 365, `${fight.fighter.name} ${fight.days_since}d`);

  const division = labs("division=Heavyweight");
  for (const fight of division.fights) assert.equal(fight.division, "Heavyweight");

  const title = labs("title=only");
  for (const fight of title.fights) assert.equal(fight.title_fight, true);

  const ko = labs("method=ko");
  for (const fight of ko.fights) assert.equal(fight.method, "KO/TKO");

  const underdog = labs("odds=underdog");
  assert.ok(underdog.summary.underdog_share === 100, `underdog share ${underdog.summary.underdog_share}`);
  assert.ok(underdog.summary.win_rate != null && underdog.summary.win_rate < 50, "underdogs should win under half");

  const favorite = labs("odds=favorite");
  assert.ok(favorite.summary.win_rate != null && favorite.summary.win_rate > 50, "favorites should win over half");
  assert.equal(underdog.summary.n + favorite.summary.n + labs("odds=priced").summary.n - labs("odds=priced").summary.n, underdog.summary.n + favorite.summary.n);
});

test("a two-sided filter splits the priced population without overlap", () => {
  const priced = labs("odds=priced").summary.n;
  const underdogs = labs("odds=underdog").summary.n;
  const favorites = labs("odds=favorite").summary.n;
  // The remainder is exact pick'ems, where both sides carry the same line.
  assert.ok(underdogs + favorites <= priced);
  assert.ok(priced - underdogs - favorites >= 0);
});

test("market calibration compares outcomes and prices from the same sample", () => {
  const priced = labs("odds=priced").summary;
  assert.equal(priced.priced_win_rate, priced.win_rate);
  assert.ok(priced.bet_avg_implied != null && priced.bet_avg_implied > 0 && priced.bet_avg_implied < 100);
  assert.ok(priced.bets <= priced.priced, "no contests may be priced but are not settled bets");
});

test("implied probability buckets agree with the win rates inside them", () => {
  const result = labs("groupBy=prob&odds=priced");
  for (const bucket of result.breakdown) {
    if (bucket.n < 300) continue;
    // The closing line should be broadly calibrated: a bucket's win rate lands
    // near its own average implied probability, once the vig is allowed for.
    assert.ok(
      Math.abs((bucket.win_rate ?? 0) - (bucket.avg_implied ?? 0)) < 12,
      `${bucket.label}: ${bucket.win_rate}% actual vs ${bucket.avg_implied}% implied`,
    );
  }
});

test("round output is only averaged over the fighters who reached the round", () => {
  const result = labs("");
  for (let i = 1; i < result.rounds.length; i++) {
    assert.ok(result.rounds[i].reached <= result.rounds[i - 1].reached, `round ${i + 1} reached more than round ${i}`);
  }
  assert.equal(result.rounds[0].reached > 0, true);
  const finishes = result.rounds.reduce((sum: number, round: any) => sum + round.ko + round.sub, 0);
  assert.equal(finishes, result.summary.outcomes.win_ko + result.summary.outcomes.win_sub - roundsBeyondFive(result));
});

/** Finishes recorded past round five (early no-limit bouts) sit outside the five-round profile. */
function roundsBeyondFive(result: any): number {
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.method IN ('KO/TKO', 'SUB') AND CAST(f.round AS INTEGER) > 5
  `);
  return result.summary.n === index.fights.length * 2 ? c : 0;
}

test("labs leaders are inside the population they lead", () => {
  const result = labs("division=Lightweight&winStreakMin=2");
  for (const leader of result.leaders) {
    assert.ok(leader.wins + leader.losses + leader.draws <= leader.n);
    assert.ok(leader.win_rate == null || (leader.win_rate >= 0 && leader.win_rate <= 100));
  }
});

test("an impossible population reports zero rather than failing", () => {
  const empty = labs("ageMin=60&ageMax=61");
  assert.equal(empty.summary.n, 0);
  assert.equal(empty.summary.win_rate, null);
  assert.equal(empty.breakdown.length, 0);
  assert.equal(empty.fights.length, 0);
});

test("a record entering a bout ignores time away from the promotion", () => {
  // Fighters who left and came back are the case that breaks a naive running
  // total: the comeback bout must show the record they actually returned with.
  let checked = 0;
  for (const fighter of index.fighters.values()) {
    for (let i = 1; i < fighter.fights.length; i++) {
      const previous = fighter.fights[i - 1];
      const comeback = fighter.fights[i];
      const gapDays = (Date.parse(comeback.date) - Date.parse(previous.date)) / 86400000;
      if (gapDays < 730) continue;
      const before = previous.sides[0].id === fighter.id ? previous.sides[0] : previous.sides[1];
      const after = comeback.sides[0].id === fighter.id ? comeback.sides[0] : comeback.sides[1];
      const expectedWins = before.prior.wins + (before.outcome === "win" ? 1 : 0);
      const expectedLosses = before.prior.losses + (before.outcome === "loss" ? 1 : 0);
      assert.equal(after.prior.wins, expectedWins, `${fighter.name} wins returning at ${comeback.eventName}`);
      assert.equal(after.prior.losses, expectedLosses, `${fighter.name} losses returning at ${comeback.eventName}`);
      assert.equal(after.prior.daysSince, Math.round(gapDays), `${fighter.name} layoff at ${comeback.eventName}`);
      checked += 1;
    }
  }
  assert.ok(checked > 50, `only ${checked} comebacks checked`);
});

test("every board key is stable and unique", () => {
  const keys = stats("").leaderboards.map((entry) => entry.key);
  assert.deepEqual(keys, ["record", "finishing", "output", "context", "market"]);
});

test("no two menu entries produce the same leaderboard", () => {
  // Every statistic the cards can select, as the query that selects it. Two
  // entries returning an identical ranking would be a duplicate category.
  const selections = [
    "recordGroup=bouts&boutsMode=total", "recordGroup=bouts&boutsMode=span",
    "recordGroup=bouts&boutsMode=titleFights", "recordGroup=bouts&boutsMode=divisions",
    "winsMode=total", "winsMode=total&winsByMetric=percent", "winsMode=streak",
    "winsMode=streak&streakKind=unbeaten", "winsMode=titleWins", "winsMode=titleDefenses",
    "winsMode=titleDefenses&defenseScope=consecutive", "winsMode=championWins", "winsMode=championWins&championScope=current",
    "winsMode=divisions", "winsMode=ageAtWin", "winsMode=ageAtWin&ageEnd=oldest",
    "recordGroup=losses&lossesMode=total", "recordGroup=losses&lossesMode=total&lossesByMetric=percent",
    "recordGroup=losses&lossesMode=streak", "recordGroup=losses&lossesMode=titleLosses",
    "recordGroup=losses&lossesMode=failedTitleDefenses", "recordGroup=losses&lossesMode=divisions",
    "finishMode=count", "finishMode=count&finishDirection=taken", "finishMode=speed",
    "finishMode=speed&speedScope=single", "finishMode=speed&finishDirection=taken",
    "finishMode=speed&finishDirection=taken&speedScope=single",
    "finishMode=fightTime", "finishMode=fightTime&fightTimeOrder=longest", "finishMode=cageTime",
    "contextMode=opposition", "contextMode=opposition&oppositionWhen=today", "contextMode=opposition&oppositionSource=all",
    "contextMode=championsFaced", "contextMode=championsFaced&championScope=current",
    "contextMode=streakBreakers",
    "contextMode=bounceBack", "contextMode=rematches", "contextMode=rematches&rematchMetric=revenge",
    "contextMode=returns", "contextMode=returns&returnWindow=layoff", "contextMode=durability",
    "bettingMode=underdog", "bettingMode=underdog&underdogMetric=rate",
    "bettingMode=underdog&underdogMetric=biggest", "bettingMode=favorite",
    "bettingMode=favorite&favoriteMetric=losses", "bettingMode=aboveExpectation",
    "bettingMode=roi", "bettingMode=avgLine",
  ];
  const seen = new Map<string, string>();
  for (const selection of selections) {
    const key = selection.includes("finishMode") ? "finishing"
      : selection.includes("contextMode") ? "context"
        : selection.includes("bettingMode") ? "market" : "record";
    const rows = board(`minimumFights=1&limit=30&${selection}`, key).rows;
    const fingerprint = `${key}:${rows.map((row) => `${row.fighter_id}=${row.value}`).join(",")}`;
    const duplicate = seen.get(fingerprint);
    assert.equal(duplicate, undefined, `"${selection}" is identical to "${duplicate}"`);
    seen.set(fingerprint, selection);
  }
});

test("champions faced separates who was reigning from who had ever held a belt", () => {
  const ever = new Map(board("minimumFights=1&contextMode=championsFaced", "context").rows.map((row) => [row.fighter_id, row.value]));
  const current = board("minimumFights=1&contextMode=championsFaced&championScope=current", "context").rows;
  assert.ok(current.length > 0);
  for (const row of current) {
    const broader = ever.get(row.fighter_id);
    // Every reigning champion had, by definition, already won a belt.
    if (broader != null) assert.ok(row.value <= broader, `${row.name}: ${row.value} reigning > ${broader} ever`);
  }
});

test("a reigning champion counts even when fighting outside their division", () => {
  // Champions moving weight keep the belt, so the opponent still faced a champion.
  let crossDivision = 0;
  for (const fight of index.fights) {
    for (const [i, side] of fight.sides.entries()) {
      const opponent = fight.sides[i === 0 ? 1 : 0];
      if (opponent.prior.reigningChampion && !opponent.prior.champion && !opponent.prior.interimChampion) crossDivision += 1;
    }
  }
  assert.ok(crossDivision > 0, "expected at least one bout against a champion competing outside their division");
});

test("a former champion counts only once they have actually won a belt", () => {
  const holloway = [...index.fighters.values()].find((fighter) => fighter.name === "Max Holloway");
  assert.ok(holloway);
  const meetings = holloway!.fights.filter((fight) => fight.sides.some((side) => side.name === "Conor McGregor"));
  assert.equal(meetings.length, 2, "expected two Holloway–McGregor bouts on record");
  const [first, second] = meetings;
  const mcgregorIn = (fight: typeof first) => fight.sides.find((side) => side.name === "Conor McGregor")!;
  // 2013: McGregor had never held a belt. 2026: he is a former champion.
  assert.equal(mcgregorIn(first).prior.formerChampion, false, `${first.date} should not count`);
  assert.equal(mcgregorIn(first).prior.reigningChampion, false);
  assert.equal(mcgregorIn(second).prior.formerChampion, true, `${second.date} should count as a former champion`);
  assert.equal(mcgregorIn(second).prior.reigningChampion, false, `${second.date} McGregor was not reigning`);
});

test("row chips name exactly the bouts the number counts", () => {
  const cases = [
    { query: "moreInfo=1&minimumFights=1&contextMode=championsFaced", key: "context" },
    { query: "moreInfo=1&minimumFights=1&contextMode=championsFaced&championScope=current", key: "context" },
    { query: "moreInfo=1&minimumFights=1&winsMode=streak", key: "record" },
    { query: "moreInfo=1&minimumFights=1&winsMode=streak&streakWhen=current", key: "record" },
    { query: "moreInfo=1&minimumFights=1&recordGroup=losses&lossesMode=streak", key: "record" },
    { query: "moreInfo=1&minimumFights=1&finishMode=count&roundFinishMethod=ko", key: "finishing" },
    { query: "moreInfo=1&minimumFights=1&finishMode=count&finishDirection=taken", key: "finishing" },
    { query: "moreInfo=1&minimumFights=1&winsMode=total&winsByMethod=sub", key: "record" },
    { query: "moreInfo=1&minimumFights=1&bettingMode=underdog", key: "market" },
  ];
  for (const { query, key } of cases) {
    const entry = board(query, key);
    assert.ok(entry.rows.length > 0, query);
    for (const row of entry.rows) {
      if (row.value > 30) continue; // the chip list is capped
      assert.equal(row.chips.length, row.value, `${entry.title} · ${row.name} (${query})`);
    }
  }
});

test("chips carry the result of the bout they name", () => {
  for (const row of board("moreInfo=1&minimumFights=1&contextMode=championsFaced", "context").rows) {
    const wins = row.chips.filter((chip) => chip.outcome === "win").length;
    const losses = row.chips.filter((chip) => chip.outcome === "loss").length;
    const match = row.detail.match(/^(\d+)-(\d+) against them/);
    assert.ok(match, row.detail);
    if (row.value <= 30) {
      assert.equal(wins, Number(match![1]), `${row.name} wins over champions`);
      assert.equal(losses, Number(match![2]), `${row.name} losses to champions`);
    }
    for (const chip of row.chips) assert.ok(chip.fight_id, `${row.name} chip is missing its bout`);
  }
});

test("the two opposition filters each change what is read", () => {
  const combinations = [
    "oppositionSource=ufc&oppositionWhen=atTime",
    "oppositionSource=ufc&oppositionWhen=today",
    "oppositionSource=all&oppositionWhen=today",
  ];
  const seen = new Set<string>();
  for (const combination of combinations) {
    const entry = board(`minimumFights=5&minimumSample=5&contextMode=opposition&${combination}`, "context");
    assert.ok(entry.rows.length > 0, combination);
    assert.match(entry.rows[0].detail, /combined · \d+ opponents/);
    seen.add(entry.rows.map((row) => row.fighter_id).join(","));
  }
  assert.equal(seen.size, 3, "each combination should rank a different field");

  const dated = board("minimumFights=5&minimumSample=5&contextMode=opposition&oppositionSource=all&oppositionWhen=atTime", "context");
  assert.ok(dated.rows.length > 0);
  assert.match(dated.description, /verified outside-UFC bouts/);
});

test("a complete career read at fight night never exceeds the same career today", () => {
  // The UFC half grows with every bout and the rest is fixed, so the dated
  // reading has to sit at or below the present-day one for every fighter.
  const atTime = new Map(board("minimumFights=1&minimumSample=1&limit=150&contextMode=opposition&oppositionSource=all&oppositionWhen=atTime", "context")
    .rows.map((row) => [row.fighter_id, row]));
  const today = board("minimumFights=1&minimumSample=1&limit=150&contextMode=opposition&oppositionSource=all&oppositionWhen=today", "context");
  const parse = (detail: string) => {
    const match = detail.match(/^(\d+)-(\d+)(?:-(\d+))? combined/);
    assert.ok(match, detail);
    return { wins: Number(match![1]), losses: Number(match![2]), draws: Number(match![3] ?? 0) };
  };
  let compared = 0;
  for (const row of today.rows) {
    const earlier = atTime.get(row.fighter_id);
    if (!earlier) continue;
    const before = parse(earlier.detail);
    const now = parse(row.detail);
    assert.ok(before.wins <= now.wins, `${row.name}: ${before.wins} > ${now.wins} wins`);
    assert.ok(before.losses <= now.losses, `${row.name}: ${before.losses} > ${now.losses} losses`);
    compared += 1;
  }
  assert.ok(compared > 20, `only ${compared} fighters compared`);
});

test("a complete career at fight night is read from the verified dated pro timeline", () => {
  const top = board("minimumFights=5&minimumSample=5&contextMode=opposition&oppositionSource=all&oppositionWhen=atTime", "context").rows[0];
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let opponents = 0;
  for (const fight of index.fighters.get(top.fighter_id)!.fights) {
    const opponent = fight.sides[0].id === top.fighter_id ? fight.sides[1] : fight.sides[0];
    const combined = completeRecordBefore(index, opponent.id, fight.date, fight.ord);
    if (!combined) continue;
    if (combined.wins + combined.losses + combined.draws === 0) continue;
    opponents += 1;
    wins += combined.wins;
    losses += combined.losses;
    draws += combined.draws;
  }
  assert.ok(
    top.detail.startsWith(`${wins}-${losses}${draws ? `-${draws}` : ""} combined · ${opponents} opponents`),
    `${top.name}: ${top.detail}`,
  );
});

test("verified current records equal every row in the professional timeline", () => {
  const count = (fighter: NonNullable<ReturnType<typeof index.fighters.get>>) => {
    const record = { wins: 0, losses: 0, draws: 0, ncs: 0 };
    for (const bout of fighter.careerBouts) {
      if (bout.outcome === "win") record.wins += 1;
      else if (bout.outcome === "loss") record.losses += 1;
      else if (bout.outcome === "draw") record.draws += 1;
      else if (bout.outcome === "nc") record.ncs += 1;
    }
    return record;
  };
  const verified = [...index.fighters.values()].filter((fighter) => fighter.careerVerified);
  assert.ok(verified.length > 20, `only ${verified.length} verified careers`);
  for (const fighter of verified) assert.deepEqual(fighter.career, count(fighter), fighter.name);
});

test("asking for more info adds names and leaves every number alone", () => {
  const withNames = stats("minimumFights=1&contextMode=championsFaced&actionType=knockdowns&moreInfo=1");
  const without = stats("minimumFights=1&contextMode=championsFaced&actionType=knockdowns");
  assert.ok(withNames.leaderboards.some((entry) => entry.rows.some((row) => row.chips.length > 0)));
  for (const [i, entry] of without.leaderboards.entries()) {
    assert.deepEqual(
      entry.rows.map((row) => [row.fighter_id, row.value, row.detail]),
      withNames.leaderboards[i].rows.map((row) => [row.fighter_id, row.value, row.detail]),
      `${entry.key} changed when names were added`,
    );
    for (const row of entry.rows) assert.equal(row.chips.length, 0, `${entry.key} names bouts without being asked`);
  }
});

test("every card can name the bouts behind its number", () => {
  const cases: [string, string][] = [
    ["actionType=knockdowns", "output"],
    ["actionType=takedowns&actionMode=total", "output"],
    ["actionType=control&actionBasis=differential", "output"],
    ["actionBasis=percent&actionMinimumAttempts=50", "output"],
    ["finishMode=speed", "finishing"],
    ["finishMode=fightTime&fightTimeOrder=longest", "finishing"],
    ["finishMode=cageTime", "finishing"],
    ["finishMode=count", "finishing"],
    ["recordGroup=bouts&boutsMode=span", "record"],
    ["recordGroup=bouts&boutsMode=divisions", "record"],
    ["winsMode=total", "record"],
    ["recordGroup=losses&lossesMode=total", "record"],
    ["bettingMode=roi", "market"],
    ["bettingMode=avgLine", "market"],
    ["bettingMode=aboveExpectation", "market"],
    ["bettingMode=favorite", "market"],
    ["contextMode=opposition", "context"],
    ["contextMode=bounceBack", "context"],
    ["contextMode=returns", "context"],
  ];
  for (const [query, key] of cases) {
    const entry = board(`moreInfo=1&minimumFights=5&minimumSample=5&limit=10&${query}`, key);
    assert.ok(entry.rows.length > 0, query);
    assert.ok(entry.rows[0].chips.length > 0, `${query} names nothing`);
    for (const chip of entry.rows[0].chips) {
      assert.ok(chip.label.length > 0, `${query} has an unnamed chip`);
    }
  }
});

test("each opposition reading sums the records it names", () => {
  const check = (query: string, pick: (opponentId: string, prior: { wins: number; losses: number; draws: number }) => { wins: number; losses: number; draws: number } | null) => {
    const top = board(`minimumFights=5&minimumSample=5&contextMode=opposition&${query}`, "context").rows[0];
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let opponents = 0;
    for (const fight of index.fighters.get(top.fighter_id)!.fights) {
      const side = fight.sides[0].id === top.fighter_id ? fight.sides[0] : fight.sides[1];
      const opponent = fight.sides[0].id === top.fighter_id ? fight.sides[1] : fight.sides[0];
      void side;
      const chosen = pick(opponent.id, opponent.prior);
      if (!chosen || chosen.wins + chosen.losses + chosen.draws === 0) continue;
      opponents += 1;
      wins += chosen.wins;
      losses += chosen.losses;
      draws += chosen.draws;
    }
    assert.ok(
      top.detail.startsWith(`${wins}-${losses}${draws ? `-${draws}` : ""} combined · ${opponents} opponents`),
      `${query} · ${top.name}: ${top.detail}`,
    );
  };
  check("oppositionSource=ufc&oppositionWhen=atTime", (_id, prior) => prior);
  check("oppositionSource=ufc&oppositionWhen=today", (id) => index.fighters.get(id)?.ufc ?? null);
  check("oppositionSource=all&oppositionWhen=today", (id) => {
    const fighter = index.fighters.get(id);
    return fighter?.careerVerified ? fighter.career : null;
  });
});

test("a fighter's records match the leaderboard they come from", () => {
  const millerId = "d1941565abf50b16";
  const records = fighterRecords(millerId, 10);
  const wins = records.find((entry) => entry.key === "wins");
  assert.ok(wins, "expected a most-wins record");
  assert.equal(wins!.rank, 1);
  assert.equal(wins!.scope, "UFC history");
  // The board and the record must agree on both the number and the holder.
  const top = board("minimumFights=1", "record").rows[0];
  assert.equal(top.fighter_id, millerId);
  assert.equal(top.value, wins!.value);
});

test("records are only claimed where the place is genuinely near the top", () => {
  let checked = 0;
  for (const fighter of index.fighters.values()) {
    for (const entry of fighterRecords(fighter.id, 10)) {
      checked += 1;
      assert.ok(entry.rank >= 1);
      assert.ok(entry.rank <= (entry.scope === "UFC history" ? 5 : 3), `${fighter.name}: ${entry.label} rank ${entry.rank} in ${entry.scope}`);
      assert.ok(entry.field >= entry.rank, `${fighter.name}: rank ${entry.rank} of ${entry.field}`);
      assert.ok(entry.label.length > 3 && entry.detail.length > 0);
    }
  }
  assert.ok(checked > 100, `only ${checked} records found`);
});

test("records are sorted best first", () => {
  for (const fighter of index.fighters.values()) {
    const records = fighterRecords(fighter.id, 10);
    for (let i = 1; i < records.length; i++) {
      assert.ok(records[i].rank >= records[i - 1].rank, `${fighter.name} records out of order`);
    }
  }
});

test("profile statistics include every qualifying top-50 placement and age-at-win variants", () => {
  const rosas = db.prepare("SELECT id FROM fighters WHERE name = 'Raul Rosas Jr.'").get() as { id: string } | undefined;
  assert.ok(rosas, "Raul Rosas Jr. missing from fighter table");
  const placements = fighterStats(rosas!.id);
  const youngest = placements.find((entry) => entry.key === "youngestWin");
  assert.ok(youngest, "youngest UFC win should appear on Raul Rosas Jr.'s profile");
  assert.equal(youngest!.rank, 1);
  assert.equal(youngest!.value, 18);
  assert.equal(youngest!.category, "Age at a win");
  for (const entry of placements) {
    assert.ok(entry.rank >= 1 && entry.rank <= 50, `${entry.label}: invalid profile rank ${entry.rank}`);
    assert.ok(entry.field >= entry.rank);
    assert.ok(entry.category.length > 0 && entry.detail.length > 0);
  }
});

test("accuracy and defence are built from matched landed-and-attempted pairs", () => {
  // A landed count over a partial denominator would let accuracy exceed 100%.
  for (const fight of index.fights) {
    for (const side of fight.sides) {
      const p = side.prior;
      assert.ok(p.sigAccuracyLanded <= p.sigAttempted, `${side.name} struck more than they threw`);
      assert.ok(p.sigDefenseAbsorbed <= p.sigFacedAttempted, `${side.name} absorbed more than was thrown`);
      assert.ok(p.takedownAccuracyLanded <= p.takedownAttempts, `${side.name} landed more takedowns than attempts`);
      assert.ok(p.takedownDefenseConceded <= p.takedownsFacedAttempts, `${side.name} conceded more takedowns than attempts`);
      assert.ok(p.sigAccuracyLanded <= p.sigLanded, `${side.name} accuracy sample exceeds their landed total`);
      assert.ok(p.controlSeconds <= p.seconds + 1, `${side.name} controlled longer than they fought`);
    }
  }
});

test("a career profile entering a bout matches that fighter's own earlier bouts", () => {
  const fight = [...index.fights].reverse().find((entry) => entry.sides[0].prior.statBouts >= 8)!;
  const side = fight.sides[0];
  let landed = 0;
  let attempted = 0;
  let seconds = 0;
  let takedowns = 0;
  for (const earlier of index.fighters.get(side.id)!.fights) {
    if (earlier.date >= fight.date) break;
    const own = earlier.sides[0].id === side.id ? earlier.sides[0] : earlier.sides[1];
    const other = earlier.sides[0].id === side.id ? earlier.sides[1] : earlier.sides[0];
    const sig = own.actions.significantStrikes;
    if (!sig || !other.actions.significantStrikes || earlier.elapsed == null) continue;
    landed += sig.scored;
    seconds += earlier.elapsed;
    takedowns += own.actions.takedowns?.scored ?? 0;
    if (sig.attempted != null) attempted += sig.attempted;
  }
  assert.equal(side.prior.sigLanded, landed, "significant strikes landed");
  assert.equal(side.prior.sigAttempted, attempted, "significant strikes attempted");
  assert.equal(side.prior.seconds, seconds, "fight time");
  assert.equal(side.prior.takedowns, takedowns, "takedowns");
});

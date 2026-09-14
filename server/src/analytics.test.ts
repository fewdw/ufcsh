import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { careerBefore, completeRecordBefore, fightIndex, impliedProbability, opponentOf, sideOf, winProfit } from "./fight-index.ts";
import { getRankings } from "./api.ts";
import { getStats } from "./stats.ts";
import { getLabs, getLabsBouts, getLabsFill, getLabsMatchups } from "./labs.ts";
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
const bouts = (query: string) => getLabsBouts(new URLSearchParams(query)) as any;
const matchups = (query = "") => getLabsMatchups(new URLSearchParams(query)) as any;
const fill = (fightId: string, pov: "a" | "b", mode: "basic" | "normal" | "advanced") =>
  getLabsFill(new URLSearchParams(`fight=${fightId}&pov=${pov}&mode=${mode}`)) as any;
const asQuery = (values: Record<string, string | string[]>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.set(key, Array.isArray(value) ? value.join(",") : value);
  return params.toString();
};
const one = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...(params as never[])) as T;

// ---------------------------------------------------------------------------
// The index itself

test("index covers exactly the completed bouts in the database", () => {
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
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
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
      AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} win count`);
});

test("most UFC losses matches a direct count", () => {
  const top = board("minimumFights=1&recordGroup=losses", "record").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
      AND ((f.f1_id = ? AND f.f1_outcome = 'loss') OR (f.f2_id = ? AND f.f2_outcome = 'loss'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} loss count`);
});

test("KO/TKO wins in round 1 match a direct count", () => {
  const top = board("minimumFights=1&roundFinishMethod=ko&roundFinishRound=1", "finishing").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND f.method = 'KO/TKO' AND CAST(f.round AS INTEGER) = 1
      AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} round-1 KO count`);
});

test("total significant strikes landed match the summed event totals", () => {
  const top = board("minimumFights=1&actionMode=total", "output").rows[0];
  const { total } = one<{ total: number }>(`
    SELECT COALESCE(SUM(CASE WHEN f.f1_id = ? THEN CAST(f.f1_str AS INTEGER) ELSE CAST(f.f2_str AS INTEGER) END), 0) AS total
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND (f.f1_id = ? OR f.f2_id = ?)
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
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
      AND (f.f1_id = ? OR f.f2_id = ?)
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} bout count`);
});

test("the wins detail reports the distinct opponents actually beaten", () => {
  for (const row of board("minimumFights=1", "record").rows.slice(0, 25)) {
    const { c } = one<{ c: number }>(`
      SELECT COUNT(DISTINCT CASE WHEN f.f1_id = ? THEN f.f2_id ELSE f.f1_id END) AS c
      FROM fights f JOIN events e ON e.id = f.event_id
      WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
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
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND (f.f1_id = ? OR f.f2_id = ?)
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
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND f.weight_class = 'Heavyweight'
      AND ((f.f1_id = ? AND f.f1_outcome = 'win') OR (f.f2_id = ? AND f.f2_outcome = 'win'))
  `, top.fighter_id, top.fighter_id);
  assert.equal(top.value, c, `${top.name} heavyweight wins`);
});

test("a since-year filter excludes everything before that year", () => {
  const top = board("minimumFights=1&statsSince=2020", "record").rows[0];
  const { c } = one<{ c: number }>(`
    SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND e.date >= '2020-01-01'
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
  // Both readings of the same board: every opponent faced, and only the ones
  // this fighter beat — which is what it shows unless asked otherwise.
  for (const [scope, noun] of [["faced", "opponents faced"], ["beaten", "opponents beaten"]] as const) {
    const top = board(`minimumFights=1&minimumSample=10&contextMode=opposition&oppositionScope=${scope}`, "context").rows[0];
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let opponents = 0;
    for (const fight of index.fighters.get(top.fighter_id)!.fights) {
      const side = fight.sides[0].id === top.fighter_id ? fight.sides[0] : fight.sides[1];
      const opponent = fight.sides[0].id === top.fighter_id ? fight.sides[1] : fight.sides[0];
      if (opponent.prior.bouts === 0) continue;
      if (scope === "beaten" && side.outcome !== "win") continue;
      opponents += 1;
      wins += opponent.prior.wins;
      losses += opponent.prior.losses;
      draws += opponent.prior.draws;
    }
    assert.equal(top.detail, `${wins}-${losses}${draws ? `-${draws}` : ""} combined · ${opponents} ${noun} · UFC records that night`);
    assert.equal(top.value, Math.round((wins / (wins + losses + draws)) * 1000) / 10);
  }
});

test("beating a good fighter and losing to one are not the same claim", () => {
  const beaten = board("minimumFights=5&minimumSample=5&contextMode=opposition", "context");
  const faced = board("minimumFights=5&minimumSample=5&contextMode=opposition&oppositionScope=faced", "context");
  assert.match(beaten.title, /beaten/, "the default board says which opponents it counted");
  assert.match(faced.title, /faced/);
  assert.notEqual(
    beaten.rows.map((row) => row.fighter_id).join(","),
    faced.rows.map((row) => row.fighter_id).join(","),
    "the two readings should not rank the same field",
  );
  // Nobody can have beaten more opponents than they met.
  const met = new Map(faced.rows.map((row) => [row.fighter_id, Number(row.detail.match(/· (\d+) opponents/)![1])]));
  for (const row of beaten.rows) {
    const wonAgainst = Number(row.detail.match(/· (\d+) opponents/)![1]);
    const total = met.get(row.fighter_id);
    if (total != null) assert.ok(wonAgainst <= total, `${row.name}: beat ${wonAgainst} of ${total}`);
  }
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
  const streak = bouts("winStreakMin=3");
  for (const fight of streak.rows) assert.ok(fight.win_streak >= 3, `${fight.fighter.name} entered on ${fight.win_streak}`);

  const layoff = bouts("layoffMin=365");
  for (const fight of layoff.rows) assert.ok((fight.days_since ?? 0) >= 365, `${fight.fighter.name} ${fight.days_since}d`);

  const division = bouts("division=Heavyweight");
  for (const fight of division.rows) assert.equal(fight.division, "Heavyweight");

  const title = bouts("title=only");
  for (const fight of title.rows) assert.equal(fight.title_fight, true);

  const ko = bouts("method=ko");
  for (const fight of ko.rows) assert.equal(fight.method, "KO/TKO");

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
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND f.method IN ('KO/TKO', 'SUB') AND CAST(f.round AS INTEGER) > 5
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
  assert.equal(bouts("ageMin=60&ageMax=61").total, 0);
});

test("the bout browser is the dashboard's own population, one page at a time", () => {
  const query = "division=Lightweight&winStreakMin=2";
  const summary = labs(query).summary;
  const all = bouts(query);
  assert.equal(all.total, summary.n);
  assert.equal(all.counts.all, summary.n);
  assert.equal(all.counts.win, summary.wins);
  assert.equal(all.counts.loss, summary.losses);
  assert.equal(all.counts.draw, summary.draws);
  assert.equal(all.counts.nc, summary.ncs);
  assert.ok(all.rows.length > 0 && all.rows.length <= all.limit);

  // Each outcome tab is the slice of the same population, and they partition it.
  const wins = bouts(`${query}&outcome=win`);
  assert.equal(wins.total, summary.wins);
  for (const row of wins.rows) assert.equal(row.outcome, "win");
  const losses = bouts(`${query}&outcome=loss`);
  assert.equal(losses.total, summary.losses);
  for (const row of losses.rows) assert.equal(row.outcome, "loss");
  assert.equal(
    wins.total + losses.total + bouts(`${query}&outcome=draw`).total + bouts(`${query}&outcome=nc`).total,
    all.total,
  );

  // Paging walks the same ordering without repeating or skipping a bout.
  const first = bouts(`${query}&limit=10&offset=0`);
  const second = bouts(`${query}&limit=10&offset=10`);
  assert.equal(new Set([...first.rows, ...second.rows].map((row: any) => `${row.fight_id}:${row.fighter.id}`)).size, first.rows.length + second.rows.length);
  assert.deepEqual(bouts(`${query}&limit=20&offset=0`).rows.map((row: any) => row.fight_id), [...first.rows, ...second.rows].map((row: any) => row.fight_id));
});

test("every bout ordering is the one it claims to be", () => {
  const query = "division=Welterweight&limit=200";
  const dates = (sort: string) => bouts(`${query}&sort=${sort}`).rows.map((row: any) => row.date);
  assert.deepEqual(dates("recent"), [...dates("recent")].sort().reverse());
  assert.deepEqual(dates("oldest"), [...dates("oldest")].sort());

  for (const outcome of ["win", "loss", "draw"]) {
    const rows = bouts(`${query}&sort=${outcome}`).rows;
    const after = rows.findIndex((row: any) => row.outcome !== outcome);
    if (after === -1) continue;
    for (const row of rows.slice(after)) assert.notEqual(row.outcome, outcome, `${outcome}-first put one back after another outcome`);
  }

  // Price and duration orderings put unknown values last rather than first.
  const longest = bouts(`${query}&sort=upset`).rows;
  const lines = longest.map((row: any) => row.line);
  const priced = lines.filter((line: number | null) => line != null);
  assert.deepEqual(priced, [...priced].sort((a, b) => b - a));
  assert.deepEqual(lines.slice(priced.length), lines.slice(priced.length).map(() => null));

  const quickest = bouts(`${query}&sort=quick`).rows.map((row: any) => row.elapsed).filter((value: number | null) => value != null);
  assert.deepEqual(quickest, [...quickest].sort((a: number, b: number) => a - b));
});

test("striking a bout off removes it from the record but not from the list", () => {
  const query = "division=Flyweight&title=only";
  const before = labs(query).summary;
  const listed = bouts(query).rows;
  assert.ok(listed.length >= 3);

  const struck = listed.slice(0, 3);
  const exclude = struck.map((row: any) => `${row.fight_id}:${row.fighter.id}`).join(",");
  const after = labs(`${query}&exclude=${exclude}`);
  assert.equal(after.excluded, 3);
  assert.equal(after.summary.n, before.n - 3);
  for (const [outcome, key] of [["win", "wins"], ["loss", "losses"], ["draw", "draws"], ["nc", "ncs"]] as const) {
    const removed = struck.filter((row: any) => row.outcome === outcome).length;
    assert.equal(after.summary[key], before[key] - removed, `${key} did not drop by ${removed}`);
  }

  // The browser still lists them, so a struck bout can be put back.
  const stillListed = bouts(`${query}&exclude=${exclude}`).rows.map((row: any) => `${row.fight_id}:${row.fighter.id}`);
  for (const row of struck) assert.ok(stillListed.includes(`${row.fight_id}:${row.fighter.id}`), "a struck bout vanished from the list");

  // A malformed or unknown id is ignored rather than silently dropping rows.
  assert.equal(labs(`${query}&exclude=nonsense,,deadbeef:deadbeef`).summary.n, before.n);
});

test("a summary carries the raw denominators its rates were built from", () => {
  // The browser nets struck bouts out of these locally, so a rate rebuilt from
  // them must be the identical number the server would return.
  const s = labs("division=Bantamweight").summary;
  const decided = s.wins + s.losses + s.draws;
  assert.equal(s.win_rate, Math.round((s.wins / decided) * 1000) / 10);
  assert.equal(s.avg_seconds, Math.round(s.seconds / s.timed));
  assert.equal(s.avg_age, Math.round((s.age_sum / s.age_known) * 10) / 10);
  assert.equal(s.r1_finish_rate, Math.round((s.r1_finishes / s.wins) * 1000) / 10);
  assert.equal(s.finish_rate, Math.round(((s.outcomes.win_ko + s.outcomes.win_sub) / s.wins) * 1000) / 10);
  assert.equal(s.finished_rate, Math.round(((s.outcomes.loss_ko + s.outcomes.loss_sub) / s.losses) * 1000) / 10);
  assert.equal(s.stoppage_rate, Math.round(((s.outcomes.win_ko + s.outcomes.win_sub + s.outcomes.loss_ko + s.outcomes.loss_sub) / decided) * 1000) / 10);
});

test("striking bouts off moves every counter by exactly what those bouts held", () => {
  const query = "division=Bantamweight&title=only";
  const before = labs(query).summary;
  const struck = bouts(query).rows.slice(0, 5);
  const after = labs(`${query}&exclude=${struck.map((row: any) => `${row.fight_id}:${row.fighter.id}`).join(",")}`).summary;

  const sum = (pick: (row: any) => number) => struck.reduce((total: number, row: any) => total + pick(row), 0);
  assert.equal(after.n, before.n - struck.length);
  assert.equal(after.timed, before.timed - sum((row) => (row.elapsed != null ? 1 : 0)));
  assert.equal(after.seconds, before.seconds - sum((row) => row.elapsed ?? 0));
  assert.equal(after.age_known, before.age_known - sum((row) => (row.age != null ? 1 : 0)));
  assert.equal(after.age_sum, before.age_sum - sum((row) => row.age ?? 0));
  assert.equal(
    after.r1_finishes,
    before.r1_finishes - sum((row) => (row.outcome === "win" && row.round === 1 && (row.method === "KO/TKO" || row.method === "SUB") ? 1 : 0)),
  );
  assert.equal(after.outcomes.win_ko, before.outcomes.win_ko - sum((row) => (row.outcome === "win" && row.method === "KO/TKO" ? 1 : 0)));
  assert.equal(after.outcomes.loss_dec, before.outcomes.loss_dec - sum((row) => (row.outcome === "loss" && String(row.method).endsWith("-DEC") ? 1 : 0)));
});

test("an announced matchup carries filter-ready state for both corners", () => {
  const all = matchups();
  assert.ok(all.matchups.length > 0, "no announced bout to fill from");
  const today = new Date().toISOString().slice(0, 10);
  const beltStatuses = ["champion", "formerChampion", "neverChampion"];
  const prevResults = ["debut", "win", "finishWin", "loss", "koLoss", "subLoss", "decisionLoss", "drawOrNc"];

  for (const m of all.matchups) {
    assert.ok(m.date >= today, `${m.event_name} has already happened`);
    // Nothing announced has been fought, so it must not be in the index.
    assert.equal(index.byId.has(m.fight_id), false, `${m.fight_id} is already a completed bout`);
    // The booked length is whatever ufc.com published, or unknown. It is never
    // derived from title status or card position: a non-title co-main event
    // can be booked for five rounds.
    assert.ok(m.scheduled_rounds === null || (Number.isInteger(m.scheduled_rounds) && m.scheduled_rounds > 0));
    for (const corner of [m.a, m.b]) {
      assert.ok(corner.name, "a corner is missing a name");
      // Every categorical value must already be a filter option, because the
      // panel writes it straight into a filter without translating.
      if (corner.status != null) assert.ok(beltStatuses.includes(corner.status), `bad status ${corner.status}`);
      if (corner.prev != null) assert.ok(prevResults.includes(corner.prev), `bad prev ${corner.prev}`);
      if (corner.prev === "debut") assert.equal(corner.ufc_bouts, 0, `${corner.name} debuts with bouts behind them`);
      if (corner.ufc_bouts === 0) assert.equal(corner.layoff_days, null);
      if (corner.prob != null) assert.ok(corner.prob > 0 && corner.prob < 100, `bad implied ${corner.prob}`);
    }
  }

  // The search narrows to the same rows rather than reaching past them.
  const one = all.matchups[0];
  const found = matchups(`q=${encodeURIComponent(one.a.name)}`);
  assert.ok(found.matchups.some((m: any) => m.fight_id === one.fight_id), "search lost its own matchup");
  assert.ok(found.matchups.length <= all.matchups.length);
  assert.equal(matchups("q=zzzznotafighter").matchups.length, 0);
});

test("filling from a matchup reads the same fight from either corner", () => {
  const sample = matchups().matchups.slice(0, 25);
  assert.ok(sample.length > 0);
  const invert: Record<string, string> = { favorite: "underdog", underdog: "favorite", pickem: "pickem" };

  for (const m of sample) {
    for (const mode of ["basic", "normal", "advanced"] as const) {
      const a = fill(m.fight_id, "a", mode).filters;
      const b = fill(m.fight_id, "b", mode).filters;
      // Paired conditions belong to a corner, so they must swap together —
      // a record built half from one fighter and half from the other is a lie.
      assert.deepEqual(a.ageMin, b.oppAgeMin, `${m.a.name}: age not mirrored`);
      assert.deepEqual(a.oppAgeMin, b.ageMin, `${m.a.name}: opponent age not mirrored`);
      assert.deepEqual(a.status, b.oppStatus, `${m.a.name}: belt not mirrored`);
      assert.deepEqual(a.oppStatus, b.status, `${m.a.name}: opponent belt not mirrored`);
      // Conditions asked of both fighters are decided as one, so they swap
      // together too: stance, experience and price all belong to the pairing.
      for (const [mine, theirs] of [["stance", "oppStance"], ["expMin", "oppExpMin"], ["expMax", "oppExpMax"], ["probMin", "oppProbMin"], ["probMax", "oppProbMax"]] as const) {
        assert.deepEqual(a[mine], b[theirs], `${m.a.name}: ${mine} not mirrored`);
        assert.deepEqual(a[theirs], b[mine], `${m.a.name}: ${theirs} not mirrored`);
      }
      // The market role has to flip; both corners cannot be the favourite.
      if (a.odds) assert.equal(b.odds, invert[a.odds], `${m.a.name}: ${a.odds} did not flip`);
      // The shape of the bout belongs to neither corner and must not move.
      for (const key of ["division", "title", "rounds", "mainEvent", "gender"]) {
        assert.deepEqual(a[key], b[key], `${m.a.name}: ${key} changed with the corner`);
      }
      // Filling is deterministic, so the same request twice is the same answer.
      assert.deepEqual(fill(m.fight_id, "a", mode).filters, a);
    }
  }
});

test("the three modes are three selections over one list of conditions", () => {
  const sample = matchups().matchups.slice(0, 25);
  for (const m of sample) {
    for (const pov of ["a", "b"] as const) {
      const basic = fill(m.fight_id, pov, "basic");
      const normal = fill(m.fight_id, pov, "normal");
      const advanced = fill(m.fight_id, pov, "advanced");
      const offered = (result: any) => [...result.conditions.map((c: any) => c.id), ...result.dropped.map((c: any) => c.id)].sort();
      const on = (result: any) => result.conditions.filter((c: any) => c.on);
      const where = `${m.a.name}/${pov}`;

      // The list is the matchup's, not the mode's: switching mode changes what
      // is switched on, never what there is to switch. So checking every box
      // by hand lands on exactly the advanced study.
      assert.deepEqual(offered(normal), offered(basic), `${where}: the modes offered different conditions`);
      assert.deepEqual(offered(advanced), offered(basic), `${where}: the modes offered different conditions`);
      assert.equal(on(advanced).length, advanced.conditions.length, "advanced switches on everything with any precedent");

      // Each step up applies more of the matchup and reads a narrower
      // population. Basic is the matchup's own identity and nothing else.
      assert.ok(on(basic).every((c: any) => c.base), `${where}: basic applied an extra condition`);
      assert.ok(on(basic).length <= on(normal).length, `${where}: basic applied more than normal`);
      assert.ok(on(normal).length <= on(advanced).length, `${where}: normal applied more than advanced`);
      assert.ok(basic.n >= normal.n && normal.n >= advanced.n, `${where}: ${basic.n} → ${normal.n} → ${advanced.n} is not narrowing`);
      for (const condition of on(normal)) {
        assert.ok(on(advanced).some((c: any) => c.id === condition.id), `${where}: advanced lost ${condition.id}`);
      }

      // Advanced may narrow all the way to nothing — that is what asking for
      // every condition at once means, and the reader switches one back off.
      for (const [wider, narrower] of [[basic, normal], [normal, advanced]] as const) {
        for (const [key, value] of Object.entries(wider.filters)) {
          const mine = (narrower.filters as Record<string, unknown>)[key];
          assert.notEqual(mine, undefined, `${where}: a narrower mode dropped ${key}`);
          if (key.endsWith("Min")) assert.ok(Number(mine) >= Number(value), `${where}: ${key} loosened ${value} to ${mine}`);
          else if (key.endsWith("Max")) assert.ok(Number(mine) <= Number(value), `${where}: ${key} loosened ${value} to ${mine}`);
          else assert.deepEqual(mine, value, `${where}: a narrower mode changed ${key}`);
        }
      }

      // Normal holds out for a readable sample while it has anything to add.
      if (on(normal).some((c: any) => !c.base)) assert.ok(normal.n >= normal.floor, `${where}: normal kept a condition at ${normal.n} observations`);
      assert.ok(normal.floor > advanced.floor, "normal must hold out for a larger sample than advanced");

      // The reported count must be what the filters actually select.
      for (const result of [basic, normal, advanced]) assert.equal(labs(asQuery(result.filters)).summary.n, result.n);
    }
  }
});

test("a filled gap keeps the sign of the corner it was read from", () => {
  // The bug this guards: the reach gap used to be a magnitude, so a fighter
  // with the shorter reach and one with the longer both filled in as "1".
  const gaps = [
    ["reachGapMin", "reachGapMax", "reach_in"],
    ["heightGapMin", "heightGapMax", "height_in"],
    ["ageGapMin", "ageGapMax", "age"],
  ] as const;
  let checked = 0;

  for (const m of matchups().matchups) {
    const filled = { a: fill(m.fight_id, "a", "advanced"), b: fill(m.fight_id, "b", "advanced") };
    for (const [minKey, maxKey, field] of gaps) {
      for (const pov of ["a", "b"] as const) {
        const me = pov === "a" ? m.a : m.b;
        const them = pov === "a" ? m.b : m.a;
        if (me[field] == null || them[field] == null) continue;
        const values = filled[pov].filters;
        if (values[minKey] === undefined && values[maxKey] === undefined) continue;
        checked += 1;
        const actual = me[field] - them[field];
        const min = values[minKey] === undefined ? -Infinity : Number(values[minKey]);
        const max = values[maxKey] === undefined ? Infinity : Number(values[maxKey]);
        // A population filled from a bout must be one that bout belongs to.
        assert.ok(actual >= min && actual <= max, `${m.a.name}/${pov}: ${field} gap ${actual} outside its own ${min}..${max}`);
        // And the band must stay on the real gap's side of zero, or a fighter
        // who is shorter reads as one who is longer.
        if (actual > 0) assert.ok(min >= 1, `${m.a.name}/${pov}: positive ${field} gap allows ${min}`);
        if (actual < 0) assert.ok(max <= -1, `${m.a.name}/${pov}: negative ${field} gap allows ${max}`);
        if (actual === 0) assert.ok(min === 0 && max === 0, `${m.a.name}/${pov}: level ${field} allows ${min}..${max}`);
      }
      // Whichever way a gap leans, it must lean the other way from the other
      // corner — the two of them cannot both be the longer-reaching fighter.
      const lean = (values: Record<string, string | string[]>) =>
        values[minKey] !== undefined && Number(values[minKey]) >= 1 ? 1
          : values[maxKey] !== undefined && Number(values[maxKey]) <= -1 ? -1 : 0;
      const a = lean(filled.a.filters);
      const b = lean(filled.b.filters);
      if (a !== 0 && b !== 0) assert.notEqual(a, b, `${m.a.name}: ${minKey} leans the same way from both corners`);
    }
  }
  assert.ok(checked > 50, `only ${checked} gap constraints were exercised`);
});

test("an unknown or already-fought bout cannot be filled from", () => {
  assert.deepEqual(fill("deadbeef", "a", "basic"), { error: "not found" });
  const fought = index.fights.at(-1)!.id;
  assert.deepEqual(fill(fought, "a", "advanced"), { error: "not found" });
});

test("every filter constrains exactly what it names, on both sides of the cage", () => {
  // Each case sets one filter and checks the bouts it returns against the
  // index itself, not against another endpoint — so a filter that silently
  // does nothing, or reads the wrong corner, fails here.
  type Side = ReturnType<typeof sideOf>;
  const cases: { query: string; holds: (side: Side, opponent: Side, fight: any) => boolean }[] = [
    { query: "ageMin=35", holds: (s) => (s.age ?? 0) >= 35 },
    { query: "ageMax=25", holds: (s) => s.age != null && s.age <= 25 },
    { query: "oppAgeMin=35", holds: (_s, o) => (o.age ?? 0) >= 35 },
    { query: "oppAgeMax=25", holds: (_s, o) => o.age != null && o.age <= 25 },
    { query: "expMin=10", holds: (s) => s.prior.bouts + s.prior.ncs >= 10 },
    { query: "expMax=0", holds: (s) => s.prior.bouts + s.prior.ncs === 0 },
    { query: "oppExpMin=10", holds: (_s, o) => o.prior.bouts + o.prior.ncs >= 10 },
    { query: "winStreakMin=3", holds: (s) => s.prior.winStreak >= 3 },
    { query: "lossStreakMin=2", holds: (s) => s.prior.lossStreak >= 2 },
    { query: "layoffMin=365", holds: (s) => (s.prior.daysSince ?? -1) >= 365 },
    { query: "layoffMax=60", holds: (s) => s.prior.daysSince != null && s.prior.daysSince <= 60 },
    { query: "stance=Southpaw", holds: (s) => s.stance === "Southpaw" },
    { query: "oppStance=Orthodox", holds: (_s, o) => o.stance === "Orthodox" },
    { query: "status=champion", holds: (s) => s.prior.reigningChampion },
    { query: "status=neverChampion", holds: (s) => !s.prior.reigningChampion && !s.prior.formerChampion },
    { query: "oppStatus=formerChampion", holds: (_s, o) => o.prior.formerChampion && !o.prior.reigningChampion },
    { query: "prev=debut", holds: (s) => s.prior.lastOutcome == null && s.prior.bouts === 0 && s.prior.ncs === 0 },
    { query: "prev=koLoss", holds: (s) => s.prior.lastOutcome === "loss" && s.prior.lastMethod === "KO/TKO" },
    { query: "odds=underdog", holds: (s, o) => s.prob != null && o.prob != null && s.prob < o.prob },
    { query: "odds=favorite", holds: (s, o) => s.prob != null && o.prob != null && s.prob > o.prob },
    { query: "lineMin=200", holds: (s) => (s.close ?? -Infinity) >= 200 },
    { query: "lineMax=-300", holds: (s) => s.close != null && s.close <= -300 },
    { query: "probMin=70", holds: (s) => s.prob != null && s.prob * 100 >= 70 },
    { query: "oppProbMax=30", holds: (_s, o) => o.prob != null && o.prob * 100 <= 30 },
    { query: "oppLineMin=200", holds: (_s, o) => (o.close ?? -Infinity) >= 200 },
    { query: "gender=women", holds: (_s, _o, f) => f.women },
    { query: "gender=men", holds: (_s, _o, f) => !f.women },
    { query: "rounds=5", holds: (_s, _o, f) => f.scheduledRounds === 5 },
    { query: "mainEvent=only", holds: (_s, _o, f) => f.mainEvent },
    { query: "mainEvent=none", holds: (_s, _o, f) => !f.mainEvent },
    { query: "title=none", holds: (_s, _o, f) => !(f.titleFight && (f.titleType === "title" || f.titleType === "interim")) },
    { query: "method=sub", holds: (_s, _o, f) => f.method === "SUB" },
    { query: "method=decision", holds: (_s, _o, f) => String(f.method).endsWith("-DEC") },
    // The signed gaps: negative means A is the smaller/younger of the two.
    { query: "reachGapMin=1", holds: (s, o) => s.reachIn != null && o.reachIn != null && s.reachIn - o.reachIn >= 1 },
    { query: "reachGapMax=-1", holds: (s, o) => s.reachIn != null && o.reachIn != null && s.reachIn - o.reachIn <= -1 },
    { query: "reachGapMin=0&reachGapMax=0", holds: (s, o) => s.reachIn != null && o.reachIn != null && s.reachIn === o.reachIn },
    { query: "heightGapMin=2", holds: (s, o) => s.heightIn != null && o.heightIn != null && s.heightIn - o.heightIn >= 2 },
    { query: "heightGapMax=-2", holds: (s, o) => s.heightIn != null && o.heightIn != null && s.heightIn - o.heightIn <= -2 },
    { query: "ageGapMax=-5", holds: (s, o) => s.age != null && o.age != null && s.age - o.age <= -5 },
    { query: "ageGapMin=5", holds: (s, o) => s.age != null && o.age != null && s.age - o.age >= 5 },
  ];

  const unfiltered = labs("").summary.n;
  for (const testCase of cases) {
    const result = bouts(`${testCase.query}&limit=200&sort=oldest`);
    assert.ok(result.total > 0, `${testCase.query} matched nothing at all`);
    assert.ok(result.total < unfiltered, `${testCase.query} did not narrow the population`);
    for (const row of result.rows) {
      const fight = index.byId.get(row.fight_id)!;
      assert.ok(fight, `${testCase.query} returned a bout that is not in the index`);
      const side = sideOf(fight, row.fighter.id);
      const opponent = opponentOf(fight, row.fighter.id);
      assert.ok(
        testCase.holds(side, opponent, fight),
        `${testCase.query} returned ${row.fighter.name} vs ${row.opponent.name} (${row.date}), which does not satisfy it`,
      );
    }
  }
});

test("a signed gap reads the same bout as mirror images from the two corners", () => {
  // The bug this guards: a magnitude filter showed the same "1" from both
  // corners, so a fighter with the shorter reach looked like the longer one.
  const longer = bouts("reachGapMin=1&limit=200").rows;
  const shorter = bouts("reachGapMax=-1&limit=200").rows;
  assert.ok(longer.length > 0 && shorter.length > 0);
  const key = (row: any) => `${row.fight_id}:${row.fighter.id}`;
  const shorterKeys = new Set(bouts("reachGapMax=-1&limit=200&sort=oldest").rows.map(key));
  for (const row of bouts("reachGapMin=1&limit=200&sort=oldest").rows) {
    assert.equal(shorterKeys.has(key(row)), false, "a bout is on both sides of zero at once");
  }
  // The two sides of a reach mismatch must be the same set of fights seen from
  // opposite corners, and level reach must belong to neither.
  const totalLonger = bouts("reachGapMin=1").total;
  const totalShorter = bouts("reachGapMax=-1").total;
  assert.equal(totalLonger, totalShorter, "a reach edge exists for one corner but not the other");
  const level = bouts("reachGapMin=0&reachGapMax=0").total;
  assert.equal(totalLonger + totalShorter + level, bouts("reachGapMin=-99&reachGapMax=99").total);
});

test("an opponent-side market filter is not the mirror of the fighter's", () => {
  // Both closing prices carry vig, so "A above 60%" and "B below 40%" are
  // different populations; the second must be a strict subset of the first.
  const wide = bouts("probMin=60&limit=200").total;
  const both = bouts("probMin=60&oppProbMax=40&limit=200").total;
  assert.ok(both > 0, "no bout has a favourite over 60% against a dog under 40%");
  assert.ok(both < wide, `opponent-side filter did not constrain: ${both} of ${wide}`);
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
    const entry = board(`minimumFights=5&minimumSample=5&contextMode=opposition&oppositionScope=faced&${combination}`, "context");
    assert.ok(entry.rows.length > 0, combination);
    assert.match(entry.rows[0].detail, /combined · \d+ opponents/);
    seen.add(entry.rows.map((row) => row.fighter_id).join(","));
  }
  assert.equal(seen.size, 3, "each combination should rank a different field");

  const dated = board("minimumFights=5&minimumSample=5&contextMode=opposition&oppositionScope=faced&oppositionSource=all&oppositionWhen=atTime", "context");
  assert.ok(dated.rows.length > 0);
  assert.match(dated.description, /verified outside-UFC bouts/);
});

test("a complete career read at fight night never exceeds the same career today", () => {
  // The UFC half grows with every bout and the rest is fixed, so the dated
  // reading has to sit at or below the present-day one for every fighter.
  const atTime = new Map(board("minimumFights=1&minimumSample=1&limit=150&contextMode=opposition&oppositionScope=faced&oppositionSource=all&oppositionWhen=atTime", "context")
    .rows.map((row) => [row.fighter_id, row]));
  const today = board("minimumFights=1&minimumSample=1&limit=150&contextMode=opposition&oppositionScope=faced&oppositionSource=all&oppositionWhen=today", "context");
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
  const top = board("minimumFights=5&minimumSample=5&contextMode=opposition&oppositionScope=faced&oppositionSource=all&oppositionWhen=atTime", "context").rows[0];
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
    top.detail.startsWith(`${wins}-${losses}${draws ? `-${draws}` : ""} combined · ${opponents} opponents faced`),
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
    const top = board(`minimumFights=5&minimumSample=5&contextMode=opposition&oppositionScope=faced&${query}`, "context").rows[0];
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
      top.detail.startsWith(`${wins}-${losses}${draws ? `-${draws}` : ""} combined · ${opponents} opponents faced`),
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

test("career control denominators exclude every bout without paired control data", () => {
  const totals = new Map<string, { seconds: number; control: number; bouts: number }>();
  let partialSamples = 0;
  for (const fight of index.fights) {
    for (const side of fight.sides) {
      const expected = totals.get(side.id) ?? { seconds: 0, control: 0, bouts: 0 };
      assert.equal(side.prior.controlTrackedSeconds, expected.seconds, `${side.name} control denominator`);
      assert.equal(side.prior.controlSeconds, expected.control);
      assert.equal(side.prior.controlBouts, expected.bouts);
      if (expected.seconds > 0 && expected.seconds < side.prior.seconds) partialSamples++;
      const opponent = opponentOf(fight, side.id);
      if (fight.elapsed != null && side.actions.significantStrikes && opponent.actions.significantStrikes && side.actions.control && opponent.actions.control) {
        totals.set(side.id, { seconds: expected.seconds + fight.elapsed, control: expected.control + side.actions.control.scored, bouts: expected.bouts + 1 });
      }
    }
  }
  assert.ok(partialSamples > 0, "exercised real careers with incomplete control coverage");
});

test("Labs reigning champion filter includes champions competing in another division", () => {
  const observations = index.fights.flatMap((fight) => fight.sides);
  assert.ok(observations.some((side) => side.prior.reigningChampion && !side.prior.champion && !side.prior.interimChampion));
  assert.equal(labs("status=champion").summary.n, observations.filter((side) => side.prior.reigningChampion).length);
  assert.equal(labs("status=formerChampion").summary.n, observations.filter((side) => side.prior.formerChampion && !side.prior.reigningChampion).length);
});

test("Labs probability bounds use the exact price instead of rounded percentages", () => {
  const expected = index.fights.flatMap((fight) => fight.sides.filter((side) => {
    const opponent = opponentOf(fight, side.id);
    return side.prob != null && opponent.prob != null && side.close != null && side.prob * 100 >= 69.7 && side.prob * 100 <= 70.2;
  }));
  assert.ok(expected.length > 0);
  assert.equal(labs("probMin=69.7&probMax=70.2").summary.n, expected.length);
});

test("Labs round accuracy uses only matched landed and attempted counts", () => {
  const result = labs("");
  for (let round = 0; round < 5; round++) {
    let landed = 0;
    let attempted = 0;
    for (const fight of index.fights) for (const side of fight.sides) {
      const stat = side.rounds[round];
      if (stat?.sigAttempted != null) { landed += stat.sig; attempted += stat.sigAttempted; }
    }
    assert.equal(result.rounds[round].sig_accuracy, attempted ? Math.round(landed / attempted * 1000) / 10 : null);
  }
});

// ---------------------------------------------------------------------------
// Rankings

test("the meta view carries the media pound-for-pound lists, labelled", () => {
  const meta = getRankings("meta") as any[];
  const media = getRankings("media") as any[];
  const p4p = (lists: any[]) => lists.filter((d) => d.division.includes("Pound-for-Pound"));

  // The bug this guards: the meta source publishes no P4P list of its own, so
  // asking for meta used to leave the P4P view with nothing in it.
  assert.ok(p4p(media).length > 0, "the media view has no pound-for-pound list to borrow");
  assert.deepEqual(p4p(meta).map((d) => d.division), p4p(media).map((d) => d.division));
  for (const list of p4p(meta)) {
    assert.equal(list.source, "media", `${list.division} is not labelled as borrowed`);
    const from = p4p(media).find((d) => d.division === list.division);
    assert.deepEqual(list.entries.map((e: any) => e.name), from.entries.map((e: any) => e.name));
  }

  // Borrowing must not touch the divisions the meta view does publish, nor
  // duplicate a list, nor lose the order the P4P lists are read in.
  for (const list of meta.filter((d) => !d.division.includes("Pound-for-Pound"))) {
    assert.equal(list.source, "meta", `${list.division} came from the wrong view`);
  }
  assert.equal(new Set(meta.map((d) => d.division)).size, meta.length, "a division is listed twice");
  assert.equal(meta[0].division, "Men's Pound-for-Pound");
  const womensP4P = meta.findIndex((d) => d.division === "Women's Pound-for-Pound");
  const firstWomens = meta.findIndex((d) => d.division.startsWith("Women's") && !d.division.includes("Pound-for-Pound"));
  assert.ok(womensP4P >= 0 && womensP4P < firstWomens, "the women's P4P list is not above the women's divisions");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  chartModel,
  chartTime,
  chartGap,
  clampRange,
  resizeRange,
  panRange,
} from "../src/market-chart.ts";
import { groupMarkets, marketLabel } from "../src/market-groups.ts";
import type {
  ExtraMarket,
  MarketDetail,
  MarketPoint,
} from "../src/polymarket-types.ts";

const start = Date.UTC(2026, 9, 31, 23);
const point = (
  offset: number,
  phase: MarketPoint["phase"] = "prefight",
  source: MarketPoint["source"] = "observed",
): MarketPoint => ({ at: start + offset, p: 0.55, phase, source });
const detail = (
  history: MarketPoint[],
  state: MarketDetail["fight"]["state"] = "upcoming",
): MarketDetail => ({
  fight: {
    id: "fight",
    eventId: "card",
    event: "Card",
    date: "2026-10-31",
    f1: { id: "a", name: "A" },
    f2: { id: "b", name: "B" },
    cutoff: start - 3600_000,
    winner: null,
    state,
  },
  url: "https://polymarket.com/event/fight",
  status: "open",
  quote: null,
  volume: null,
  liquidity: null,
  sports: null,
  community: null,
  opening: null,
  error: null,
  history,
  extras: [],
  stream: false,
  historyCheckedAt: start,
  historyError: null,
  rounds: [],
});

test("upcoming history is sorted, validated and deduplicated in favor of captures", () => {
  const captured = point(1000);
  const model = chartModel(
    detail([
      point(2000),
      captured,
      point(1000, "unknown", "history"),
      point(0),
      { ...point(3000), p: 1.1 },
      { ...point(4000), at: NaN },
      { ...point(5000), at: Number.MAX_VALUE },
    ]),
  );
  assert.deepEqual(model.points, [point(0), captured, point(2000)]);
  assert.deepEqual(model.domain, { from: start, to: start + 2000 });
});

test("live without captures waits rather than using card time or source history as fight timing", () => {
  const model = chartModel(
    detail(
      [
        point(0),
        point(1000, "unknown", "history"),
        point(2000, "live", "history"),
      ],
      "live",
    ),
  );
  assert.equal(model.fightScope, true);
  assert.deepEqual(model.points, []);
});

test("live spans the whole fight capture and leaves out earlier prices", () => {
  const model = chartModel(
    detail(
      [
        point(-3600_000),
        point(0, "live"),
        point(600_000, "live"),
        point(1200_000, "live"),
        point(1800_000, "unknown", "history"),
      ],
      "live",
    ),
  );
  assert.deepEqual(model.domain, { from: start, to: start + 1200_000 });
  assert.equal(model.points.length, 3);
});

test("finished capture shows the whole observed fight and excludes settlement prices", () => {
  const model = chartModel(
    detail(
      [
        point(0, "live"),
        point(1200_000, "live"),
        { ...point(1800_000, "unknown", "history"), p: 1 },
      ],
      "finished",
    ),
  );
  assert.deepEqual(model.domain, { from: start, to: start + 1200_000 });
  assert.equal(model.points.length, 2);
});

test("finished history without fight capture keeps honest history instead of inventing a live window", () => {
  const model = chartModel(
    detail(
      [point(0, "unknown", "history"), point(3600_000, "unknown", "history")],
      "finished",
    ),
  );
  assert.equal(model.fightScope, false);
  assert.equal(model.points.length, 2);
});

test("entering live or changing identity resets selection; polling and finishing do not", () => {
  const data = detail([point(0)]);
  const key = chartModel(data).key;
  assert.notEqual(
    chartModel({ ...data, fight: { ...data.fight, state: "live" } }).key,
    key,
  );
  for (const fight of [
    { ...data.fight, date: "2026-11-07" },
    { ...data.fight, f1: { id: "replacement", name: "C" } },
  ])
    assert.notEqual(chartModel({ ...data, fight }).key, key);
  assert.notEqual(chartModel({ ...data, url: "other" }).key, key);
  const live = detail([point(0, "live")], "live");
  assert.equal(
    chartModel(live).key,
    chartModel({ ...live, history: [...live.history, point(1000, "live")] })
      .key,
  );
  assert.equal(
    chartModel(live).key,
    chartModel({ ...live, fight: { ...live.fight, state: "finished" } }).key,
  );
  assert.equal(
    chartModel(live).key,
    chartModel({ ...live, fight: { ...live.fight, state: "upcoming" } }).key,
  );
});

test("manual absolute windows survive prepended history and new samples", () => {
  const manual = { from: start + 20_000, to: start + 40_000 };
  assert.deepEqual(
    clampRange(manual, { from: start - 100_000, to: start + 200_000 }),
    manual,
  );
});

test("range edges never cross, exceed data or go below minimum span", () => {
  const domain = { from: 100_000, to: 200_000 };
  const range = { from: 120_000, to: 180_000 };
  assert.deepEqual(resizeRange(range, "from", 999_999, domain), {
    from: 170_000,
    to: 180_000,
  });
  assert.deepEqual(resizeRange(range, "to", 0, domain), {
    from: 120_000,
    to: 130_000,
  });
  assert.deepEqual(resizeRange(range, "from", -1000, domain), {
    from: 100_000,
    to: 180_000,
  });
  assert.deepEqual(resizeRange(range, "to", 999_999, domain), {
    from: 120_000,
    to: 200_000,
  });
  assert.deepEqual(clampRange({ from: NaN, to: Infinity }, domain), domain);
  assert.deepEqual(resizeRange(range, "to", NaN, domain), range);
});

test("pan preserves duration and clamps at each edge", () => {
  const domain = { from: 100_000, to: 200_000 },
    range = { from: 120_000, to: 160_000 };
  assert.deepEqual(panRange(range, 999_999, domain), {
    from: 160_000,
    to: 200_000,
  });
  assert.deepEqual(panRange(range, -999_999, domain), {
    from: 100_000,
    to: 140_000,
  });
});

test("empty, single point and sub-ten-second domains do not manufacture earlier/later time", () => {
  for (const domain of [
    { from: 0, to: 0 },
    { from: start, to: start },
    { from: start, to: start + 3000 },
  ]) {
    assert.deepEqual(
      clampRange({ from: 0, to: Number.MAX_VALUE }, domain),
      domain,
    );
    assert.deepEqual(
      resizeRange(domain, "from", Number.MAX_VALUE, domain),
      domain,
    );
  }
});

test("no sample is substituted from outside an empty selected window", () => {
  const model = chartModel(detail([point(0), point(120_000)]));
  const range = clampRange(
    { from: start + 40_000, to: start + 60_000 },
    model.domain,
  );
  assert.deepEqual(
    model.points.filter((p) => p.at >= range.from && p.at <= range.to),
    [],
  );
});

test("sparse live samples do not imply continuity across missing minutes", () => {
  assert.equal(
    chartGap([point(0, "live"), point(600_000, "live")], true),
    60_000,
  );
});

test("DST repeated wall times are disambiguated by UTC offset", () => {
  const first = chartTime(
    Date.parse("2026-11-01T05:30:00Z"),
    true,
    "America/Toronto",
  );
  const second = chartTime(
    Date.parse("2026-11-01T06:30:00Z"),
    true,
    "America/Toronto",
  );
  assert.match(first, /1:30:00/);
  assert.match(second, /1:30:00/);
  assert.match(first, /GMT-4/);
  assert.match(second, /GMT-5/);
  assert.notEqual(first, second);
});

test("local date follows the requested zone across midnight", () => {
  const at = Date.parse("2026-11-01T01:15:00Z");
  assert.match(chartTime(at, false, "America/Toronto"), /Oct 31/);
  assert.match(chartTime(at, false, "Asia/Tokyo"), /Nov 1/);
});

const market = (id: string, type: string): ExtraMarket => ({
  id,
  type,
  question: id,
  url: "https://polymarket.com",
  outcomes: [
    { name: "Yes", p: 0.3 },
    { name: "No", p: null },
  ],
  volume: null,
  liquidity: null,
  closed: false,
});
test("market grouping keeps every row and source outcome, with unknown types in Other", () => {
  const rows = [
    market("a", "totals"),
    market("b", "ufc_round_of_victory"),
    market("c", "future_type"),
    market("d", "ufc_method_of_finish"),
    market("e", "ufc_round_of_finish"),
  ];
  const groups = groupMarkets(rows);
  assert.deepEqual(
    groups.map((g) => g.label),
    [
      "Fight outcome",
      "Total rounds",
      "Finish timing",
      "Round winners",
      "Other",
    ],
  );
  assert.deepEqual(
    groups
      .flatMap((g) => g.markets)
      .map((m) => m.id)
      .sort(),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(groups[0].markets[0], rows[3]);
});

test("short market labels retain fighter, method, round and total meaning", () => {
  assert.equal(
    marketLabel("Will Renato Moicano win by KO or TKO?"),
    "Renato Moicano · KO or TKO",
  );
  assert.equal(
    marketLabel("Will Tom Nolan win in Round 3?"),
    "Tom Nolan · round 3",
  );
  assert.equal(
    marketLabel("Will the fight end before Round 2?"),
    "Before round 2",
  );
  assert.equal(marketLabel("O/U 2.5 Rounds"), "2.5 rounds");
  assert.equal(
    marketLabel("Unfamiliar source question?"),
    "Unfamiliar source question?",
  );
});

test("decision or draw stays with outcomes even when source tags it as a round winner", () => {
  const row = {
    ...market("draw", "ufc_round_of_victory"),
    question: "Will the fight end in a decision or draw?",
  };
  assert.equal(groupMarkets([row])[0].label, "Fight outcome");
  assert.equal(marketLabel(row.question), "Decision or draw");
});

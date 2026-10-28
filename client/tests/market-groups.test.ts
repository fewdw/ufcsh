import assert from "node:assert/strict";
import test from "node:test";
import { marketTables } from "../src/market-groups.ts";
import type { ExtraMarket } from "../src/polymarket-types.ts";

const market = (
  id: string,
  outcomes: ExtraMarket["outcomes"],
  type = "ufc_method_of_victory",
): ExtraMarket => ({
  id,
  question: id,
  type,
  outcomes,
  url: "https://polymarket.com",
  volume: null,
  liquidity: null,
  closed: false,
});

test("reversed Yes/No source outcomes align by name and retain their exact prices", () => {
  const forward = market("a", [
    { name: "Yes", p: 0.3 },
    { name: "No", p: 0.7 },
  ]);
  const reverse = market("b", [
    { name: "No", p: 0.2 },
    { name: "Yes", p: 0.8 },
  ]);
  const tables = marketTables([forward, reverse]);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].columns, ["Yes", "No"]);
  assert.deepEqual(tables[0].rows[1].outcomes, [
    { name: "Yes", p: 0.8 },
    { name: "No", p: 0.2 },
  ]);
  assert.equal(reverse.outcomes[0].name, "No");
  assert.equal(tables[0].rows[1].market, reverse);
});

test("Over/Under columns use consistent order without replacing missing prices", () => {
  const row = market(
    "total",
    [
      { name: "Under", p: null },
      { name: "Over", p: 0.6 },
    ],
    "totals",
  );
  const [table] = marketTables([row]);
  assert.deepEqual(table.columns, ["Over", "Under"]);
  assert.deepEqual(table.rows[0].outcomes, [
    { name: "Over", p: 0.6 },
    { name: "Under", p: null },
  ]);
});

test("different outcome labels get separate table headers even inside the same market category", () => {
  const rows = [
    market("yes", [
      { name: "Yes", p: 0.7 },
      { name: "No", p: 0.3 },
    ]),
    market("draw", [
      { name: "Draw", p: 0.1 },
      { name: "No draw", p: 0.9 },
    ]),
  ];
  const tables = marketTables(rows);
  assert.equal(tables.length, 2);
  assert.notEqual(tables[0].key, tables[1].key);
  assert.deepEqual(tables[1].columns, ["Draw", "No draw"]);
});

test("unknown multi-outcome markets keep their names, probabilities and source order", () => {
  const outcomes = [
    { name: "Decision", p: 0.5 },
    { name: "KO", p: 0.3 },
    { name: "Submission", p: 0.2 },
  ];
  const [table] = marketTables([market("other", outcomes, "unfamiliar")]);
  assert.equal(table.label, "Other");
  assert.deepEqual(
    table.columns,
    outcomes.map((o) => o.name),
  );
  assert.equal(table.rows[0].outcomes, outcomes);
});

test("duplicate or empty source outcome names do not overwrite or fabricate outcomes", () => {
  const outcomes = [
    { name: "Yes", p: 0.4 },
    { name: "Yes", p: 0.6 },
  ];
  const tables = marketTables([
    market("duplicate", outcomes),
    market("empty", []),
  ]);
  assert.deepEqual(tables[0].rows[0].outcomes, outcomes);
  assert.deepEqual(tables[1].columns, []);
  assert.equal(tables[1].rows[0].market.id, "empty");
});

test("every market survives table grouping exactly once", () => {
  const rows = [
    market("one", [
      { name: "Yes", p: 0.4 },
      { name: "No", p: 0.6 },
    ]),
    market(
      "two",
      [
        { name: "Over", p: 0.4 },
        { name: "Under", p: 0.6 },
      ],
      "totals",
    ),
    market("three", [{ name: "Yes", p: 0.4 }], "ufc_round_of_finish"),
  ];
  assert.deepEqual(
    marketTables(rows)
      .flatMap((t) => t.rows)
      .map((r) => r.market.id)
      .sort(),
    ["one", "three", "two"],
  );
});

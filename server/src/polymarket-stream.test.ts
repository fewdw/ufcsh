import test from "node:test";
import assert from "node:assert/strict";
import { updateMarketBooks, type Books } from "./polymarket-stream.ts";

const tokens: [string, string] = ["111", "222"];
const initial = (): Books => [
  {
    asset_id: "111",
    bids: [{ price: "0.4", size: "100" } as { price: string }],
    asks: [{ price: "0.42", size: "200" } as { price: string }],
  },
  undefined,
];

test("stream deltas remove zero-sized orders and preserve book sizes without mutating snapshots", () => {
  const previous = initial();
  const updates = updateMarketBooks(tokens, previous, {
    event_type: "price_change",
    price_changes: [
      { asset_id: "111", side: "BUY", price: "0.4", size: "0" },
      { asset_id: "111", side: "BUY", price: "0.41", size: "50" },
    ],
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].index, 0);
  assert.deepEqual(updates[0].books[0]?.bids, [{ price: "0.41", size: "50" }]);
  assert.deepEqual(previous[0]?.bids, [{ price: "0.4", size: "100" }]);
  assert.deepEqual(updates[0].books[0]?.asks, previous[0]?.asks);
});

test("unknown tokens, missing snapshots, invalid prices and non-sized frames cannot create depth", () => {
  for (const message of [
    null,
    {
      event_type: "best_bid_ask",
      asset_id: "111",
      best_bid: "0.5",
      best_ask: "0.6",
    },
    {
      event_type: "price_change",
      price_changes: [
        { asset_id: "wrong", side: "BUY", price: "0.6", size: "1" },
      ],
    },
    {
      event_type: "price_change",
      price_changes: [
        { asset_id: "222", side: "BUY", price: "0.6", size: "1" },
      ],
    },
    {
      event_type: "price_change",
      price_changes: [{ asset_id: "111", side: "BUY", price: "2", size: "1" }],
    },
    {
      event_type: "price_change",
      price_changes: [
        { asset_id: "111", side: "BUY", price: "0.6", size: null },
      ],
    },
  ])
    assert.deepEqual(updateMarketBooks(tokens, initial(), message), []);
  const snapshot = {
    event_type: "book",
    asset_id: "222",
    bids: [{ price: "0.6", size: "200" }],
    asks: [],
  };
  assert.deepEqual(
    updateMarketBooks(tokens, initial(), snapshot)[0].books[1],
    snapshot,
  );
});

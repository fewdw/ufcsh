import test from "node:test";
import assert from "node:assert/strict";
import { closingMeanPrice, decodePriceHistory, meanPrices } from "./method-odds.ts";

const encode = (value: unknown) => Buffer.from([...JSON.stringify(value)].map((c) => {
  const n = c.charCodeAt(0);
  return n >= 33 && n <= 126 ? String.fromCharCode(33 + (n - 33 + 47) % 94) : c;
}).join("")).toString("base64");

test("mean history decodes and closes on the last quoted point", () => {
  const history = decodePriceHistory(encode([{ name: "Mean", data: [{ x: 3, y: 1.5 }, { x: 1, y: 2.05 }, { x: 2, y: 2.35 }] }]));
  assert.equal(closingMeanPrice(history), "-200");
  assert.equal(closingMeanPrice([{ name: "Mean", data: [{ x: 1, y: 3.5 }] }]), "+250");
});

test("withdrawn points are skipped and empty or malformed history yields nothing", () => {
  assert.equal(closingMeanPrice([{ name: "Mean", data: [{ x: 1, y: 2.2 }, { x: 2, y: null }] }]), "+120");
  assert.equal(closingMeanPrice([{ name: "Mean", data: [] }]), null);
  assert.equal(closingMeanPrice([{ name: "Mean", data: [{ x: 1, y: 1 }] }]), null);
  assert.equal(closingMeanPrice({}), null);
});

test("mean moneyline opens on the first quoted point and closes on the last", () => {
  assert.deepEqual(meanPrices([{ name: "Mean", data: [{ x: 2, y: 1.5 }, { x: 1, y: 1.8 }, { x: 3, y: null }] }]), { open: "-125", close: "-200" });
  assert.equal(meanPrices([{ name: "Mean", data: [{ x: 1, y: null }] }]), null);
});

test("a chart that sat dormant as a hypothetical line opens where books reopened it", () => {
  const day = 86_400_000;
  // Posted as a potential fight, untouched for five months, then booked.
  const data = [{ x: 0, y: 1.5 }, { x: 2 * day, y: 1.52 }, { x: 150 * day, y: 2.58 }, { x: 160 * day, y: 3.68 }];
  assert.deepEqual(meanPrices([{ name: "Mean", data }]), { open: "+158", close: "+268" });
  // Ordinary fight-week gaps keep the first quote.
  const booked = [{ x: 0, y: 2.2 }, { x: 30 * day, y: 2.4 }, { x: 40 * day, y: 2.5 }];
  assert.equal(meanPrices([{ name: "Mean", data: booked }])?.open, "+120");
});

test("an opening quote reversed within the hour is a mis-post, not the open", () => {
  const minute = 60_000;
  const data = [{ x: 0, y: 1 / 0.73 }, { x: 6 * minute, y: 1 / 0.32 }, { x: 600 * minute, y: 1 / 0.31 }];
  assert.equal(meanPrices([{ name: "Mean", data }])?.open, "+213");
  // A steady move over days is the market, and keeps its first quote.
  const moved = [{ x: 0, y: 1 / 0.31 }, { x: 3 * 1440 * minute, y: 1 / 0.74 }];
  assert.equal(meanPrices([{ name: "Mean", data: moved }])?.open, "+223");
});

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

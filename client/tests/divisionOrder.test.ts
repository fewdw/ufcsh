import test from "node:test";
import assert from "node:assert/strict";
import { orderDivisions } from "../src/divisionOrder.ts";

const divisions = [
  { division: "Men's Pound-for-Pound", weight_limit: "" },
  { division: "Flyweight", weight_limit: "125 lbs" },
  { division: "Lightweight", weight_limit: "155 lbs" },
  { division: "Heavyweight", weight_limit: "265 lbs" },
  { division: "Women's Pound-for-Pound", weight_limit: "" },
  { division: "Women's Strawweight", weight_limit: "115 lbs" },
  { division: "Women's Bantamweight", weight_limit: "135 lbs" },
];
const names = (order: "light" | "heavy") => orderDivisions(divisions, order).map((d) => d.division);

test("running up the scale puts pound-for-pound at the top of each half", () => {
  assert.deepEqual(names("light"), [
    "Men's Pound-for-Pound", "Flyweight", "Lightweight", "Heavyweight",
    "Women's Pound-for-Pound", "Women's Strawweight", "Women's Bantamweight",
  ]);
});

test("running down the scale reverses the divisions and leaves the halves in place", () => {
  assert.deepEqual(names("heavy"), [
    "Heavyweight", "Lightweight", "Flyweight", "Men's Pound-for-Pound",
    "Women's Bantamweight", "Women's Strawweight", "Women's Pound-for-Pound",
  ]);
});

test("the men's half always comes first, whatever order the source sent", () => {
  const shuffled = [...divisions].reverse();
  for (const order of ["light", "heavy"] as const) {
    const women = orderDivisions(shuffled, order).findIndex((d) => d.division.startsWith("Women's"));
    const men = orderDivisions(shuffled, order).filter((d) => !d.division.startsWith("Women's")).length;
    assert.equal(women, men, "every women's division sits after every men's one");
  }
});

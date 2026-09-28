import test from "node:test";
import assert from "node:assert/strict";
import { searchList } from "../src/search.ts";

const venues = ["T-Mobile Arena, Las Vegas", "Madison Square Garden, New York", "UFC APEX, Las Vegas", "Rogers Place, Edmonton", "Accor Arena, Paris"];
const find = (query: string, rows = venues) => searchList(rows, query, (row) => row);

test("spacing, punctuation and case never matter", () => {
  for (const query of ["tmobile", "T Mobile", "t-mobile", "TMOB", "mobile arena"]) assert.deepEqual(find(query), ["T-Mobile Arena, Las Vegas"], query);
  assert.deepEqual(find("lasvegas"), ["T-Mobile Arena, Las Vegas", "UFC APEX, Las Vegas"]);
  assert.deepEqual(find("ufcapex"), ["UFC APEX, Las Vegas"]);
});

test("words in any order, cut short", () => {
  assert.deepEqual(find("vegas apex"), ["UFC APEX, Las Vegas"]);
  assert.deepEqual(find("madis gard"), ["Madison Square Garden, New York"]);
});

test("typos only when nothing matches as typed", () => {
  assert.deepEqual(find("madisn square"), ["Madison Square Garden, New York"]);
  assert.deepEqual(find("edmontn"), ["Rogers Place, Edmonton"]);
  const officials = ["Herb Dean", "Sean Shelby", "Dan Miragliotta"];
  assert.deepEqual(find("harb dean", officials), ["Herb Dean"]);
  // "dean" is found as typed, so no one is added for being a letter away.
  assert.deepEqual(find("dean", officials), ["Herb Dean"]);
});

test("an empty query keeps every row; a stranger finds none", () => {
  assert.equal(find("  ").length, venues.length);
  assert.deepEqual(find("zzzz"), []);
});

test("a one-letter word must start a word", () => {
  assert.deepEqual(find("t mobile", ["T-Mobile Arena", "Xfinity Mobile Arena"]), ["T-Mobile Arena"]);
});

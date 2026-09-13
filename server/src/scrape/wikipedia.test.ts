import test from "node:test";
import assert from "node:assert/strict";
import { infoboxDate, plainText, weightMisses } from "./wikipedia.ts";

const article = (background: string, results = "") =>
  `{{Infobox MMA event\n| date = {{start date|2024|01|20}}\n}}\n==Background==\n${background}\n==Results==\n${results}`;

test("infobox dates read both the template and written forms", () => {
  assert.equal(infoboxDate(article("")), "2024-01-20");
  assert.equal(infoboxDate("| date = August 11, 2012\n"), "2012-08-11");
});

test("plain text drops references and templates and keeps link text", () => {
  assert.equal(plainText("[[Malcolm Gordon (fighter)|Malcolm Gordon]] missed<ref name=x>{{cite web|a=b}}</ref> weight."), "Malcolm Gordon missed weight.");
});

test("two misses named in one sentence pair with their weights in order", () => {
  const text = article("At the weigh-ins, Ramon Taveras and [[Malcolm Gordon (fighter)|Malcolm Gordon]] missed weight. Taveras weighed in at 139.75 pounds, three and three quarters pounds over the bantamweight non-title fight limit. Gordon weighed in at 127.5 pounds, one and a half pounds over the flyweight non-title fight limit.");
  assert.deepEqual(weightMisses(text, ["Ramon Taveras", "Charles Johnson", "Malcolm Gordon", "Aoriqileng"]), [
    { name: "Ramon Taveras", pounds: 139.75 },
    { name: "Malcolm Gordon", pounds: 127.5 },
  ]);
  const both = article("At the weigh ins, both fighters missed weight. Cháirez weighed in at 131 pounds and Lacerda at 127 pounds, five pounds and one pound over the flyweight non-title fight limit, respectively.");
  assert.deepEqual(weightMisses(both, ["Edgar Chairez", "Daniel Lacerda"]), [
    { name: "Edgar Chairez", pounds: 131 },
    { name: "Daniel Lacerda", pounds: 127 },
  ]);
});

test("one weight stated for two fighters applies to both", () => {
  const text = article("At the weigh-ins, four fighters missed weight:\n*Wang Cong and Eduarda Moura weighed in at 127.5 pounds, one and a half pounds over the women's flyweight non-title fight limit, respectively.\n*Muin Gafurov weighed in at 141 pounds, five pounds over the bantamweight non-title fight limit.\n\nGafurov was fined 25 percent of his purse which went to his opponent Jakub Wikłacz.");
  assert.deepEqual(weightMisses(text, ["Wang Cong", "Eduarda Moura", "Jakub Wiklacz", "Muin Gafurov"]), [
    { name: "Wang Cong", pounds: 127.5 },
    { name: "Eduarda Moura", pounds: 127.5 },
    { name: "Muin Gafurov", pounds: 141 },
  ]);
});

test("the opponent who receives the fine is never marked", () => {
  const text = article("At the weigh-ins, Mullins weighed in at 137 pounds, one pound over the bantamweight non-title fight limit. The bout proceeded at catchweight and she was fined 20 percent of her purse, which went to Syguła.");
  assert.deepEqual(weightMisses(text, ["Melissa Mullins", "Klaudia Sygula"]), [{ name: "Melissa Mullins", pounds: 137 }]);
  const fined = article("Diego Brandão weighed in seven pounds over the featherweight limit of 146 lb. Half of the fine went to Dustin Poirier.");
  assert.deepEqual(weightMisses(fined, ["Diego Brandao", "Dustin Poirier"]), [{ name: "Diego Brandao", pounds: null }]);
});

test("a missing weight falls back to the catchweight the bout went ahead at", () => {
  const text = article(
    "At the weigh-ins, Melvin Guillard was the only one of 20 fighters who missed weight.",
    "{{MMAevent bout |Catchweight (157.5 lb) |Donald Cerrone |def. |[[Melvin Guillard]] |KO |1 |1:16}}",
  );
  assert.deepEqual(weightMisses(text, ["Donald Cerrone", "Melvin Guillard"]), [{ name: "Melvin Guillard", pounds: 157.5 }]);
});

test("misses at other events and fighters who made weight are ignored", () => {
  const text = article("Jeremy Stephens, who missed weight at UFC 189, faced Calvin Kattar. Both fighters made weight on their second attempt.");
  assert.deepEqual(weightMisses(text, ["Jeremy Stephens", "Calvin Kattar"]), []);
});

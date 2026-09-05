import test from "node:test";
import assert from "node:assert/strict";
import { getLabs, getLabsFill, getLabsMatchups, type FillCondition, type FillMode, type FillValues } from "./labs.ts";

type Fill = {
  pov: "a" | "b";
  mode: FillMode;
  filters: FillValues;
  n: number;
  conditions: FillCondition[];
  dropped: { id: string; label: string }[];
  floor: number;
};

const matchups = () => (getLabsMatchups(new URLSearchParams()) as { matchups: { fight_id: string }[] }).matchups;
const fill = (fightId: string, mode: FillMode, pov: "a" | "b" = "a") =>
  getLabsFill(new URLSearchParams({ fight: fightId, pov, mode })) as Fill;

/** The population a set of filter values actually holds, counted the same way
 * the board counts it, so the fill's own numbers can be checked against it. */
const observations = (values: FillValues): number => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.set(key, Array.isArray(value) ? value.join(",") : value);
  return (getLabs(params) as { coverage: { observations: number } }).coverage.observations;
};
const merge = (conditions: FillCondition[]) => {
  const values: FillValues = {};
  for (const condition of conditions) Object.assign(values, condition.values);
  return values;
};

const sample = matchups().slice(0, 6);

test("there is an announced matchup to fill from", () => {
  assert.ok(sample.length, "the archive should hold announced matchups");
  assert.equal((getLabsFill(new URLSearchParams({ fight: "nope" })) as { error: string }).error, "not found");
});

test("every condition is a switchable unit with a stable identity", () => {
  for (const matchup of sample) {
    for (const mode of ["basic", "normal", "advanced"] as const) {
      const result = fill(matchup.fight_id, mode);
      const ids = [...result.conditions.map((c) => c.id), ...result.dropped.map((c) => c.id)];
      assert.equal(new Set(ids).size, ids.length, "two conditions may not share an id");
      for (const condition of result.conditions) {
        assert.ok(condition.label.length, "a condition the reader can switch must say what it is");
        assert.deepEqual(condition.keys, Object.keys(condition.values));
        assert.ok(condition.keys.length, "a condition must own at least one filter");
        assert.equal(condition.n == null, !condition.on, "a running total belongs to an applied condition");
      }
    }
  }
});

test("the filled study is exactly its switched-on conditions", () => {
  for (const matchup of sample) {
    for (const mode of ["basic", "normal", "advanced"] as const) {
      const result = fill(matchup.fight_id, mode);
      assert.deepEqual(result.filters, merge(result.conditions.filter((c) => c.on)));
      assert.equal(result.n, observations(result.filters), "the reported population is the one the board finds");
      const last = result.conditions.filter((c) => c.on).at(-1);
      if (last) assert.equal(last.n, result.n);
    }
  }
});

test("the matchup's own identity is always on, whatever it costs", () => {
  for (const matchup of sample) {
    for (const mode of ["basic", "normal", "advanced"] as const) {
      const result = fill(matchup.fight_id, mode);
      const base = result.conditions.filter((c) => c.base);
      assert.ok(base.length, "a matchup always contributes its own shape");
      for (const condition of base) assert.equal(condition.on, true);
      assert.ok(!result.dropped.some((d) => base.some((b) => b.id === d.id)));
    }
  }
});

test("advanced offers every condition normal did, and more of them", () => {
  let widened = 0;
  for (const matchup of sample) {
    const basic = fill(matchup.fight_id, "normal");
    const advanced = fill(matchup.fight_id, "advanced");
    const offered = new Set([...advanced.conditions.map((c) => c.id), ...advanced.dropped.map((c) => c.id)]);
    for (const condition of basic.conditions) assert.ok(offered.has(condition.id), `advanced lost ${condition.id}`);
    const on = (result: Fill) => result.conditions.filter((c) => c.on).length;
    assert.ok(on(advanced) >= on(basic), "advanced should never apply fewer conditions than basic");
    if (on(advanced) > on(basic)) widened += 1;
  }
  assert.ok(widened, "advanced should add conditions basic could not afford");
});

test("a listed condition has precedent; a dropped one has none", () => {
  const result = fill(sample[0].fight_id, "advanced");
  const identity = merge(result.conditions.filter((c) => c.base));
  for (const condition of result.conditions.filter((c) => !c.base)) {
    assert.equal(condition.alone, observations({ ...identity, ...condition.values }), `${condition.id} misreports what it holds alone`);
    assert.ok(condition.alone > 0, `${condition.id} should not be offered without precedent`);
  }
  for (const condition of result.dropped) {
    const values = result.conditions.find((c) => c.id === condition.id)?.values;
    assert.equal(values, undefined, "a dropped condition is not also a listed one");
  }
});

test("switching a condition off widens the study and keeps the rest", () => {
  const result = fill(sample[0].fight_id, "advanced");
  const on = result.conditions.filter((c) => c.on);
  assert.ok(on.length > 1);
  for (const condition of on) {
    const without = merge(on.filter((c) => c.id !== condition.id));
    const widened = observations(without);
    assert.ok(widened >= result.n, `switching off ${condition.id} narrowed the study`);
    // The other conditions are still doing their work.
    for (const kept of on) {
      if (kept.id === condition.id) continue;
      for (const [key, value] of Object.entries(kept.values)) {
        const overwritten = on.some((later) => on.indexOf(later) > on.indexOf(kept) && later.id !== condition.id && key in later.values);
        if (!overwritten) assert.deepEqual(without[key], value, `${kept.id} lost ${key}`);
      }
    }
  }
});

test("a narrower condition sharpens the wider one it overwrites", () => {
  const result = fill(sample[0].fight_id, "advanced");
  const byId = new Map(result.conditions.map((c) => [c.id, c]));
  const pairs: [string, string][] = [["ageA", "ageATight"], ["ageB", "ageBTight"], ["expA", "expATight"], ["probA", "probATight"]];
  let checked = 0;
  for (const [wide, tight] of pairs) {
    const a = byId.get(wide);
    const b = byId.get(tight);
    if (!a || !b) continue;
    checked += 1;
    assert.deepEqual(b.keys, a.keys, `${tight} must own the same filters as ${wide} to replace it`);
    assert.ok(result.conditions.indexOf(b) > result.conditions.indexOf(a), `${tight} must be applied after ${wide}`);
    if (b.on && a.on) assert.ok(b.alone <= a.alone, `${tight} should not hold more than ${wide}`);
  }
  assert.ok(checked, "the advanced fill should offer narrower versions of its bands");
});

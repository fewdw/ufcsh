import test from "node:test";
import assert from "node:assert/strict";
import { markRosterSeen, seedRosterSeen, unseenMoves } from "../src/rosterSeen.ts";
import type { RosterMove, RosterMoves } from "../src/api.ts";

test("roster counts only changes since the last visit and clears when opened", () => {
  const values = new Map<string, string>();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  const move = (name: string) => ({ name, date: null } as RosterMove);
  const first: RosterMoves = { updated_at: null, signed: [move("A")], cut: [move("B")] };
  try {
    seedRosterSeen(first);
    assert.equal(unseenMoves(first).size, 0);
    const next = { ...first, signed: [...first.signed, move("C")], cut: [...first.cut, move("D")] };
    assert.equal(unseenMoves(next).size, 2);
    markRosterSeen(next);
    assert.equal(unseenMoves(next).size, 0);
    next.signed[1].date = "2026-09-28";
    assert.equal(unseenMoves(next).size, 0, "correcting a date isn't a new signing");
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

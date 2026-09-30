import test from "node:test";
import assert from "node:assert/strict";

const INDEX = "ufcsh:snap-index:v1";
class Store {
  values = new Map<string, string>();
  blocked = false;
  getItem(key: string) { if (this.blocked) throw new Error("denied"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.blocked) throw new Error("denied"); this.values.set(key, value); }
  removeItem(key: string) { if (this.blocked) throw new Error("denied"); this.values.delete(key); }
}

test("malformed saved indexes recover and fresh snapshots survive reload", async () => {
  const store = new Store();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
  try {
    for (const [i, entries] of ["broken", [null], [["/a", "bad", Date.now()]], {}].entries()) {
      store.values.clear();
      store.setItem(INDEX, JSON.stringify({ build: "old", entries }));
      const snapshots = await import(`../src/snapshots.ts?malformed=${i}`);
      assert.equal(snapshots.readSnapshot("/a"), null);
      snapshots.writeSnapshot("/a", '{"fresh":true}');
      await new Promise(resolve => setTimeout(resolve, 230));
      assert.deepEqual(snapshots.readSnapshot("/a")?.data, { fresh: true });
      const reloaded = await import(`../src/snapshots.ts?reload=${i}`);
      assert.deepEqual(reloaded.readSnapshot("/a")?.data, { fresh: true });
    }
    const snapshots = await import("../src/snapshots.ts?revoked=1");
    snapshots.writeSnapshot("/b", "42");
    store.blocked = true;
    // A denied background write must not become an uncaught timer error.
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(snapshots.readSnapshot("/b"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

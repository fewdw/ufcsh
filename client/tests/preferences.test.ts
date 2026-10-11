import test from "node:test";
import assert from "node:assert/strict";

/** localStorage with a quota, counted in characters like the browsers do. */
class Store {
  values = new Map<string, string>();
  quota: number;
  constructor(quota = Infinity) { this.quota = quota; }
  private used() { let size = 0; for (const [key, value] of this.values) size += key.length + value.length; return size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    const before = this.values.get(key);
    this.values.set(key, value);
    if (this.used() > this.quota) {
      if (before == null) this.values.delete(key); else this.values.set(key, before);
      throw new DOMException("full", "QuotaExceededError");
    }
  }
  removeItem(key: string) { this.values.delete(key); }
}

function withStore<T>(store: Store, run: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
  return run().finally(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
}

test("a saved choice survives a release that adds, renames or drops options", () => withStore(new Store(), async () => {
  const { readPreference, writePreference, oneOf } = await import("../src/preferences.ts");
  const { DEFAULT_SETTINGS, parseStatsSettings, openingStatsRequest } = await import("../src/statsDefaults.ts");
  assert.equal(readPreference("events:kind", "all", oneOf("all", "ppv", "fight_night")), "all");
  writePreference("events:kind", "ppv");
  writePreference("stats:includeWomen", true);
  assert.equal(readPreference("events:kind", "all", oneOf("all", "ppv", "fight_night")), "ppv");
  // A value this release no longer offers falls back to the default.
  assert.equal(readPreference("events:kind", "all", oneOf("all", "fight_night")), "all");
  assert.equal(readPreference("stats:includeWomen", false), true);
  assert.equal(readPreference("stats:includeWomen", "no"), "no", "a value of the wrong type is ignored");

  // Board options: a saved one is kept, an option added later starts at its
  // default, and one that no longer exists is dropped.
  const saved = parseStatsSettings({ limit: "50", retired: "x", minimumFights: 5 })!;
  assert.equal(saved.limit, "50");
  assert.equal(saved.minimumFights, DEFAULT_SETTINGS.minimumFights);
  assert.ok(!("retired" in saved));
  assert.equal(parseStatsSettings("broken"), undefined);

  writePreference("stats:settings", { ...DEFAULT_SETTINGS, limit: "50" }, DEFAULT_SETTINGS);
  // Only the change is kept, so a later release's new defaults still apply.
  assert.deepEqual(JSON.parse(localStorage.getItem("ufcsh:preferences:v1")!)["stats:settings"], { limit: "50" });
  writePreference("stats:includeInactiveFighters", true, true);
  assert.ok(!("stats:includeInactiveFighters" in JSON.parse(localStorage.getItem("ufcsh:preferences:v1")!)));
  const request = new URL(openingStatsRequest(), "http://x").searchParams;
  assert.equal(request.get("includeWomen"), "1");
  assert.equal(request.get("limit"), "50", "the prefetch asks for the board the reader will see");
}));

test("an unreadable store reads as defaults instead of throwing", () => withStore(new Store(), async () => {
  localStorage.setItem("ufcsh:preferences:v1", "{not json");
  const { readPreference, writePreference } = await import("../src/preferences.ts?broken=1");
  assert.equal(readPreference("discussion:sort", "top"), "top");
  writePreference("discussion:sort", "new");
  assert.equal(readPreference("discussion:sort", "top"), "new");
}));

test("a full store gives up saved page answers to keep a reader's choice", () => withStore(new Store(2_000), async () => {
  const snapshots = await import("../src/snapshots.ts?full=1");
  const { storeLocal } = await import("../src/preferences.ts?full=1");
  snapshots.writeSnapshot("/api/events", JSON.stringify("x".repeat(1_700)));
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.ok(snapshots.readSnapshot("/api/events"), "the cache filled the quota");
  storeLocal("ufcsh:settings:v1", JSON.stringify({ theme: "dark", padding: "y".repeat(400) }));
  assert.match(localStorage.getItem("ufcsh:settings:v1") ?? "", /dark/);
  assert.equal(snapshots.readSnapshot("/api/events"), null);
}));

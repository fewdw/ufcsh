import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { QueryPool } from "./query-pool.ts";

test("worker deadlines recover capacity after a stalled query", async t => {
  const source = `import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({ready:true});
    parentPort.on('message', ({id,url}) => {
      if(url === '/stall') return;
      parentPort.postMessage({id,result:{json:'42',status:200}});
    });`;
  const pool = new QueryPool(1, new URL(`data:text/javascript,${encodeURIComponent(source)}`), 1000);
  t.after(() => pool.close());
  assert.equal((await pool.run("/ok")).json, "42");
  await assert.rejects(pool.run("/stall"), /deadline/);
  for (let i = 0; i < 100; i++) { await sleep(30); if (pool.ready) break; }
  assert.equal((await pool.run("/recovered")).json, "42");
});

test("a refresh replaces every worker without losing capacity", async t => {
  // Each worker takes a moment to start, as a real one does building its indexes.
  const source = `import { parentPort, threadId } from 'node:worker_threads';
    await new Promise(r => setTimeout(r, 100));
    parentPort.on('message', ({id}) => parentPort.postMessage({id,result:{json:String(threadId),status:200}}));
    parentPort.postMessage({ready:true});`;
  const pool = new QueryPool(2, new URL(`data:text/javascript,${encodeURIComponent(source)}`), 1000);
  t.after(() => pool.close());
  for (let i = 0; i < 100; i++) { await sleep(10); if (pool.ready) break; }
  const before = new Set<string>();
  for (let i = 0; i < 10; i++) before.add((await pool.run("/q")).json);
  const pass = pool.refresh();
  assert.equal(pool.refresh(), pass, "concurrent calls share one pass");
  let answered = 0;
  let done = false;
  void pass.then(() => { done = true; });
  while (!done) {
    const started = Date.now();
    assert.equal((await pool.run("/q")).status, 200);
    assert.ok(Date.now() - started < 50, "no request waits on a starting worker");
    assert.ok(pool.ready, "the pool stays ready throughout");
    answered++;
    await sleep(5);
  }
  assert.ok(answered > 10, "requests keep being answered during the refresh");
  const after = new Set<string>();
  for (let i = 0; i < 20; i++) after.add((await pool.run("/q")).json);
  assert.ok([...after].every(id => !before.has(id)), "only the new workers answer afterwards");
  assert.equal(after.size <= 2, true);
});

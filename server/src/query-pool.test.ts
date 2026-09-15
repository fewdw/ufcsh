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

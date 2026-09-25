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

test("a refresh takes one worker out of rotation at a time", async t => {
  const source = `import { parentPort, threadId } from 'node:worker_threads';
    parentPort.postMessage({ready:true});
    let refreshing = false;
    parentPort.on('message', async ({id,url,refresh}) => {
      if (refresh) { refreshing = true; await new Promise(r => setTimeout(r, 150)); refreshing = false; parentPort.postMessage({refreshed:true}); return; }
      parentPort.postMessage({id,result:{json:JSON.stringify({refreshing, threadId}),status:200}});
    });`;
  const pool = new QueryPool(2, new URL(`data:text/javascript,${encodeURIComponent(source)}`), 1000);
  t.after(() => pool.close());
  for (let i = 0; i < 100; i++) { await sleep(10); if (pool.ready) break; }
  const pass = pool.refresh();
  assert.equal(pool.refresh(), pass, "concurrent calls share one pass");
  const answers: { refreshing: boolean; threadId: number }[] = [];
  const started = Date.now();
  while (Date.now() - started < 250) {
    answers.push(JSON.parse((await pool.run("/q")).json));
    await sleep(5);
  }
  await pass;
  assert.ok(answers.length > 10, "requests keep being answered during the refresh");
  assert.ok(answers.every(answer => !answer.refreshing), "no request is sent to a refreshing worker");
  assert.equal((await pool.run("/after")).status, 200);
});

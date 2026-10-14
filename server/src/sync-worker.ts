import { hostname } from "node:os";
import { db, setMeta } from "./db.ts";
import { startScheduler } from "./sync.ts";
import { runRefreshJob } from "./api.ts";
import { drainRefreshJob } from "./refresh-queue.ts";
import { syncLease } from "./sync-lease.ts";
import { log } from "./util.ts";

let draining = false;
let stopping = false;
const lease = syncLease(db, `${hostname()}:${process.pid}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopping = true;
  // SQLite mutations are synchronous transactions. Signals run between those
  // transactions; interrupted network jobs are retried on the next startup.
  lease.release();
  db.close();
  process.exit(0);
});
// Exactly one sync worker owns scheduling. While a release overlaps the one it
// replaces, this worker waits for the old one to let go.
if (!lease.claim()) {
  log("sync worker waiting for the previous one to stop");
  while (!lease.claim()) await new Promise(resolve => setTimeout(resolve, 2000));
  log("sync worker took over");
}
// A process restart recovers interrupted jobs.
db.prepare("UPDATE refresh_jobs SET state = 'queued', available_at = ? WHERE state = 'running'").run(Date.now());
const drain = async () => {
  if (draining || stopping) return;
  draining = true;
  try { await drainRefreshJob(runRefreshJob); }
  catch (error) { console.error("refresh queue failed:", String(error)); }
  finally { draining = false; }
};
setMeta("sync_worker_heartbeat_at", String(Date.now()));
setInterval(() => {
  if (!lease.claim()) log("sync lease not renewed; another worker may hold it");
  setMeta("sync_worker_heartbeat_at", String(Date.now()));
}, 10_000);
setInterval(() => void drain(), 1000);
startScheduler();

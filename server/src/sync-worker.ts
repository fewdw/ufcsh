import { db, setMeta } from "./db.ts";
import { startScheduler } from "./sync.ts";
import { runRefreshJob } from "./api.ts";
import { drainRefreshJob } from "./refresh-queue.ts";

// Exactly one sync worker owns scheduling. A process restart recovers interrupted jobs.
db.prepare("UPDATE refresh_jobs SET state = 'queued', available_at = ? WHERE state = 'running'").run(Date.now());
let draining = false;
let stopping = false;
const drain = async () => {
  if (draining || stopping) return;
  draining = true;
  try { await drainRefreshJob(runRefreshJob); }
  catch (error) { console.error("refresh queue failed:", String(error)); }
  finally { draining = false; }
};
setMeta("sync_worker_heartbeat_at", String(Date.now()));
setInterval(() => setMeta("sync_worker_heartbeat_at", String(Date.now())), 10_000);
setInterval(() => void drain(), 1000);
startScheduler();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopping = true;
  // SQLite mutations are synchronous transactions. Signals run between those
  // transactions; interrupted network jobs are retried on the next startup.
  db.close();
  process.exit(0);
});

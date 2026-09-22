import { Worker } from "node:worker_threads";
import { OverloadedError, type ApiResult } from "./response-cache.ts";

type Job = { id: number; url: string; resolve: (value: ApiResult) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };
type Slot = { worker: Worker; ready: boolean; job?: Job };

/** Fixed-size pool with a bounded queue. A slow query cannot stall HTTP or health checks. */
export class QueryPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 0;
  private closed = false;
  private workerUrl: URL;
  private timeoutMs: number;
  private size: number;
  private maxQueue: number;
  // An uncached page costs about a millisecond, so 512 waiting jobs is a few
  // hundred milliseconds of work: bursts wait briefly instead of failing.
  constructor(size = 2, workerUrl = new URL("./query-worker.ts", import.meta.url), timeoutMs = 15_000, maxQueue = 512) {
    this.workerUrl = workerUrl; this.timeoutMs = timeoutMs; this.size = size; this.maxQueue = maxQueue;
    for (let i = 0; i < size; i++) this.spawn();
  }
  get ready() { return this.slots.length === this.size && this.slots.every(slot => slot.ready); }
  get pending() { return this.queue.length + this.slots.filter(slot => slot.job).length; }

  run(url: string): Promise<ApiResult> {
    if (this.closed || this.queue.length >= this.maxQueue) return Promise.reject(new OverloadedError("Query queue is full"));
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.nextId, url, resolve, reject };
      job.timer = setTimeout(() => {
        const index = this.queue.indexOf(job);
        if (index !== -1) this.queue.splice(index, 1);
        const slot = this.slots.find(slot => slot.job === job);
        reject(new OverloadedError("Query deadline exceeded"));
        if (slot) void slot.worker.terminate();
      }, this.timeoutMs);
      this.queue.push(job);
      this.dispatch();
    });
  }

  private spawn() {
    const worker = new Worker(this.workerUrl, { env: { ...process.env, DB_INIT: "0", SYNC_MODE: "external" } });
    const slot: Slot = { worker, ready: false };
    this.slots.push(slot);
    worker.on("message", message => {
      if (message.ready) { slot.ready = true; this.dispatch(); return; }
      const job = slot.job;
      if (!job || message.id !== job.id) return;
      clearTimeout(job.timer);
      slot.job = undefined;
      if (message.error) job.reject(new Error(message.error));
      else job.resolve(message.result);
      this.dispatch();
    });
    worker.on("error", error => console.error("query worker failed:", String(error)));
    worker.on("exit", () => {
      if (slot.job) { clearTimeout(slot.job.timer); slot.job.reject(new OverloadedError("Query worker stopped")); }
      this.slots = this.slots.filter(value => value !== slot);
      if (!this.closed) setTimeout(() => { if (!this.closed) this.spawn(); }, 1000).unref();
    });
  }

  private dispatch() {
    for (const slot of this.slots) {
      if (!slot.ready || slot.job || !this.queue.length) continue;
      slot.job = this.queue.shift()!;
      slot.worker.postMessage({ id: slot.job.id, url: slot.job.url });
    }
  }

  async close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) { clearTimeout(job.timer); job.reject(new OverloadedError("Server is stopping")); }
    await Promise.all(this.slots.map(slot => slot.worker.terminate()));
  }
}

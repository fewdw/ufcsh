import { Worker } from "node:worker_threads";
import { OverloadedError, type ApiResult } from "./response-cache.ts";

type Job = { id: number; url: string; resolve: (value: ApiResult) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };
/** `spare` is a replacement still starting; `retiring` finishes its job and stops. */
type Slot = { worker: Worker; ready: boolean; job?: Job; spare?: (ready: boolean) => void; retiring?: boolean };

/** Fixed-size pool with a bounded queue. A slow query cannot stall HTTP or health checks. */
export class QueryPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 0;
  private closed = false;
  private refreshing: Promise<void> | null = null;
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
  get ready() { return this.slots.filter(slot => slot.ready && !slot.retiring).length >= this.size; }
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

  /** Replace every worker with a freshly started one, which builds its
   *  indexes from the current data before it takes a request. One replacement
   *  starts at a time and the worker it replaces keeps answering until it is
   *  ready, so capacity never drops. Calls made during a pass share it. */
  refresh(deadlineMs = 120_000): Promise<void> {
    this.refreshing ??= (async () => {
      for (const old of this.slots.filter(slot => !slot.spare && !slot.retiring)) {
        if (this.closed) break;
        const fresh = await this.replacement(deadlineMs);
        if (!fresh) continue;
        // If the old worker died meanwhile, its own restart already replaced it.
        this.retire(this.slots.includes(old) && !old.retiring ? old : fresh);
      }
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private replacement(deadlineMs: number): Promise<Slot | null> {
    return new Promise(resolve => {
      const slot = this.spawn();
      const timer = setTimeout(() => { void slot.worker.terminate(); }, deadlineMs);
      slot.spare = ready => { clearTimeout(timer); slot.spare = undefined; resolve(ready ? slot : null); };
    });
  }

  private retire(slot: Slot) {
    slot.retiring = true;
    if (!slot.job) void slot.worker.terminate();
  }

  private spawn(): Slot {
    const worker = new Worker(this.workerUrl, { env: { ...process.env, DB_INIT: "0", SYNC_MODE: "external" } });
    const slot: Slot = { worker, ready: false };
    this.slots.push(slot);
    worker.on("message", message => {
      if (message.ready) { slot.ready = true; slot.spare?.(true); this.dispatch(); return; }
      const job = slot.job;
      if (!job || message.id !== job.id) return;
      clearTimeout(job.timer);
      slot.job = undefined;
      if (message.error) job.reject(new Error(message.error));
      else job.resolve(message.result);
      if (slot.retiring) void slot.worker.terminate();
      this.dispatch();
    });
    worker.on("error", error => console.error("query worker failed:", String(error)));
    worker.on("exit", () => {
      if (slot.job) { clearTimeout(slot.job.timer); slot.job.reject(new OverloadedError("Query worker stopped")); }
      this.slots = this.slots.filter(value => value !== slot);
      // A replacement that failed to start, or a retired worker, is not restarted.
      const replaced = Boolean(slot.spare) || Boolean(slot.retiring);
      slot.spare?.(false);
      if (!replaced && !this.closed) setTimeout(() => { if (!this.closed) this.spawn(); }, 1000).unref();
    });
    return slot;
  }

  private dispatch() {
    for (const slot of this.slots) {
      if (!slot.ready || slot.job || slot.retiring || !this.queue.length) continue;
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

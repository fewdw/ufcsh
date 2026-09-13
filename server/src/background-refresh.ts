/** Schedule source I/O after the response, deduplicating work and throttling
 * retries. The caller only reads cached data; it never waits for this work. */
export class BackgroundRefresh {
  private jobs = new Map<string, { pending: boolean; startedAt: number }>();

  request(key: string, work: () => Promise<unknown>, onError: (error: unknown) => void, cooldownMs = 30_000): boolean {
    const previous = this.jobs.get(key);
    if (previous?.pending) return true;
    if (previous && Date.now() - previous.startedAt < cooldownMs) return false;
    if (this.jobs.size >= 1000) {
      for (const [id, job] of this.jobs) {
        if (!job.pending) { this.jobs.delete(id); break; }
      }
      if (this.jobs.size >= 1000) return false;
    }
    const job = { pending: true, startedAt: Date.now() };
    this.jobs.set(key, job);
    setImmediate(() => {
      void Promise.resolve().then(work).catch(onError).finally(() => { job.pending = false; });
    });
    return true;
  }
}

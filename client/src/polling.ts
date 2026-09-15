type Poll = { intervals: Map<symbol, number>; failures: number; timer?: ReturnType<typeof setTimeout>; running: boolean };
type Environment = { active: () => boolean; listen: (changed: () => void) => () => void };

export function pollDelay(interval: number, failures: number, random = Math.random()): number {
  return Math.min(300_000, interval * 2 ** Math.min(failures, 6)) * (0.9 + random * 0.2);
}

/** One timer per URL, shared by all mounted consumers; hidden/offline tabs stop entirely. */
export class PollCoordinator {
  private entries = new Map<string, Poll>();
  private unlisten?: () => void;
  private load: (url: string) => Promise<boolean>;
  private environment: Environment;
  constructor(load: (url: string) => Promise<boolean>, environment: Environment = {
    active: () => !document.hidden && navigator.onLine !== false,
    listen: changed => {
      document.addEventListener("visibilitychange", changed);
      window.addEventListener("online", changed);
      window.addEventListener("offline", changed);
      return () => {
        document.removeEventListener("visibilitychange", changed);
        window.removeEventListener("online", changed);
        window.removeEventListener("offline", changed);
      };
    },
  }) { this.load = load; this.environment = environment; }

  watch(url: string, interval: number): () => void {
    if (!Number.isFinite(interval) || interval <= 0) return () => {};
    const id = Symbol();
    const entry: Poll = this.entries.get(url) ?? { intervals: new Map(), failures: 0, running: false };
    entry.intervals.set(id, interval);
    this.entries.set(url, entry);
    this.unlisten ??= this.environment.listen(() => {
      for (const [key, value] of this.entries) this.schedule(key, value, true);
    });
    this.schedule(url, entry);
    return () => {
      entry.intervals.delete(id);
      if (!entry.intervals.size) { clearTimeout(entry.timer); this.entries.delete(url); }
      else this.schedule(url, entry);
      if (!this.entries.size) { this.unlisten?.(); this.unlisten = undefined; }
    };
  }

  private schedule(url: string, entry: Poll, resume = false) {
    clearTimeout(entry.timer);
    if (entry.running || !this.environment.active() || !entry.intervals.size) return;
    const interval = Math.min(...entry.intervals.values());
    const delay = resume ? 500 + Math.random() * 1500 : pollDelay(interval, entry.failures);
    entry.timer = setTimeout(async () => {
      if (!this.environment.active()) return;
      entry.running = true;
      try { entry.failures = await this.load(url) ? 0 : entry.failures + 1; }
      catch { entry.failures++; }
      finally {
        entry.running = false;
        if (this.entries.get(url) === entry) this.schedule(url, entry);
      }
    }, delay);
  }
}

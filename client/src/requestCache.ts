export type ApiSnapshot = { data: unknown; loading: boolean; refreshing: boolean; error: boolean };
const EMPTY: ApiSnapshot = { data: null, loading: true, refreshing: false, error: false };

/** Bounded, shared requests. A failed refresh retains data and reports failure. */
export class RequestCache {
  private entries = new Map<string, ApiSnapshot>();
  private pending = new Map<string, Promise<void>>();
  private listeners = new Map<string, Set<() => void>>();
  private capacity: number;
  private fetcher: typeof fetch;

  constructor(capacity = 80, fetcher: typeof fetch = (...args) => fetch(...args)) {
    this.capacity = capacity;
    this.fetcher = fetcher;
  }

  read = (url: string): ApiSnapshot => this.entries.get(url) ?? EMPTY;

  subscribe(url: string, listener: () => void) {
    const subscribers = this.listeners.get(url) ?? new Set();
    subscribers.add(listener);
    this.listeners.set(url, subscribers);
    return () => {
      subscribers.delete(listener);
      if (!subscribers.size) this.listeners.delete(url);
      this.trim();
    };
  }

  private trim() {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.capacity) break;
      if (!this.listeners.has(key) && !this.pending.has(key)) this.entries.delete(key);
    }
  }

  private publish(url: string, snapshot: ApiSnapshot) {
    this.entries.delete(url);
    this.entries.set(url, snapshot);
    this.listeners.get(url)?.forEach((listener) => listener());
  }

  load(url: string): Promise<void> {
    const existing = this.pending.get(url);
    if (existing) return existing;
    const data = this.read(url).data;
    const request = Promise.resolve()
      .then(() => this.fetcher(url))
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((result) => this.publish(url, { data: result, loading: false, refreshing: false, error: false }))
      .catch(() => this.publish(url, { data, loading: false, refreshing: false, error: true }))
      .finally(() => {
        this.pending.delete(url);
        this.trim();
      });
    this.pending.set(url, request);
    this.publish(url, { data, loading: data == null, refreshing: true, error: false });
    return request;
  }
}

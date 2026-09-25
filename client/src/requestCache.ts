export type ApiSnapshot = { data: unknown; loading: boolean; refreshing: boolean; error: boolean };
/** Where answers outlive the page: read once per key, written after each fetch. */
export type Persistence = { read(key: string): { data: unknown } | null; write(key: string, text: string): void };
const EMPTY: ApiSnapshot = { data: null, loading: true, refreshing: false, error: false };

/** Bounded, shared requests. A failed refresh retains data and reports failure. */
export class RequestCache {
  private entries = new Map<string, ApiSnapshot>();
  private pending = new Map<string, Promise<void>>();
  private listeners = new Map<string, Set<() => void>>();
  private fetchedAt = new Map<string, number>();
  private capacity: number;
  private fetcher: typeof fetch;
  private persistence?: Persistence;
  private restored = new Set<string>();

  constructor(capacity = 80, fetcher: typeof fetch = (...args) => fetch(...args), persistence?: Persistence) {
    this.capacity = capacity;
    this.fetcher = fetcher;
    this.persistence = persistence;
  }

  /** A saved answer is shown at once and treated as due for a refresh, so
   *  the first load after a reload always asks the server. */
  read = (url: string): ApiSnapshot => {
    const entry = this.entries.get(url);
    if (entry || !this.persistence || this.restored.has(url)) return entry ?? EMPTY;
    if (this.restored.size > 2000) this.restored.clear();
    this.restored.add(url);
    const saved = this.persistence.read(url);
    if (!saved) return EMPTY;
    const snapshot = { data: saved.data, loading: false, refreshing: false, error: false };
    this.entries.set(url, snapshot);
    return snapshot;
  };

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
      if (!this.listeners.has(key) && !this.pending.has(key)) {
        this.entries.delete(key);
        this.fetchedAt.delete(key);
        this.restored.delete(key);
      }
    }
  }

  private publish(url: string, snapshot: ApiSnapshot) {
    this.entries.delete(url);
    this.entries.set(url, snapshot);
    this.listeners.get(url)?.forEach((listener) => listener());
  }

  load(url: string, maxAgeMs = 0, requestUrl = url): Promise<void> {
    const existing = this.pending.get(url);
    if (existing) return existing;
    if (maxAgeMs > 0 && !this.read(url).error && Date.now() - (this.fetchedAt.get(url) ?? 0) < maxAgeMs) return Promise.resolve();
    const data = this.read(url).data;
    const request = Promise.resolve()
      .then(() => this.fetcher(requestUrl, { signal: AbortSignal.timeout(20_000) }))
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((text) => {
        const result = JSON.parse(text);
        this.persistence?.write(url, text);
        this.fetchedAt.set(url, Date.now());
        this.publish(url, { data: result, loading: false, refreshing: false, error: false });
      })
      .catch(() => this.publish(url, { data, loading: false, refreshing: false, error: true }))
      .finally(() => {
        this.pending.delete(url);
        this.trim();
      });
    this.pending.set(url, request);
    this.publish(url, { data, loading: data == null, refreshing: true, error: false });
    return request;
  }

  /** Fetch one fresh public summary after a write while keeping the normal poll key. */
  async loadAfterWrite(url: string): Promise<void> {
    const pending = this.pending.get(url);
    if (pending) await pending;
    const separator = url.includes("?") ? "&" : "?";
    await this.load(url, 0, `${url}${separator}_after_write=${crypto.randomUUID()}`);
  }
}

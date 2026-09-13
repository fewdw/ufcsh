/** Bounded computed-data cache. A changed database version invalidates all
 * entries, including writes made by another process. */
export class VersionCache<T> {
  private version = "";
  private entries = new Map<string, T>();
  private capacity: number;
  constructor(capacity = 64) { this.capacity = capacity; }
  get(key: string, version: string): T | undefined {
    if (version !== this.version) {
      this.entries.clear();
      this.version = version;
    }
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}

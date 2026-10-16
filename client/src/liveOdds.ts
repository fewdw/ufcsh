import { useEffect, useSyncExternalStore } from "react";
import type { LiveOddsAnswer } from "./api";

/** How often the pill asks; the server reads Polymarket at most every 2s. */
export const ODDS_POLL_MS = 3_000;
/** An answer older than this is not shown: a stale price reads as a live one. */
export const ODDS_FRESH_MS = 15_000;
/** Keep asking this long after the card leaves /api/live, so the main event's
 *  result is still caught. */
const LINGER_MS = 90_000;

type Snapshot = { answer: LiveOddsAnswer | null; at: number };
const EMPTY: Snapshot = { answer: null, at: 0 };

/** One feed per URL, shared by every pill on the page. Not the shared API
 *  cache on purpose: that one keeps answers across reloads and through failed
 *  refreshes, and a price must never outlive its moment. */
class OddsFeed {
  snapshot: Snapshot = EMPTY;
  private url: string;
  private listeners = new Set<() => void>();
  private live = new Map<symbol, boolean>();
  private liveSeenAt = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(url: string) { this.url = url; }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.schedule(0);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) clearTimeout(this.timer);
    };
  };

  setLive(id: symbol, live: boolean | null) {
    if (live === null) this.live.delete(id);
    else this.live.set(id, live);
    if (live) this.liveSeenAt = Date.now();
    if (!this.running) this.schedule(0);
  }

  /** Re-render so freshness is judged again (after the tab was hidden). */
  touch() {
    this.snapshot = { ...this.snapshot };
    this.listeners.forEach((listener) => listener());
  }

  private wanted(): boolean {
    return [...this.live.values()].some(Boolean) || Boolean(this.snapshot.answer?.finished)
      || Date.now() - this.liveSeenAt < LINGER_MS;
  }

  schedule(delay: number) {
    clearTimeout(this.timer);
    if (this.running || !this.listeners.size || document.hidden || !this.wanted()) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private publish(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  private async tick() {
    this.running = true;
    try {
      const response = await fetch(this.url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(String(response.status));
      const answer = await response.json() as LiveOddsAnswer;
      this.failures = 0;
      this.publish({ answer, at: Date.now() });
      clearTimeout(this.staleTimer);
      this.staleTimer = setTimeout(() => this.touch(), ODDS_FRESH_MS + 100);
    } catch {
      this.failures++;
      this.touch();
    } finally {
      this.running = false;
      this.schedule(ODDS_POLL_MS * 2 ** Math.min(this.failures, 4));
    }
  }
}

const feeds = new Map<string, OddsFeed>();
function feedFor(url: string): OddsFeed {
  let feed = feeds.get(url);
  if (!feed) feeds.set(url, feed = new OddsFeed(url));
  return feed;
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    // Hidden: schedule() clears the timer and stops. Shown: ask straight away.
    for (const feed of feeds.values()) { feed.touch(); feed.schedule(300); }
  });
}

const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

/** The live odds answer while it is fresh, else null. `live` says a bout is
 *  on the pill; the feed keeps asking a little after it goes, for the result. */
export function useLiveOdds(url: string | null, live: boolean): LiveOddsAnswer | null {
  const feed = url ? feedFor(url) : null;
  const { answer, at } = useSyncExternalStore(feed ? feed.subscribe : noSubscribe, feed ? () => feed.snapshot : emptySnapshot);
  useEffect(() => {
    if (!feed) return;
    const id = Symbol();
    feed.setLive(id, live);
    return () => feed.setLive(id, null);
  }, [feed, live]);
  return answer && Date.now() - at < ODDS_FRESH_MS ? answer : null;
}

/** A price as Polymarket writes it: whole percents, half up, with <1% and
 *  >99% for the extremes a settled market never shows. */
export function percent(price: number): string {
  // Snapped to a millionth first, so 0.285 (28.499999… in floating point) is 29%.
  const hundredths = Math.round(price * 1e6) / 1e4;
  if (hundredths >= 100) return "100%";
  if (hundredths <= 0) return "0%";
  if (hundredths < 0.5) return "<1%";
  if (hundredths >= 99.5) return ">99%";
  return `${Math.round(hundredths)}%`;
}

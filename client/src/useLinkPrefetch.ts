import { useEffect } from "react";
import { prefetch } from "./api";
import { pageRequests } from "./pageRequests";
import { pageFor, pages } from "./pages";
import type { RankingSource } from "./settings";

/** Warm a page before it is opened: its code and its first data. */
function warm(url: URL, ranking: RankingSource) {
  if (url.origin !== window.location.origin) return;
  void pageFor(url.pathname)?.().catch(() => {});
  for (const request of pageRequests(url.pathname, url.search, ranking)) prefetch(request);
}

/** One delegated listener for every link in the app: pointing at a link (for
 *  a moment), focusing it or pressing it starts that page's code and data, so
 *  the click lands on a page that is already in hand. Once the first page is
 *  up, the code for the other pages loads in the background as well. */
export function useLinkPrefetch(ranking: RankingSource) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLAnchorElement | null = null;
    const cancel = () => { clearTimeout(timer); timer = undefined; target = null; };
    const enter = (event: Event) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (event.type !== "pointerover") { cancel(); warm(url, ranking); return; }
      if (target === anchor) return;
      cancel();
      target = anchor;
      timer = setTimeout(() => warm(url, ranking), 80);
    };
    const leave = (event: PointerEvent) => {
      if (target && (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget))) cancel();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("pointerdown", enter);
    document.addEventListener("touchstart", enter, { passive: true });
    return () => {
      cancel();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("pointerdown", enter);
      document.removeEventListener("touchstart", enter);
    };
  }, [ranking]);

  useEffect(() => {
    // Every page's code is small and cached for a year; fetching it while the
    // reader is looking at the first page means no later click waits on it.
    // Readers who asked their browser to save data keep loading on demand.
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const idle = (callback: () => void) => typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(callback, { timeout: 5000 }) : setTimeout(callback, 300);
    const loaders = Object.entries(pages).filter(([name]) => name !== "admin" && name !== "auth").map(([, load]) => load);
    let stopped = false;
    // One at a time, each when the page is idle, after the first page settles.
    const next = () => {
      const load = loaders.shift();
      if (!stopped && load) void load().catch(() => {}).finally(() => idle(next));
    };
    const start = window.setTimeout(() => idle(next), 2000);
    return () => { stopped = true; window.clearTimeout(start); };
  }, []);
}

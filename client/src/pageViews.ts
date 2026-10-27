/**
 * The page-view signal behind Admin → Traffic. Each view sends its path and
 * this browser's random visitor id, so a reader counts once however many pages
 * they open or addresses they come from (the server hashes the id; see
 * `server/src/visitors.ts`). The first page of a visit in a tab also sends the
 * site that linked here, by host only.
 */
const VISITOR_KEY = "ufcsh:visitor:v1";
const VISIT_KEY = "ufcsh:visit:v1";

function visitorId(): string {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && /^[A-Za-z0-9_-]{22}$/.test(saved)) return saved;
    const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    // No storage: the server falls back to the address and browser.
    return "";
  }
}

/** True once per tab: reloads and later pages are the same visit. */
function startsVisit(): boolean {
  try {
    if (sessionStorage.getItem(VISIT_KEY)) return false;
    sessionStorage.setItem(VISIT_KEY, "1");
    return true;
  } catch { return false; }
}

function referringHost(): string {
  try {
    const from = new URL(document.referrer);
    return from.host === window.location.host ? "" : from.hostname;
  } catch { return ""; }
}

export function sendPageView(path: string, admin: boolean): void {
  // Administrators and automated browsers (tests, honest crawlers) are not readers.
  if (admin || navigator.webdriver) return;
  const lines = [path, visitorId()];
  if (startsVisit()) lines.push(referringHost());
  void fetch("/api/pageview", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: lines.join("\n"),
    credentials: "omit", keepalive: true,
  }).catch(() => {});
}

/**
 * How the page this tab opened reached the reader, sent once as the tab is
 * hidden or left: time to its first byte, its first paint and its largest
 * paint (LCP), and the network the browser reports (Chromium only). The
 * server adds phone or desktop from the browser's name; Admin → Traffic shows
 * the percentiles (`server/src/page-timing.ts`). Later pages are drawn by the
 * app without a page load, so only the first is timed.
 */
export function watchPageTiming(admin: () => boolean): () => void {
  // A tab opened in the background paints when first shown: not the network's time.
  if (navigator.webdriver || document.visibilityState === "hidden" || typeof PerformanceObserver === "undefined") return () => {};
  let lcp: number | undefined;
  const largest = new PerformanceObserver(list => { lcp = list.getEntries().at(-1)?.startTime ?? lcp; });
  try { largest.observe({ type: "largest-contentful-paint", buffered: true }); }
  catch { /* Safari before 26 has no LCP; the other two still count. */ }
  let sent = false;
  const send = () => {
    if (sent || document.visibilityState !== "hidden" || admin()) return;
    sent = true;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
    const network = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
    const value = (ms: number | undefined) => ms != null && ms > 0 ? String(Math.round(ms)) : "-";
    const line = [value(navigation?.responseStart), value(fcp), value(lcp), network ?? "-"].join(" ");
    try { navigator.sendBeacon("/api/timing", new Blob([line], { type: "text/plain" })); } catch { /* the reader is leaving anyway */ }
  };
  document.addEventListener("visibilitychange", send);
  window.addEventListener("pagehide", send);
  return () => {
    largest.disconnect();
    document.removeEventListener("visibilitychange", send);
    window.removeEventListener("pagehide", send);
  };
}

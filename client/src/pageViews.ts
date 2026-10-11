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

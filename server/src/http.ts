import { createHash } from "node:crypto";
import { log } from "./util.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
// UFC's geo-redirected sites reject a Chrome user-agent when the rest of the
// request has Node's HTTP fingerprint (Fastly/Varnish error 54113). Identifying
// this service honestly avoids that false-positive bot rule.
const UFC_UA = "ufc.sh/1.0 (+https://ufc.sh)";

function userAgent(url: string): string {
  const hostname = new URL(url).hostname;
  const isUfcSite = hostname === "ufc.com"
    || hostname.endsWith(".ufc.com")
    || hostname === "ufcespanol.com"
    || hostname.endsWith(".ufcespanol.com");
  return isUfcSite ? UFC_UA : BROWSER_UA;
}

// Minimum gap between requests per host, so we stay a polite, low-volume client.
const HOST_GAP_MS: Record<string, number> = {
  "ufcstats.com": 700,
  "www.ufc.com": 1500,
  // One serialized request per second keeps the bulk odds import respectful
  // while allowing a full one-time career backfill to finish in minutes, not hours.
  "www.bestfightodds.com": 1000,
};
const DEFAULT_GAP_MS = 1000;

type HostState = { chain: Promise<void>; lastAt: number; cookie: string };
const hosts = new Map<string, HostState>();

function hostState(host: string): HostState {
  let s = hosts.get(host);
  if (!s) {
    s = { chain: Promise.resolve(), lastAt: 0, cookie: "" };
    hosts.set(host, s);
  }
  return s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function absorbCookies(state: HostState, res: Response): void {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const pair = raw.split(";")[0].trim();
    if (!pair) continue;
    const name = pair.split("=")[0];
    const existing = state.cookie
      .split("; ")
      .filter((c) => c && c.split("=")[0] !== name);
    existing.push(pair);
    state.cookie = existing.join("; ");
  }
}

/** Solve the site's proof-of-work interstitial exactly like its own script would. */
async function solveChallenge(state: HostState, origin: string, html: string): Promise<void> {
  const nonce = html.match(/nonce="([^"]+)"/)?.[1];
  const zeros = html.match(/new Array\((\d+)\+1\)\.join\('0'\)/)?.[1];
  if (!nonce || !zeros) throw new Error("unrecognized challenge page");
  const target = "0".repeat(Number(zeros));
  let n = 0;
  while (!createHash("sha256").update(`${nonce}:${n}`).digest("hex").startsWith(target)) n++;
  const res = await fetch(`${origin}/__c`, {
    method: "POST",
    headers: {
      "User-Agent": userAgent(origin),
      "Content-Type": "application/x-www-form-urlencoded",
      ...(state.cookie ? { Cookie: state.cookie } : {}),
    },
    body: `nonce=${encodeURIComponent(nonce)}&n=${n}`,
  });
  absorbCookies(state, res);
}

async function fetchOnce(state: HostState, url: string, timeoutMs: number): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": userAgent(url),
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(state.cookie ? { Cookie: state.cookie } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    absorbCookies(state, res);
    const text = await res.text();
    if (text.includes("Checking your browser") && text.includes("nonce=")) {
      await solveChallenge(state, new URL(res.url || url).origin, text);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${res.url || url}`);
    return text;
  }
  throw new Error(`challenge not passed for ${url}`);
}

/** Throttled, retrying, challenge-aware page fetch. All scraping goes through here. */
export function fetchHtml(url: string, { timeoutMs = 25000, retries = 2 } = {}): Promise<string> {
  const host = new URL(url).host;
  const state = hostState(host);
  const gap = HOST_GAP_MS[host] ?? DEFAULT_GAP_MS;

  const result = state.chain.then(async () => {
    const wait = state.lastAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      state.lastAt = Date.now();
      try {
        return await fetchOnce(state, url, timeoutMs);
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          log(`retrying (${attempt + 1}/${retries})`, url, String(err));
          await sleep(1500 * (attempt + 1));
        }
      }
    }
    throw lastError;
  });

  state.chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

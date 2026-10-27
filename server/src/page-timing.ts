import { deviceOf } from "./visitors.ts";

/**
 * Real readers' load times, from the browser's own timings of the page it
 * opened (client `watchPageTiming`): time to the first byte of the page, its
 * first paint and its largest paint (LCP), on phones and on desktops, and LCP
 * by the network the browser reports. Kept as `rum_*` rows in the hourly
 * traffic history, outside its request totals; Admin → Traffic shows them.
 */
const METRICS = ["ttfb", "fcp", "lcp"] as const;
const NETWORKS = new Set(["4g", "3g", "2g", "slow-2g"]);
/** Longer than this is a tab left loading, not a page load. */
const MAX_MS = 60_000;

export const isTimingRoute = (route: string) => route.startsWith("rum_");

/** The rows one beacon adds: "ttfb fcp lcp network", whole milliseconds or
 *  "-" where the browser had none. Null when the line is not one. */
export function timingRows(body: string, userAgent: string): { route: string; ms: number }[] | null {
  const parts = body.trim().split(" ");
  if (parts.length !== 4) return null;
  const network = parts[3];
  if (network !== "-" && !NETWORKS.has(network)) return null;
  const device = deviceOf(userAgent) === "desktop" ? "desktop" : "phone";
  const rows: { route: string; ms: number }[] = [];
  for (const [index, metric] of METRICS.entries()) {
    const raw = parts[index];
    if (raw === "-") continue;
    if (!/^\d{1,5}$/.test(raw) || Number(raw) > MAX_MS) return null;
    rows.push({ route: `rum_${metric}_${device}`, ms: Number(raw) });
    if (metric === "lcp" && network !== "-") rows.push({ route: `rum_lcp_net_${network}`, ms: Number(raw) });
  }
  return rows;
}

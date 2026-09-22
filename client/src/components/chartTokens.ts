/**
 * Chart tokens and value formatting, kept apart from the components so both
 * can be imported without pulling in React, and so the colour roles have one
 * home. The hex values themselves live in index.css as CSS custom properties.
 */

export const SERIES = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)", "var(--color-series-4)"] as const;

export type Format = "number" | "percent" | "decimal" | "signed" | "time" | "signedTime" | "currency" | "odds" | "years" | "age";

export function formatDuration(value: number): string {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${seconds}s`]
    .filter(Boolean)
    .join(" ");
}

export function formatValue(value: number | null | undefined, format: Format = "number"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "percent": return `${Math.round(value * 10) / 10}%`;
    case "decimal": return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$/, "");
    case "signed": return `${value > 0 ? "+" : ""}${Math.round(value * 10) / 10}`;
    case "years": return `${Math.round(value * 10) / 10} years`;
    case "age": return `${Math.round(value * 10) / 10} y/o`;
    case "time": return formatDuration(value);
    case "signedTime": {
      return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatDuration(Math.abs(value))}`;
    }
    case "currency": return `${value >= 0 ? "+" : "−"}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    case "odds": return `${value > 0 ? "+" : ""}${Math.round(value)}`;
    default: return Math.round(value * 10) / 10 === Math.round(value) ? value.toLocaleString("en-US") : (Math.round(value * 10) / 10).toLocaleString("en-US");
  }
}

/** Compact form for an axis tick or a tight cell: 12.4K, 1.2M. */
export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return value.toLocaleString("en-US");
}

export const PANEL = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

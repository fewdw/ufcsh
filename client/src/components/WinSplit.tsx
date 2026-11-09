import { winShares } from "../winChance";

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The fight's odds as one bar split blue against red: how much of the win
 *  the market gives each corner. `sm` is the card row's hairline; `lg` adds
 *  each corner's percentage at its end. Nothing without both prices. */
export default function WinSplit({ f1, f2, size = "sm", className = "" }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  size?: "sm" | "lg" | "tape" | "labels";
  className?: string;
}) {
  const shares = winShares(f1, f2);
  if (!shares) return null;
  const label = `Implied win chance from the odds, margin removed: ${pct(shares.f1)} to ${pct(shares.f2)}`;
  const bar = (
    <span className={`flex w-full gap-[2px] ${size === "lg" ? "h-2" : "h-1"}`} role="img" aria-label={label}>
      <span className="win-split-f1 rounded-l-full" style={{ width: `${shares.f1 * 100}%` }} />
      <span className="win-split-f2 rounded-r-full" style={{ width: `${shares.f2 * 100}%` }} />
    </span>
  );
  // The bout's bottom edge: the split runs the full width of the row.
  if (size === "tape") return (
    <span className={`flex h-[3px] ${className}`} role="img" aria-label={label} title={label}>
      <span className="win-split-f1" style={{ width: `${shares.f1 * 100}%` }} />
      <span className="win-split-f2" style={{ width: `${shares.f2 * 100}%` }} />
    </span>
  );
  // Just the two percentages, under the prices they come from.
  if (size === "labels") return (
    <span className={`grid grid-cols-2 text-center text-[11px] font-medium tabular-nums ${className}`} title={label}>
      <span className={shares.f1 >= shares.f2 ? "text-f1-ink" : "text-zinc-400"}>{pct(shares.f1)}</span>
      <span className={shares.f2 >= shares.f1 ? "text-f2-ink" : "text-zinc-400"}>{pct(shares.f2)}</span>
    </span>
  );
  if (size === "sm") return <span className={`block w-full ${className}`} title={label}>{bar}</span>;
  return (
    <span className={`block w-full ${className}`} title={label}>
      <span className="mb-2 flex items-baseline justify-between font-display text-[38px] font-bold leading-none tabular-nums">
        <span className={shares.f1 >= shares.f2 ? "text-zinc-900" : "text-zinc-400"}>{pct(shares.f1)}</span>
        <span className="font-sans text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">Win chance<span className="block normal-case tracking-normal">from the odds</span></span>
        <span className={shares.f2 >= shares.f1 ? "text-zinc-900" : "text-zinc-400"}>{pct(shares.f2)}</span>
      </span>
      {bar}
    </span>
  );
}

import { winShares } from "../winChance";

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The fight's odds as one bar split blue against red: how much of the win
 *  the market gives each corner. `sm` is the card row's hairline; `lg` adds
 *  each corner's percentage at its end. Nothing without both prices. */
export default function WinSplit({ f1, f2, size = "sm", className = "" }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  size?: "sm" | "lg";
  className?: string;
}) {
  const shares = winShares(f1, f2);
  if (!shares) return null;
  const label = `Implied win chance from the odds, margin removed: ${pct(shares.f1)} to ${pct(shares.f2)}`;
  const bar = (
    <span className={`flex w-full gap-[2px] ${size === "lg" ? "h-2" : "h-1"}`} role="img" aria-label={label}>
      <span className="win-split-f1 rounded-l-full" style={{ width: `${shares.f1 * 100}%`, opacity: shares.f1 >= shares.f2 ? 1 : 0.45 }} />
      <span className="win-split-f2 rounded-r-full" style={{ width: `${shares.f2 * 100}%`, opacity: shares.f2 >= shares.f1 ? 1 : 0.45 }} />
    </span>
  );
  if (size === "sm") return <span className={`block w-full ${className}`} title={label}>{bar}</span>;
  return (
    <span className={`block w-full ${className}`} title={label}>
      <span className="mb-1.5 flex items-baseline justify-between font-display text-[22px] font-semibold leading-none tabular-nums">
        <span className={shares.f1 >= shares.f2 ? "text-zinc-900" : "text-zinc-400"}>{pct(shares.f1)}</span>
        <span className="font-sans text-[10px] font-medium text-zinc-400">win chance</span>
        <span className={shares.f2 >= shares.f1 ? "text-zinc-900" : "text-zinc-400"}>{pct(shares.f2)}</span>
      </span>
      {bar}
    </span>
  );
}

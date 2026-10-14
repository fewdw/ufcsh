export type Slice = { key: string; label: string; value: number; color: string };

/** A share of a whole as a small filled pie: wedges meet at the centre with no gap
 *  between them, the first starting at 12 o'clock and running clockwise. */
export function Pie({ slices, total, size = 44 }: { slices: Slice[]; total?: number; size?: number }) {
  const sum = total ?? slices.reduce((value, slice) => value + slice.value, 0);
  const r = size / 2;
  const point = (share: number) => {
    const angle = share * 2 * Math.PI - Math.PI / 2;
    return `${(r + r * Math.cos(angle)).toFixed(2)} ${(r + r * Math.sin(angle)).toFixed(2)}`;
  };
  let from = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" className="shrink-0"
      aria-label={sum ? slices.map(slice => `${slice.label} ${Math.round((slice.value / sum) * 100)}%`).join(", ") : "No picks yet"}>
      {sum ? slices.map(slice => {
        if (slice.value <= 0) return null;
        const share = slice.value / sum;
        const start = from;
        from += share;
        const title = <title>{`${slice.label}: ${slice.value} (${Math.round(share * 100)}%)`}</title>;
        // An arc cannot close on itself, so a whole pie is a circle.
        return share >= 1
          ? <circle key={slice.key} cx={r} cy={r} r={r} fill={slice.color}>{title}</circle>
          : <path key={slice.key} fill={slice.color}
            d={`M${r} ${r} L${point(start)} A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${point(from)} Z`}>{title}</path>;
      }) : <circle cx={r} cy={r} r={r} fill="var(--color-plot-track)" />}
    </svg>
  );
}

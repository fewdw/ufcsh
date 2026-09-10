export type OddsMovement = { toward: "f1" | "f2"; points: number };

function implied(line: string | null | undefined): number | null {
  if (!line) return null;
  const normalized = line.trim().replace(/[−–]/g, "-");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || Math.abs(value) < 100) return null;
  return value > 0 ? 100 / (value + 100) : -value / (-value + 100);
}

/** Compare implied probability, including lines crossing from + to −. */
export function oddsMovement(f1Open: string | null | undefined, f1: string | null | undefined, f2Open: string | null | undefined, f2: string | null | undefined): OddsMovement | null {
  const shift = (open: string | null | undefined, close: string | null | undefined) => {
    const from = implied(open);
    const to = implied(close);
    return from == null || to == null ? null : to - from;
  };
  const left = shift(f1Open, f1);
  const right = shift(f2Open, f2);
  if (left == null && right == null) return null;
  const side = Math.abs(left ?? 0) >= Math.abs(right ?? 0) ? "f1" : "f2";
  const value = (side === "f1" ? left : right) ?? 0;
  const points = Math.round(Math.abs(value) * 1000) / 10;
  if (!points) return null;
  return { toward: value > 0 ? side : side === "f1" ? "f2" : "f1", points };
}

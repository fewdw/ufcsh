function OddsValue({ line }: { line: string | null | undefined }) {
  return (
    <span
      className={`flex h-7 w-14 items-center justify-center rounded-lg bg-zinc-100 font-mono text-xs font-semibold leading-none tabular-nums ${line ? "text-zinc-800" : "text-zinc-300"}`}
    >
      {line ?? "—"}
    </span>
  );
}

export default function OddsPair({ f1, f2 }: { f1: string | null | undefined; f2: string | null | undefined }) {
  if (!f1 && !f2) return null;

  return (
    <div className="flex items-center justify-center gap-3" aria-label={`${f1 ?? "No odds"} versus ${f2 ?? "No odds"}`}>
      <OddsValue line={f1} />
      <span className="w-5 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-300">vs</span>
      <OddsValue line={f2} />
    </div>
  );
}

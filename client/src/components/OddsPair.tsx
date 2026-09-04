function OddsValue({ line, open }: { line: string | null | undefined; open?: string | null }) {
  const moved = open && line && open !== line;
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span
        className={`flex h-7 w-14 items-center justify-center rounded-lg bg-zinc-100 font-mono text-xs font-semibold leading-none tabular-nums ${line ? "text-zinc-800" : "text-zinc-300"}`}
      >
        {line ?? "—"}
      </span>
      {moved ? (
        <span className="font-mono text-[9px] leading-none tabular-nums text-zinc-400" title={`Opened at ${open}, closed at ${line}`}>
          from {open}
        </span>
      ) : null}
    </span>
  );
}

export default function OddsPair({
  f1,
  f2,
  f1Open,
  f2Open,
}: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  /** Opening lines, shown beneath the close when the price actually moved. */
  f1Open?: string | null;
  f2Open?: string | null;
}) {
  if (!f1 && !f2) return null;

  return (
    <div className="flex items-start justify-center gap-3" aria-label={`${f1 ?? "No odds"} versus ${f2 ?? "No odds"}`}>
      <OddsValue line={f1} open={f1Open} />
      <span className="mt-2 w-5 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-300">vs</span>
      <OddsValue line={f2} open={f2Open} />
    </div>
  );
}

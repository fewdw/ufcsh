export default function OddsPair({ f1, f2, f1Name = "left fighter", f2Name = "right fighter" }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  f1Name?: string;
  f2Name?: string;
}) {
  if (!f1 && !f2) return null;
  return (
    <div className="odds-pair grid w-full grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center rounded-lg border px-1 py-2.5 text-center" aria-label="Betting odds">
      <span className="text-sm font-semibold leading-5 tracking-tight tabular-nums" aria-label={`${f1Name}: ${f1 ?? "No odds"}`}>{f1 ?? "—"}</span>
      <span className="odds-pair-divider h-4" aria-hidden="true" />
      <span className="text-sm font-semibold leading-5 tracking-tight tabular-nums" aria-label={`${f2Name}: ${f2 ?? "No odds"}`}>{f2 ?? "—"}</span>
    </div>
  );
}

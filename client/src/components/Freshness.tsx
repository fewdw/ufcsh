import { exactTime, relativeAge } from "../format";

/**
 * When the data on the page last reached this machine. A working page should
 * never let stale information look current, so an age past the expected sync
 * cadence is marked instead of being quietly rounded away. The age describes
 * this copy, not the source: a successful sync of unchanged data is fresh.
 */
export default function Freshness({
  label,
  at,
  staleAfterHours,
  missing = "not synced yet",
}: {
  label: string;
  at: number | null | undefined;
  /** Beyond this age the indicator turns into a warning. */
  staleAfterHours: number;
  /** Shown when nothing has ever been synced; null hides the indicator. */
  missing?: string | null;
}) {
  const age = relativeAge(at);
  if (!age) {
    return missing == null ? null : (
      <span className="text-[11px] font-medium text-amber-700" role="status">{label} {missing}</span>
    );
  }
  const stale = Date.now() - at! > staleAfterHours * 3_600_000;
  return (
    <span
      className={`text-[11px] tabular-nums ${stale ? "font-medium text-amber-700" : "text-zinc-400"}`}
      title={`${label} ${exactTime(at)}${stale ? `\nThat is more than ${staleAfterHours} hours ago; the background sync may be failing.` : ""}`}
      role={stale ? "status" : undefined}
    >
      {label} {age}{stale ? " — may be stale" : ""}
    </span>
  );
}

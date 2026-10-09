import { lazy, Suspense, useRef, useState } from "react";
import { CalendarDays, RotateCcw } from "lucide-react";

const RankingsDatePicker = lazy(() => import("./RankingsDatePicker"));
const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted transition hover:border-line-strong hover:bg-surface-muted";

export default function RankingsDateControl({ selectedDate, today, onView, variant = "toolbar" }: {
  selectedDate: string | null; today: string; onView: (date: string | null) => void;
  variant?: "toolbar" | "field";
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const field = variant === "field";
  return <div className={field ? "flex min-w-0 flex-col gap-1" : "flex shrink-0 items-center gap-1.5"}>
    {field ? <span className="text-[11px] font-medium text-muted">Specific date</span> : null}
    <button ref={buttonRef} type="button" aria-label={field ? "See rankings for a specific date" : "Choose ranking date"} aria-haspopup="dialog" aria-expanded={open}
      title={selectedDate ? `Rankings as of ${selectedDate}` : "See rankings for a specific date"}
      onClick={() => setOpen(value => !value)}
      className={`${field ? "flex h-8 w-full items-center justify-center rounded-lg border border-line bg-surface-muted text-secondary transition hover:border-line-strong " : iconButton} ${selectedDate ? "border-info-line text-info" : ""}`}>
      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
    {selectedDate !== null ? <button type="button" aria-label="Reset date" title="Return to current rankings"
      onClick={() => { setOpen(false); onView(null); }}
      className={field ? "h-6 self-center rounded px-1 text-[10px] font-medium text-muted transition hover:bg-surface-strong hover:text-foreground" : iconButton}>
      {field ? "Reset date" : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
    </button> : null}
    {open ? <Suspense fallback={<span role="status" className="sr-only">Loading date picker…</span>}>
      <RankingsDatePicker key={selectedDate ?? "today"} selectedDate={selectedDate} today={today} onView={onView}
        triggerRef={buttonRef} onClose={() => setOpen(false)} />
    </Suspense> : null}
  </div>;
}

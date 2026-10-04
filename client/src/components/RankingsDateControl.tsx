import { lazy, Suspense, useRef, useState } from "react";
import { CalendarDays, RotateCcw } from "lucide-react";

const RankingsDatePicker = lazy(() => import("./RankingsDatePicker"));
const iconButton = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50";

export default function RankingsDateControl({ selectedDate, today, onView }: {
  selectedDate: string | null; today: string; onView: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return <div className="flex shrink-0 items-center gap-1.5">
    <button ref={buttonRef} type="button" aria-label="Choose ranking date" aria-haspopup="dialog" aria-expanded={open}
      title={selectedDate ? `Rankings as of ${selectedDate}` : "View rankings by date"}
      onClick={() => setOpen(value => !value)}
      className={`${iconButton} ${selectedDate ? "border-sky-300 text-sky-600" : ""}`}>
      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
    {selectedDate !== null ? <button type="button" aria-label="Reset ranking date" title="Return to current rankings"
      onClick={() => { setOpen(false); onView(null); }} className={iconButton}>
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
    </button> : null}
    {open ? <Suspense fallback={<span role="status" className="sr-only">Loading date picker…</span>}>
      <RankingsDatePicker key={selectedDate ?? "today"} selectedDate={selectedDate} today={today} onView={onView}
        triggerRef={buttonRef} onClose={() => setOpen(false)} />
    </Suspense> : null}
  </div>;
}

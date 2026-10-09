import type { Finish } from "../scoring";

/** The finishing round reports the method on the winner's side, never a score. */
export default function FightFinishRow({ finish }: { finish: Finish }) {
  return (
    <div role="group" aria-label={`Round ${finish.round}: ${finish.name} won by ${finish.method}${finish.time ? ` at ${finish.time}` : ""}`}
      className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-5 py-2.5 text-sm tabular-nums">
      <span className={`text-left ${finish.side === 1 ? "font-medium text-f1-ink" : "text-muted"}`}>
        {finish.side === 1 ? finish.method : "—"}
      </span>
      <span className="text-center">
        <span className="block text-[10px] font-medium text-muted">R{finish.round}</span>
        {finish.time ? <span className="block text-[10px] text-muted">{finish.time}</span> : null}
      </span>
      <span className={`text-right ${finish.side === 2 ? "font-medium text-f2-ink" : "text-muted"}`}>
        {finish.side === 2 ? finish.method : "—"}
      </span>
    </div>
  );
}

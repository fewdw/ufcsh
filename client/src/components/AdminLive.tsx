import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminResource, type AdminLiveCard } from "../admin";
import LiveRoundSwitches from "./LiveRoundSwitches";

/**
 * The one bout being fought and its round switches. It follows the card on
 * its own: the opening bout first, then whichever comes after the last
 * result. Stepping to another bout is for a feed that is late with a result;
 * the next result hands control back to the card.
 */
export default function AdminLive() {
  // Two people can be running the card; five seconds keeps them in step.
  const { data, error, loading, reload, setData } = useAdminResource<AdminLiveCard>("/api/admin/live", 5_000);
  const [picked, setPicked] = useState<string | null>(null);
  const currentId = data?.current?.id ?? null;
  useEffect(() => { setPicked(null); }, [currentId]);

  if (loading && !data) return <div role="status" className="flex items-center justify-center py-16 text-sm text-zinc-400">Loading today’s card…</div>;
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <p>Couldn’t load the card. {error}</p>
        <button type="button" onClick={() => void reload()} className="font-semibold text-zinc-900 underline">Retry</button>
      </div>
    );
  }
  const fights = data?.fights ?? [];
  const index = fights.findIndex(fight => fight.id === (picked ?? currentId));
  const fight = fights[index];
  if (!fight) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500">
        {fights.length ? "Every bout on today’s card has a result." : "No card is being fought today."}
      </p>
    );
  }

  const onNow = fight.id === currentId;
  const status = fight.complete ? "Finished"
    : fight.state === "live" ? "Scoring open"
    : onNow && data?.current?.live ? "Live · no round open"
    : onNow ? "Up next" : "Not open";
  const step = (by: number) => {
    const next = fights[index + by];
    if (next) setPicked(next.id === currentId ? null : next.id);
  };
  const stepButton = "rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50 disabled:invisible";

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <button type="button" onClick={() => step(-1)} disabled={index <= 0} className={stepButton} aria-label="Previous bout">‹ Prev</button>
        <span className="min-w-0 truncate text-center">
          Bout {index + 1} of {fights.length} · {fight.event.name}
        </span>
        <button type="button" onClick={() => step(1)} disabled={index >= fights.length - 1} className={stepButton} aria-label="Next bout">Next ›</button>
      </div>

      <div className="mt-4 flex flex-col items-center gap-1.5 text-center">
        <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${fight.state === "live" || (onNow && data?.current?.live) ? "text-emerald-700" : "text-zinc-400"}`}>
          {fight.state === "live" || (onNow && data?.current?.live) ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
          {status}
        </span>
        <Link to={`/fights/${fight.id}?tab=score`} className="text-lg font-semibold tracking-tight text-zinc-900 hover:underline sm:text-xl">
          {fight.f1_name} vs {fight.f2_name}
        </Link>
        {fight.weight_class ? <p className="text-xs text-zinc-500">{fight.weight_class}</p> : null}
        {!onNow && currentId ? (
          <button type="button" onClick={() => setPicked(null)} className="text-xs font-medium text-sky-600 hover:underline">
            Back to the bout on now
          </button>
        ) : null}
      </div>

      <LiveRoundSwitches key={fight.id} fight={fight} live={onNow ? Boolean(data?.current?.live) : null} onChanged={setData} onFailed={() => void reload(true)} />
    </section>
  );
}

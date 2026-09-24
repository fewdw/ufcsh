import { useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRequest, useAdminResource, type AdminLiveFight } from "../admin";

const stateLabel: Record<AdminLiveFight["state"], string> = {
  completed: "Finished",
  live: "Scoring open",
  waiting: "Not open",
};
const stateTone: Record<AdminLiveFight["state"], string> = {
  completed: "bg-zinc-100 text-zinc-500",
  live: "bg-emerald-50 text-emerald-700",
  waiting: "bg-amber-50 text-amber-700",
};

/** Opens rounds by hand ahead of the live feed. It can only open more of a
 * bout than the feed has, never take a published round back. */
export default function AdminLive() {
  const request = useAdminRequest();
  // Two people can be running the card; five seconds keeps them in step.
  const { data, error, loading, reload, setData } = useAdminResource<{ fights: AdminLiveFight[] }>("/api/admin/live", 5_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const setRounds = async (fight: AdminLiveFight, rounds: number) => {
    setBusy(fight.id);
    setFailed(null);
    try {
      const body = await request<{ fight: AdminLiveFight }>(`/api/admin/live/${fight.id}`, { method: "PUT", body: { rounds } });
      setData(current => ({ fights: (current?.fights ?? []).map(item => item.id === body.fight.id ? body.fight : item) }));
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
      void reload(true);
    } finally {
      setBusy(null);
    }
  };

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Live rounds</h2>
        <p className="text-xs text-zinc-500">
          Scoring opens on whichever comes first: the live feed publishing a round, or you releasing it here.
          Rounds the feed has already published stay open.
        </p>
      </div>
      {failed ? <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{failed}</p> : null}
      {!fights.length ? (
        <p className="rounded-xl border border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          No card is being fought today. Bouts appear here on fight day.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {fights.map(fight => {
            const rows = fight.scheduled || 0;
            return (
              <li key={fight.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/fights/${fight.id}?tab=score`} className="text-sm font-semibold text-zinc-900 hover:underline">
                      {fight.f1_name} vs {fight.f2_name}
                    </Link>
                    <p className="truncate text-xs text-zinc-500">
                      {fight.event.name}{fight.weight_class ? ` · ${fight.weight_class}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${stateTone[fight.state]}`}>
                    {stateLabel[fight.state]}
                  </span>
                </div>
                {fight.complete || !rows ? (
                  <p className="mt-3 text-xs text-zinc-500">
                    {fight.complete
                      ? "This bout is over; its rounds follow the result."
                      : "Round scoring needs a confirmed three- or five-round bout."}
                  </p>
                ) : (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {Array.from({ length: rows }, (_unused, index) => {
                        const round = index + 1;
                        const open = round <= fight.available;
                        // The feed's own rounds are not this panel's to close.
                        const locked = round <= fight.feedRounds;
                        const next = round === fight.openRounds && !locked ? round - 1 : round;
                        return (
                          <button
                            key={round}
                            type="button"
                            disabled={busy === fight.id || locked}
                            onClick={() => void setRounds(fight, next)}
                            title={locked ? "Opened by the live feed" : open ? `Close round ${round}` : `Open round ${round}`}
                            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                              open
                                ? locked
                                  ? "bg-zinc-900 text-white"
                                  : "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                            }`}
                          >
                            R{round}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-400">
                      {fight.available} of {rows} open · feed {fight.feedRounds} · released here {fight.openRounds}
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

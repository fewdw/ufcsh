import { useState } from "react";
import { apiCache } from "../api";
import { useAdminRequest, type AdminLiveCard, type AdminLiveFight } from "../admin";

/**
 * One bout's live switch and round switches, shared by Admin → Live rounds and
 * the Score tab. The server checks the administrator on every change; this
 * only draws them. Closing a round hides its scores and reopening it brings
 * them back, so a round opened by mistake costs nobody their card; a bout
 * marked live by mistake goes back to Next the same way.
 */
export default function LiveRoundSwitches({ fight, onNow, onChanged, onFailed }: {
  fight: AdminLiveFight;
  /** The bout the header's pill names: the only one the live switch moves. */
  onNow: boolean;
  onChanged: (card: AdminLiveCard) => void;
  onFailed: () => void;
}) {
  const request = useAdminRequest();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const rows = fight.scheduled || 0;

  const change = async (body: { rounds: number } | { live: boolean }) => {
    setBusy(true);
    setFailed(null);
    try {
      onChanged(await request<AdminLiveCard>(`/api/admin/live/${fight.id}`, { method: "PUT", body }));
      // The header's pill follows at once rather than at its next poll.
      void apiCache.loadAfterWrite("/api/live");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
      onFailed();
    } finally {
      setBusy(false);
    }
  };

  if (fight.complete) return <p className="mt-6 text-center text-sm text-zinc-500">This bout is over; its rounds follow the result.</p>;
  // Live on any evidence, as the server has it; only the hand-set mark is this switch's to take back.
  const evidence = fight.underway ? "feed" : fight.openRounds > 0 ? "round open" : null;
  const live = evidence != null || fight.marked;
  const liveSwitch = onNow ? (
    <button
      type="button"
      disabled={busy || evidence != null}
      onClick={() => void change({ live: !fight.marked })}
      title={evidence ? `Live: ${evidence === "feed" ? "the feed has started publishing it" : "a round is open"}` : live ? "Marked live by mistake? Back to Next" : "Mark live when the bout starts"}
      className={`mx-auto mt-6 flex min-h-12 w-full max-w-md items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:cursor-default ${
        live ? "bg-emerald-600 text-white hover:bg-emerald-700 disabled:hover:bg-emerald-600" : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
      } ${busy ? "opacity-60" : ""}`}
    >
      {live ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" /> : null}
      {live ? "Live" : "Mark live"}
      <span className={`text-[10px] font-medium ${live ? "text-white/70" : "text-zinc-400"}`}>{evidence ?? (live ? "on" : "next")}</span>
    </button>
  ) : null;
  if (!rows) {
    return (
      <>
        {failed ? <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{failed}</p> : null}
        {liveSwitch}
        <p className="mt-6 text-center text-sm text-zinc-500">Round scoring needs a confirmed three- or five-round bout.</p>
      </>
    );
  }
  return (
    <>
      {failed ? <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{failed}</p> : null}
      {liveSwitch}
      <div className={`mx-auto ${onNow ? "mt-2" : "mt-6"} grid max-w-md gap-2 ${rows === 5 ? "grid-cols-5" : "grid-cols-3"}`}>
        {Array.from({ length: rows }, (_unused, i) => {
          const round = i + 1;
          const open = round <= fight.available;
          // The feed's own rounds are not this panel's to close.
          const locked = round <= fight.feedRounds;
          const next = open ? round - 1 : round;
          const scored = fight.scored[round] ?? 0;
          return (
            <button
              key={round}
              type="button"
              disabled={busy || locked}
              onClick={() => void change({ rounds: next })}
              title={locked ? "Opened by the live feed" : open ? `Close ${fight.available > round ? `rounds ${round}–${fight.available}` : `round ${round}`}` : `Open ${round > 1 ? `rounds 1–${round}` : "round 1"}`}
              className={`flex min-h-16 flex-col items-center justify-center rounded-xl text-sm font-semibold transition disabled:cursor-default ${
                open
                  ? locked
                    ? "bg-zinc-900 text-white"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
              } ${busy ? "opacity-60" : ""}`}
            >
              R{round}
              <span className={`text-[10px] font-medium ${open ? "text-white/70" : "text-zinc-400"}`}>
                {locked ? "feed" : open ? "open" : "closed"}{scored ? ` · ${scored}` : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mx-auto mt-4 max-w-md text-center text-[11px] leading-relaxed text-zinc-400">
        {onNow ? "Mark the bout live when it starts; until then the site calls it Next. " : ""}Open a round at its horn.
        Rounds the live feed publishes open by themselves and stay open.
        Closing a round opened by mistake hides its scores; reopening it brings them back.
        When the result lands, rounds the bout never reached — and a stoppage round — are deleted.
      </p>
    </>
  );
}

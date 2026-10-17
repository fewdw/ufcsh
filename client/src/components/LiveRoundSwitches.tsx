import { useState } from "react";
import { useAdminRequest, type AdminLiveCard, type AdminLiveFight } from "../admin";

/**
 * One bout's round switches, shared by Admin → Live rounds and the Score tab.
 * The server checks the administrator on every change; this only draws them.
 * Closing a round hides its scores and reopening it brings them back, so a
 * round opened by mistake costs nobody their card.
 */
export default function LiveRoundSwitches({ fight, onChanged, onFailed }: {
  fight: AdminLiveFight;
  onChanged: (card: AdminLiveCard) => void;
  onFailed: () => void;
}) {
  const request = useAdminRequest();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const rows = fight.scheduled || 0;

  const setRounds = async (rounds: number) => {
    setBusy(true);
    setFailed(null);
    try {
      onChanged(await request<AdminLiveCard>(`/api/admin/live/${fight.id}`, { method: "PUT", body: { rounds } }));
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
      onFailed();
    } finally {
      setBusy(false);
    }
  };

  if (fight.complete || !rows) {
    return (
      <p className="mt-6 text-center text-sm text-zinc-500">
        {fight.complete ? "This bout is over; its rounds follow the result." : "Round scoring needs a confirmed three- or five-round bout."}
      </p>
    );
  }
  return (
    <>
      {failed ? <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-center text-xs text-rose-700">{failed}</p> : null}
      <div className={`mx-auto mt-6 grid max-w-md gap-2 ${rows === 5 ? "grid-cols-5" : "grid-cols-3"}`}>
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
              onClick={() => void setRounds(next)}
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
        Open a round at its horn. Rounds the live feed publishes open by themselves and stay open.
        Closing a round opened by mistake hides its scores; reopening it brings them back.
        When the result lands, rounds the bout never reached — and a stoppage round — are deleted.
      </p>
    </>
  );
}

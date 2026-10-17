import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { apiCache } from "../api";
import { useAdminResource, type AdminLiveCard } from "../admin";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import LiveRoundSwitches from "./LiveRoundSwitches";

/**
 * Admin → Live rounds for this one bout, on its Score tab. Drawn only for a
 * remembered administrator and a bout on today's card; the server refuses
 * anyone else, whatever this draws.
 */
export default function ScoreRoundControls({ fightId }: { fightId: string }) {
  // Asked once; kept current like the panel only while the bout is on today's card.
  const [onCard, setOnCard] = useState(true);
  const { data, reload, setData } = useAdminResource<AdminLiveCard>("/api/admin/live", onCard ? 5_000 : 0);
  const fight = data?.fights.find(candidate => candidate.id === fightId);
  const absent = Boolean(data && !fight);
  useEffect(() => { if (absent) setOnCard(false); }, [absent]);
  if (!fight || fight.complete) return null;
  const refresh = () => { void apiCache.loadAfterWrite(`/api/fights/${fightId}/scores`); };
  return (
    <section className={`@container ${PANEL_SHELL}`}>
      <PanelHeading
        title="Rounds"
        aside={<span className="flex items-center gap-1 text-xs text-zinc-500"><Shield className="h-3.5 w-3.5" aria-hidden="true" />Admin</span>}
      />
      <div className="px-4 pb-5 @[32rem]:px-5">
        <LiveRoundSwitches
          fight={fight}
          onChanged={card => { setData(card); refresh(); }}
          onFailed={() => { void reload(true); refresh(); }}
        />
      </div>
    </section>
  );
}

import { Link } from "react-router-dom";
import { useApi } from "../api";
import type { LiveCard } from "../api";
import { clockTime, countdown, lastName } from "../format";
import { useNow } from "../useNow";

/** Up next shows only inside this window; further out, a countdown is noise. */
const NEXT_WINDOW_MS = 12 * 3_600_000;

/** The bout on now while a card runs, nothing otherwise. The countdown is
 * computed locally from the server's absolute start time. */
export default function LiveMatchup() {
  const { data } = useApi<LiveCard>("/api/live", card => card ? 15_000 : 60_000);
  const startsAt = data?.starts_at ?? null;
  const now = useNow(Boolean(data && !data.live && startsAt != null));

  if (!data) return null;
  if (!data.live && startsAt != null && startsAt - now > NEXT_WINDOW_MS) return null;
  const { fight } = data;
  const names = `${lastName(fight.f1.name)} vs ${lastName(fight.f2.name)}`;
  const away = countdown(startsAt, now);
  const at = clockTime(startsAt);
  // Live only once the server has confirmed it. An estimated start passing
  // says nothing about whether the bout has begun, so it stays next: "due".
  const { live } = data;
  const due = !live && startsAt != null && !away;

  return (
    <Link
      to={`/fights/${fight.id}`}
      state={{ eventId: data.event.id }}
      title={`${fight.f1.name} vs ${fight.f2.name} · ${data.event.name}${live ? " · on now" : at ? ` · expected around ${at}` : ""}`}
      className="flex max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-2.5 pr-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
    >
      {live ? (
        <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
      ) : null}
      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700`}>
        {live ? "Live" : "Next"}
      </span>
      <span className="truncate text-xs font-semibold text-zinc-900">{names}</span>
      {live && data.fight_number ? (
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500">
          {data.fight_number}/{data.total_fights}
        </span>
      ) : null}
      {!live && away ? (
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500" aria-label={`starts in ${away}`}>
          {away}
        </span>
      ) : null}
      {due ? <span className="shrink-0 text-[11px] font-medium text-zinc-500">due</span> : null}
    </Link>
  );
}

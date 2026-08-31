import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api";
import type { FighterProfile, HistoryRow } from "../api";
import { formatDateShort, formatMethod, outcomeClasses, outcomeLabel } from "../format";
import Avatar from "../components/Avatar";
import { useSeo } from "../seo";

const shell = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

function HistoryRowView({ row }: { row: HistoryRow }) {
  return (
    <div className="group grid grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 transition-colors hover:bg-zinc-50">
      <Link
        to={`/fights/${row.fight_id}`}
        aria-label={`Open ${row.opponent.name} matchup`}
        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
          row.upcoming ? "bg-sky-100 text-sky-700" : outcomeClasses(row.outcome)
        }`}
      >
        {row.upcoming ? "→" : outcomeLabel(row.outcome) || "•"}
      </Link>
      <span className="min-w-0">
        <Link
          to={`/fighters/${row.opponent.id}`}
          className="block truncate rounded-sm text-sm font-medium text-zinc-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          {row.opponent.name}
        </Link>
        <span className="block truncate text-[11px] text-zinc-400">
          {row.weight_class}
          {row.title_narrative ? ` · ${row.title_narrative}` : ""}
        </span>
      </span>
      <span className="min-w-0">
        <Link
          to={`/fights/${row.fight_id}`}
          className="block truncate rounded-sm text-xs text-zinc-500 hover:text-zinc-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          {row.upcoming ? "Scheduled" : formatMethod(row.method, row.round, row.time) || "—"}
        </Link>
        <Link
          to={`/events/${row.event_id}`}
          className="block truncate rounded-sm text-[11px] text-zinc-400 hover:text-zinc-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          {row.event_name}
        </Link>
      </span>
      <Link
        to={`/events/${row.event_id}`}
        aria-label={`Open ${row.event_name}`}
        className="rounded-sm text-xs tabular-nums text-zinc-400 hover:text-zinc-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        {formatDateShort(row.date)}
      </Link>
    </div>
  );
}

export default function FighterPage() {
  const { fighterId } = useParams();
  const navigate = useNavigate();
  const { data: fighter, loading, error } = useApi<FighterProfile>(fighterId ? `/api/fighters/${fighterId}` : null);
  useSeo({
    title: fighter ? `${fighter.name} — Record & Fight History` : "UFC Fighter Profile",
    description: fighter
      ? `${fighter.name} UFC profile: ${fighter.record} record, physical statistics, ranking and complete fight history.`
      : "UFC fighter record, profile, statistics, ranking and fight history.",
    path: fighterId ? `/fighters/${fighterId}` : undefined,
    type: "profile",
    structuredData: fighter
      ? {
          "@context": "https://schema.org",
          "@type": "Person",
          name: fighter.name,
          alternateName: fighter.nickname || undefined,
          url: `https://ufc.sh/fighters/${fighter.id}`,
          ...(fighter.photo_url ? { image: fighter.photo_url } : {}),
        }
      : undefined,
  });

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Loading fighter…</div>;
  }
  if (error || !fighter) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Fighter not found.</div>;
  }

  const upcoming = fighter.history.filter((h) => h.upcoming);
  const past = fighter.history.filter((h) => !h.upcoming);

  const bio: [string, string][] = (
    [
      ["Height", fighter.height],
      ["Weight", fighter.weight],
      ["Reach", fighter.reach],
      ["Stance", fighter.stance],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3 pb-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="self-start rounded-full px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700"
        >
          ← Back
        </button>

        <section className={`${shell} px-6 py-5`}>
          <div className="flex items-center gap-5">
            <Avatar src={fighter.photo_url} name={fighter.name} size="xl" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-950">{fighter.name}</h1>
              {fighter.nickname ? <div className="text-sm text-zinc-400">“{fighter.nickname}”</div> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold tabular-nums text-zinc-900">{fighter.record}</span>
                {fighter.ranking ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                    {fighter.ranking.rank === "C" ? "Champion" : `#${fighter.ranking.rank}`} · {fighter.ranking.division}
                  </span>
                ) : null}
              </div>
              {bio.length ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  {bio.map(([label, value]) => (
                    <span key={label}>
                      <span className="text-zinc-400">{label}</span> {value}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {upcoming.length ? (
          <section className={shell}>
            <div className="px-5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Upcoming
            </div>
            <div className="divide-y divide-zinc-50 pb-2">
              {upcoming.map((row) => (
                <HistoryRowView key={row.fight_id} row={row} />
              ))}
            </div>
          </section>
        ) : null}

        <section className={shell}>
          <div className="px-5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            UFC fight history ({past.length})
          </div>
          <div className="divide-y divide-zinc-50 pb-2">
            {past.length ? (
              past.map((row) => <HistoryRowView key={row.fight_id} row={row} />)
            ) : (
              <div className="px-5 py-6 text-sm text-zinc-400">No UFC fights on record.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

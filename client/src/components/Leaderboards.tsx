import { Link } from "react-router-dom";
import { useApi } from "../api";
import { signedMoney, type LeaderboardEntry, type Leaderboards as BoardsData } from "../bets";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import FanAvatar from "./FanAvatar";


function Board({ title, subtitle, entries, format, tab, current }: {
  title: string; subtitle: string; entries: LeaderboardEntry[];
  format: (entry: LeaderboardEntry) => { text: string; tone?: string }; tab: string; current: string;
}) {
  return (
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title={title} subtitle={subtitle} />
      {entries.length ? <ol className="divide-y divide-line-subtle">
        {entries.map((entry, index) => {
          const value = format(entry);
          const self = entry.scorer.handle === current.toLowerCase() || entry.scorer.publicId === current;
          return <li key={entry.scorer.publicId}>
            <Link to={`/profiles/${entry.scorer.handle}?tab=${tab}`}
              className={`flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-muted sm:px-5 ${self ? "bg-info-subtle/90" : ""}`}>
              <span className={`w-5 shrink-0 text-right text-xs font-medium tabular-nums ${index < 3 ? "text-foreground" : "text-muted"}`}>{index + 1}</span>
              <FanAvatar src={entry.scorer.imageUrl} name={entry.scorer.displayName} size="md" />
              <span className={`min-w-0 flex-1 truncate text-sm ${self ? "font-medium text-foreground" : "font-medium text-foreground"}`}>{entry.scorer.displayName}</span>
              {/* The count behind the figure, beside it rather than under it. */}
              <span className="shrink-0 text-xs tabular-nums text-muted">{entry.detail}</span>
              <span className={`w-[4.75rem] shrink-0 text-right text-sm font-medium tabular-nums ${value.tone ?? "text-foreground"}`}>{value.text}</span>
            </Link>
          </li>;
        })}
      </ol> : <p className="px-5 py-8 text-center text-sm text-muted">No one qualifies yet.</p>}
    </section>
  );
}

/** The top ten fans on every measure: prediction points, how often they name
 *  the winner and the method, and profit from their bets. */
export default function Leaderboards({ handle }: { handle: string }) {
  const { data, error, retry } = useApi<BoardsData>("/api/leaderboards", 60_000);
  if (!data) return <section className={`appear-late ${PANEL_SHELL} p-5 text-sm text-muted`} role="status">
    {error ? <>{error} <button className="underline" onClick={retry}>Retry</button></> : "Loading leaderboards…"}
  </section>;
  const pct = (entry: LeaderboardEntry) => ({ text: `${Math.round(entry.value)}%` });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Board title="Top predictors" subtitle={`Points · ${data.minimums.points}+ settled picks`} entries={data.points} tab="predictions" current={handle}
        format={entry => ({ text: `${entry.value.toLocaleString()} pts` })} />
      <Board title="Winner accuracy" subtitle={`Right winner · ${data.minimums.winner}+ settled picks`} entries={data.winner} tab="predictions" current={handle} format={pct} />
      <Board title="Method accuracy" subtitle={`Right method · ${data.minimums.method}+ method calls`} entries={data.method} tab="predictions" current={handle} format={pct} />
      <Board title="Top bettors" subtitle={`Profit · ${data.minimums.bets}+ settled bets (per leg)`} entries={data.bets} tab="bets" current={handle}
        format={entry => ({ text: signedMoney(entry.value), tone: entry.value > 0 ? "text-success" : entry.value < 0 ? "text-danger" : undefined })} />
    </div>
  );
}

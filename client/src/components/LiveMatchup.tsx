import { Link } from "react-router-dom";
import { useApi } from "../api";
import type { LiveCard, LiveOddsAnswer } from "../api";
import { clockTime, countdown, formatMethod, isDecision, lastName, shortDecision } from "../format";
import { percent, useLiveOdds } from "../liveOdds";
import { useLivePreview } from "../livePreview";
import { useNow } from "../useNow";

/** Up next shows only inside this window; further out, a countdown is noise. */
const NEXT_WINDOW_MS = 12 * 3_600_000;

const PILL = "flex max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-2.5 pr-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50";

/** The bout on now while a card runs, nothing otherwise — with Polymarket's
 *  price for each side, and for a few minutes after a bout ends, its result.
 *  On a dev site the Live preview panel can stand in for both answers. */
export default function LiveMatchup() {
  const preview = useLivePreview();
  const { data } = useApi<LiveCard>(preview ? null : "/api/live", card => card ? 15_000 : 60_000);
  const odds = useLiveOdds(preview ? preview.oddsUrl : "/api/live/odds", preview ? preview.oddsUrl != null : Boolean(data));
  const card = preview ? preview.card : data;
  const answer = preview?.answer ?? odds;
  return <LivePill card={card} odds={answer} />;
}

function LivePill({ card, odds }: { card: LiveCard | null; odds: LiveOddsAnswer | null }) {
  const startsAt = card?.starts_at ?? null;
  const now = useNow(Boolean(card && !card.live && startsAt != null));

  if (odds?.finished) return <ResultPill result={odds.finished} />;
  if (!card) return null;
  if (!card.live && startsAt != null && startsAt - now > NEXT_WINDOW_MS) return null;
  const { fight } = card;
  const away = countdown(startsAt, now);
  const at = clockTime(startsAt);
  // Once the estimated start has passed we take the bout to be under way, so
  // "next" is only ever shown ahead of a walkout that has not happened yet.
  const live = card.live || !away;
  // Only a price for this very bout: /api/live and the odds move on separately.
  const price = odds?.fight_id === fight.id ? odds.odds : null;
  const [one, two] = [lastName(fight.f1.name), lastName(fight.f2.name)];
  const priced = price ? ` · Polymarket: ${fight.f1.name} ${percent(price.f1)}, ${fight.f2.name} ${percent(price.f2)}` : "";

  return (
    <Link
      to={`/fights/${fight.id}`}
      state={{ eventId: card.event.id }}
      title={`${fight.f1.name} vs ${fight.f2.name} · ${card.event.name}${live ? " · on now" : at ? ` · expected ${at}` : ""}${priced}`}
      className={PILL}
    >
      {live ? (
        <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
      ) : null}
      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700`}>
        {live ? "Live" : "Next"}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-xs">
        <span className="truncate font-semibold text-zinc-900">{one}</span>
        {price ? <Chance value={price.f1} other={price.f2} /> : null}
        <span className="shrink-0 text-zinc-400" aria-hidden={price ? true : undefined}>{price ? "·" : "vs"}</span>
        {price ? <Chance value={price.f2} other={price.f1} /> : null}
        <span className="truncate font-semibold text-zinc-900">{two}</span>
        {price ? <span className="sr-only">, Polymarket odds</span> : null}
      </span>
      {live && card.fight_number ? (
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500">
          {card.fight_number}/{card.total_fights}
        </span>
      ) : null}
      {!live && away ? (
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500" aria-label={`starts in ${away}`}>
          {away}
        </span>
      ) : null}
    </Link>
  );
}

/** The favourite's number is the strong one; weight and the figure itself
 *  carry it, so colour never does alone. */
function Chance({ value, other }: { value: number; other: number }) {
  const ahead = percent(value) !== percent(other) && value > other;
  return (
    <span className={`shrink-0 tabular-nums ${ahead ? "font-bold text-emerald-700" : "font-medium text-zinc-500"}`}>
      {percent(value)}
    </span>
  );
}

/** The bout that just ended: who won, how, and what Polymarket gave the winner
 *  before the walkout — an upset flagged when the market had them behind. */
function ResultPill({ result }: { result: NonNullable<LiveOddsAnswer["finished"]> }) {
  const names = [lastName(result.f1_name), lastName(result.f2_name)];
  // A decision always went the distance; its round says nothing.
  const how = result.method && isDecision(shortDecision(result.method)) ? shortDecision(result.method) : formatMethod(result.method, result.round, null);
  const label = result.f1_outcome === "draw" ? "Draw" : result.f1_outcome === "nc" ? "No contest" : "Final";
  const headline = result.winner == null
    ? `${names[0]} vs ${names[1]}`
    : `${names[result.winner! - 1]} def. ${names[2 - result.winner!]}`;
  const before = result.prefight && result.winner ? result.prefight[result.winner - 1] : null;
  const winnerName = result.winner ? (result.winner === 1 ? result.f1_name : result.f2_name) : "";
  const upset = before != null && before < 0.5 && percent(before) !== "50%";
  return (
    <Link
      to={`/fights/${result.id}`}
      title={`${headline}${how ? ` · ${how}` : ""}${before != null ? ` · Polymarket gave ${winnerName} ${percent(before)} before the fight` : ""}`}
      className={PILL}
    >
      {/* On a phone the headline and the market's verdict come first; "def."
          already says it is over, and the method is a tap away. */}
      <span className={`shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 ${result.winner ? "max-sm:hidden" : ""}`}>{label}</span>
      <span className="truncate text-xs font-semibold text-zinc-900">{headline}</span>
      {how ? <span className="shrink-0 text-[11px] font-medium text-zinc-500 max-sm:hidden">{how}</span> : null}
      {before != null ? (
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500">
          {percent(before)} pre-fight
        </span>
      ) : null}
      {upset ? (
        <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase text-amber-700">Upset</span>
      ) : null}
    </Link>
  );
}

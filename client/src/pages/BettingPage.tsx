import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi, type EventDetail, type EventFight, type EventListItem } from "../api";
import { signedMoney, signedPercent } from "../bets";
import {
  angles, formatAmerican, parseOdds, sampleUrl, toAmerican, topSplit, trendsUrl,
  type BettingCard, type BettingOverview, type BettingTrends, type BettingWindow, type BettorRow, type CardBout,
  type Rate, type Slip, type TrendPeriod, type TrendSample,
} from "../bettingHub";
import { formatDateShortWithYear, lastName } from "../format";
import { PAGE } from "../research";
import { useSeo } from "../seo";
import FanAvatar from "../components/FanAvatar";
import { PANEL_SHELL, PanelHeading } from "../components/FightStats";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected, segmentedTab } from "../components/segmented";

const TABS = [
  { id: "picks", label: "Top picks", short: "Picks" },
  { id: "slips", label: "Slips", short: "Slips" },
  { id: "bettors", label: "Bettors", short: "Bettors" },
  { id: "trends", label: "Trends", short: "Trends" },
  { id: "tools", label: "Tools", short: "Tools" },
] as const;
type Tab = typeof TABS[number]["id"];

const MUTED = "text-xs text-zinc-500";
const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-zinc-400";
const STATE_TONE: Record<string, string> = {
  won: "bg-emerald-100 text-emerald-700", lost: "bg-rose-100 text-rose-700",
  pending: "bg-zinc-100 text-zinc-600", void: "bg-zinc-100 text-zinc-400",
};
const tone = (value: number | null | undefined) => value == null || !value ? "text-zinc-500" : value > 0 ? "text-emerald-600" : "text-rose-600";
const pct = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

function Pending({ error, retry, what }: { error: boolean; retry: () => void; what: string }) {
  return <section className={`appear-late ${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {error ? <>Couldn’t load {what}. <button className="underline" onClick={retry}>Retry</button></> : `Loading ${what}…`}
  </section>;
}

function StateTag({ state }: { state: string }) {
  return <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase ${STATE_TONE[state] ?? STATE_TONE.pending}`}>{state === "pending" ? "Open" : state}</span>;
}

function Fan({ scorer, rank, tab = "bets" }: { scorer: BettorRow["scorer"]; rank?: number | null; tab?: string }) {
  return <Link to={`/profiles/${scorer.handle}?tab=${tab}`} className="flex min-w-0 items-center gap-2 hover:underline">
    {rank ? <span className="w-4 shrink-0 text-right text-[10px] font-semibold tabular-nums text-zinc-400">{rank}</span> : null}
    <FanAvatar src={scorer.imageUrl} name={scorer.displayName} />
    <span className="truncate text-[13px] font-medium text-zinc-800">{scorer.displayName}</span>
  </Link>;
}

/** The card a tab is about: `?event=`, else the next one on the calendar. */
function useCardChoice() {
  const [params, setParams] = useSearchParams();
  const { data: events } = useApi<EventListItem[]>("/api/events");
  const real = (events ?? []).filter(event => !event.potential);
  const upcoming = real.filter(event => event.status !== "past").sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const past = real.filter(event => event.status === "past").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const fallback = real.find(event => event.status === "current") ?? real.find(event => event.status === "next") ?? upcoming[0] ?? past[0];
  const eventId = params.get("event") ?? fallback?.id ?? null;
  const choose = (id: string) => setParams(current => { const next = new URLSearchParams(current); next.set("event", id); return next; }, { replace: true });
  const options = [...upcoming, ...past];
  if (eventId && !options.some(event => event.id === eventId)) {
    const chosen = real.find(event => event.id === eventId);
    if (chosen) options.push(chosen);
  }
  const picker = options.length ? (
    <select value={eventId ?? ""} onChange={event => choose(event.target.value)} aria-label="Card"
      className="h-8 max-w-full rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800">
      {upcoming.length ? <optgroup label="Coming up">{upcoming.map(event => <option key={event.id} value={event.id}>{event.name} · {formatDateShortWithYear(event.date)}</option>)}</optgroup> : null}
      <optgroup label="Past">{options.filter(event => !upcoming.includes(event)).map(event => <option key={event.id} value={event.id}>{event.name} · {formatDateShortWithYear(event.date)}</option>)}</optgroup>
    </select>
  ) : null;
  return { eventId, picker };
}

/** Two shares of one whole, f1 from the left in blue and f2 from the right in red. */
function SplitRow({ label, a, b, detail, emphasis, counts = false }: { label: string; a: number; b: number; detail?: ReactNode; emphasis?: 1 | 2 | null; counts?: boolean }) {
  const total = a + b;
  const left = total ? Math.round(a / total * 100) : 50;
  return <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
    <span className={LABEL}>{label}</span>
    <div className="flex min-w-0 items-center gap-2">
      <span className={`w-9 shrink-0 text-right text-xs tabular-nums ${emphasis === 1 ? "font-semibold text-zinc-900" : "text-zinc-500"}`}>{!total ? "—" : counts ? a : `${left}%`}</span>
      <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
        {total ? <>
          <div className="h-full bg-blue-500" style={{ width: `${left}%` }} />
          <div className="h-full bg-red-500" style={{ width: `${100 - left}%` }} />
        </> : null}
      </div>
      <span className={`w-9 shrink-0 text-xs tabular-nums ${emphasis === 2 ? "font-semibold text-zinc-900" : "text-zinc-500"}`}>{!total ? "—" : counts ? b : `${100 - left}%`}</span>
      {detail ? <span className="hidden w-16 shrink-0 text-right text-[10px] tabular-nums text-zinc-400 sm:inline">{detail}</span> : null}
    </div>
  </div>;
}

const METHOD_SHORT = { ko: "KO", submission: "Sub", decision: "Dec" } as const;

function BoutPanel({ fight, bout, situations }: { fight: EventFight; bout: CardBout | undefined; situations: Map<string, Rate> }) {
  const crowd = bout?.crowd ?? [0, 0];
  const crowdTotal = crowd[0] + crowd[1];
  const fair = bout?.fair;
  const split = topSplit(bout);
  // The crowd leaning ten points or more away from the market is worth saying.
  const gap = fair && crowdTotal >= 5 ? Math.round(crowd[0] / crowdTotal * 100 - fair[0]) : 0;
  const lean = Math.abs(gap) >= 10 ? (gap > 0 ? fight.f1.name : fight.f2.name) : null;
  const winner = bout?.winner ?? (fight.f1.outcome === "win" ? 1 : fight.f2.outcome === "win" ? 2 : null);
  const list = angles(fight);
  const picks = bout?.bettors.picks ?? [];
  const predictors = bout?.predictors ?? [];
  const name = (side: 1 | 2) => side === 1 ? fight.f1.name : fight.f2.name;
  return <section className={`${PANEL_SHELL} overflow-hidden`}>
    <Link to={`/fights/${fight.id}`} className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2.5 hover:bg-zinc-50 sm:px-5">
      <span className="min-w-0 truncate text-sm font-semibold text-zinc-900">
        <span className={winner === 2 ? "text-zinc-400" : ""}>{fight.f1.name}</span>
        <span className="px-1.5 font-normal text-zinc-400">vs</span>
        <span className={winner === 1 ? "text-zinc-400" : ""}>{fight.f2.name}</span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
        {bout?.lines[0] && bout.lines[1] ? `${bout.lines[0]} / ${bout.lines[1]}` : "No odds yet"}
      </span>
    </Link>
    <div className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      {fair ? <SplitRow label="Books" a={fair[0]} b={fair[1]} detail="no vig" emphasis={winner} /> : null}
      {crowdTotal ? <SplitRow label="Fans" a={crowd[0]} b={crowd[1]} detail={`${crowdTotal} ${crowdTotal === 1 ? "pick" : "picks"}`} emphasis={winner} /> : null}
      {split ? <SplitRow label="Top bettors" a={bout!.bettors.votes[0]} b={bout!.bettors.votes[1]} detail="bettors" emphasis={winner} counts /> : null}
      {!fair && !crowdTotal && !split ? <p className={MUTED}>No odds, picks or bets yet.</p> : null}
      {lean ? <p className="text-xs text-amber-800">Fans like <span className="font-semibold">{lean}</span> {Math.abs(gap)} points more than the books do.</p> : null}
      {list.length ? <ul className="flex flex-wrap gap-1.5">
        {list.map(angle => {
          const rate = situations.get(angle.key);
          const shown = rate && rate.n >= 30;
          return <li key={`${angle.side}${angle.key}`}>
            <Link to={`/betting?tab=trends&sample=${encodeURIComponent(angle.key)}`}
              title={shown ? `Fighters in this spot won ${pct(rate.winPct)} against the ${pct(rate.expectedPct)} the closing odds gave them (${rate.n.toLocaleString()} bouts); flat bets returned ${signedPercent(rate.roi ?? 0)}.` : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${angle.side === 1 ? "border-sky-200 bg-sky-50 text-sky-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {angle.text}
              {shown ? <span className="tabular-nums opacity-80">· won {pct(rate.winPct)} vs {pct(rate.expectedPct)} priced</span> : null}
            </Link>
          </li>;
        })}
      </ul> : null}
    </div>
    {picks.length ? <div className="border-t border-zinc-100 px-4 py-2.5 sm:px-5">
      <p className={`${LABEL} mb-1.5`}>Top bettors’ bets</p>
      <ul className="flex flex-col gap-1.5">
        {picks.slice(0, 6).map(pick => <li key={`${pick.betId}${pick.selection}`} className="flex items-center gap-2">
          <div className="min-w-0 flex-1"><Fan scorer={pick.scorer} rank={pick.rank} /></div>
          <span className="min-w-0 truncate text-xs text-zinc-700" title={pick.selection}>{pick.selection}</span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-500">{pick.price}</span>
          <span className="hidden w-24 shrink-0 text-right text-[11px] tabular-nums text-zinc-400 sm:inline">{pick.legs > 1 ? `in a ${pick.legs}-leg parlay` : `$${pick.stake.toFixed(2)}`}</span>
          {pick.state !== "pending" ? <StateTag state={pick.state} /> : null}
        </li>)}
      </ul>
      {picks.length > 6 ? <p className="mt-1 text-[11px] text-zinc-400">and {picks.length - 6} more</p> : null}
    </div> : null}
    {predictors.length ? <div className="border-t border-zinc-100 px-4 py-2.5 sm:px-5">
      <p className={`${LABEL} mb-1.5`}>Top predictors</p>
      <ul className="flex flex-wrap gap-1.5">
        {predictors.map(pick => <li key={pick.scorer.publicId}>
          <Link to={`/profiles/${pick.scorer.handle}?tab=predictions`} title={`${pick.scorer.displayName}: right ${pct(pick.accuracy)} of the time`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] hover:bg-zinc-50 ${pick.state === "won" ? "border-emerald-200" : pick.state === "lost" ? "border-rose-200" : "border-zinc-200"}`}>
            <FanAvatar src={pick.scorer.imageUrl} name={pick.scorer.displayName} />
            <span className="max-w-24 truncate text-zinc-500">{pick.scorer.displayName}</span>
            <span className="text-zinc-700">{lastName(name(pick.side))}{pick.method ? ` · ${METHOD_SHORT[pick.method]}` : ""}{pick.round ? ` R${pick.round}` : ""}</span>
          </Link>
        </li>)}
      </ul>
    </div> : null}
  </section>;
}

function PicksTab() {
  const { eventId, picker } = useCardChoice();
  const { data: event } = useApi<EventDetail>(eventId ? `/api/events/${eventId}` : null);
  const { data: card, error, retry } = useApi<BettingCard>(eventId ? `/api/betting/events/${eventId}` : null, 60_000);
  const { data: trends } = useApi<BettingTrends>(trendsUrl("all"));
  const situations = useMemo(() => new Map((trends?.situations ?? []).map(row => [row.key, row.rate])), [trends]);
  const bouts = useMemo(() => new Map((card?.bouts ?? []).map(bout => [bout.fightId, bout])), [card]);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className={MUTED}>Each bout: the books’ fair chances, the fans’ picks, and the calls of the top {card?.top ?? 10} bettors and predictors.</p>
      {picker}
    </div>
    {!event || !card ? <Pending error={error} retry={retry} what="the card" /> : event.fights.map(fight =>
      <BoutPanel key={fight.id} fight={fight} bout={bouts.get(fight.id)} situations={situations} />)}
  </>;
}

function SlipCard({ slip, eventId }: { slip: Slip; eventId: string | null }) {
  return <li className="flex flex-col gap-1.5 px-4 py-3 sm:px-5">
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1"><Fan scorer={slip.scorer} rank={slip.rank} /></div>
      <span className="text-xs text-zinc-500">{slip.legs.length > 1 ? `${slip.legs.length}-leg parlay` : "Straight"}</span>
      <StateTag state={slip.state} />
    </div>
    <ul className="flex flex-col gap-0.5 pl-6">
      {slip.legs.map((leg, index) => <li key={index} className={`flex items-center gap-2 text-xs ${leg.eventId === eventId ? "" : "opacity-60"}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${leg.state === "won" ? "bg-emerald-500" : leg.state === "lost" ? "bg-rose-500" : "bg-zinc-300"}`} aria-label={leg.state} />
        <Link to={`/fights/${leg.fightId}`} className="min-w-0 flex-1 truncate text-zinc-700 hover:underline" title={`${leg.f1Name} vs ${leg.f2Name} · ${leg.eventName}`}>{leg.selection}</Link>
        <span className="shrink-0 tabular-nums text-zinc-500">{leg.price}</span>
      </li>)}
    </ul>
    <p className="pl-6 text-[11px] tabular-nums text-zinc-500">
      ${slip.stake.toFixed(2)} at {slip.price} · {slip.state === "won" || slip.state === "lost"
        ? <span className={tone(slip.net)}>{signedMoney(slip.net)}</span> : <>pays ${slip.payout.toFixed(2)}</>}
    </p>
  </li>;
}

function SlipsTab() {
  const { eventId, picker } = useCardChoice();
  const { data: card, error, retry } = useApi<BettingCard>(eventId ? `/api/betting/events/${eventId}` : null, 60_000);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className={MUTED}>Fans’ play-money bets on this card. Top bettors first, then the biggest payouts.</p>
      {picker}
    </div>
    {!card ? <Pending error={error} retry={retry} what="slips" /> : <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="Slips" subtitle={card.slipCount > card.slips.length ? `${card.slips.length} of ${card.slipCount}` : `${card.slipCount}`} />
        {card.slips.length ? <ul className="divide-y divide-zinc-100">{card.slips.map(slip => <SlipCard key={slip.id} slip={slip} eventId={eventId} />)}</ul>
          : <p className="px-5 py-8 text-center text-sm text-zinc-500">No bets on this card yet. Open a bout’s odds to build a slip.</p>}
      </section>
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="Biggest hits" subtitle="Won, by profit" />
        {card.hits.length ? <ul className="divide-y divide-zinc-100">{card.hits.map(slip => <SlipCard key={slip.id} slip={slip} eventId={eventId} />)}</ul>
          : <p className="px-5 py-8 text-center text-sm text-zinc-500">Nothing has cashed on this card yet.</p>}
      </section>
    </div>}
  </>;
}

const WINDOWS: { id: BettingWindow; label: string }[] = [{ id: "all", label: "All time" }, { id: "year", label: "12 months" }, { id: "90d", label: "90 days" }];

function Record({ tally }: { tally: { right: number; wrong: number } }) {
  const total = tally.right + tally.wrong;
  return <span className="tabular-nums"><span className="font-semibold text-zinc-900">{tally.right}–{tally.wrong}</span>
    <span className="text-zinc-500"> · {total ? pct(Math.round(tally.right / total * 1000) / 10) : "—"}</span></span>;
}

function BettorsTab() {
  const [params, setParams] = useSearchParams();
  const span = (WINDOWS.find(entry => entry.id === params.get("window"))?.id ?? "all") as BettingWindow;
  const { data, error, retry } = useApi<BettingOverview>("/api/betting", 60_000);
  if (!data) return <Pending error={error} retry={retry} what="bettors" />;
  const rows = data.bettors[span];
  const crowd = data.crowd;
  return <>
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="Top bettors" subtitle={`Return on stake · ${data.minimums[span]}+ settled legs`}
        controls={<div className={segmentedGroup} role="group" aria-label="Period">
          {WINDOWS.map(entry => <button key={entry.id} type="button" aria-pressed={span === entry.id}
            onClick={() => setParams(current => { const next = new URLSearchParams(current); if (entry.id === "all") next.delete("window"); else next.set("window", entry.id); return next; }, { replace: true })}
            className={`${segmentedOption} ${span === entry.id ? segmentedSelected : segmentedIdle}`}>{entry.label}</button>)}
        </div>} />
      {rows.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-xs tabular-nums">
          <thead><tr className="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400">
            <th className="px-4 py-2 font-semibold sm:px-5">Bettor</th>
            <th className="px-2 py-2 text-right font-semibold">Record</th>
            <th className="px-2 py-2 text-right font-semibold">Staked</th>
            <th className="px-2 py-2 text-right font-semibold">Profit</th>
            <th className="px-2 py-2 text-right font-semibold">ROI</th>
            <th className="px-2 py-2 text-right font-semibold" title="Price of their median settled bet">Typical price</th>
            <th className="px-2 py-2 text-right font-semibold" title="How much better, on average, the moneyline prices taken were than where they closed. Positive means the market moved their way after they bet.">Beat close</th>
            <th className="px-4 py-2 font-semibold sm:px-5">Last 10</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map(row => <tr key={row.scorer.publicId} className={row.rank <= data.top ? "" : "opacity-80"}>
              <td className="max-w-48 px-4 py-2 sm:px-5"><Fan scorer={row.scorer} rank={row.rank} /></td>
              <td className="px-2 py-2 text-right text-zinc-700">{row.won}–{row.lost}<span className="text-zinc-400"> · {row.legs} legs</span></td>
              <td className="px-2 py-2 text-right text-zinc-500">${row.staked.toFixed(0)}</td>
              <td className={`px-2 py-2 text-right ${tone(row.net)}`}>{signedMoney(row.net)}</td>
              <td className={`px-2 py-2 text-right font-semibold ${tone(row.roi)}`}>{signedPercent(row.roi)}</td>
              <td className="px-2 py-2 text-right text-zinc-500">{row.avgPrice ?? "—"}</td>
              <td className={`px-2 py-2 text-right ${tone(row.clv)}`} title={row.clvLegs ? `${row.clvLegs} moneyline legs` : "No settled moneyline legs"}>{row.clv == null ? "—" : signedPercent(row.clv)}</td>
              <td className="px-4 py-2 sm:px-5"><span className="flex gap-0.5" aria-label={row.last.join(", ")}>
                {row.last.map((state, index) => <span key={index} className={`h-2 w-2 rounded-full ${state === "won" ? "bg-emerald-500" : "bg-rose-500"}`} />)}
              </span></td>
            </tr>)}
          </tbody>
        </table>
      </div> : <p className="px-5 py-8 text-center text-sm text-zinc-500">No one has {data.minimums[span]} settled legs in this period yet.</p>}
      <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 sm:px-5">
        Play money: every bet is $1–$20, and straight bets on one bout share $20, so return, not volume, decides the order. The top {data.top} all-time show on each card’s picks.
      </p>
    </section>
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="The crowd against the books" subtitle={`Bouts with ${crowd.minimum}+ fan picks`} />
      <div className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-2 sm:px-5">
        <div><p className={LABEL}>Fans’ majority pick</p><Record tally={crowd.crowd} /></div>
        <div><p className={LABEL}>Closing favourite, same bouts</p><Record tally={crowd.favourite} /></div>
      </div>
      {crowd.events.length ? <table className="w-full text-left text-xs tabular-nums">
        <thead><tr className="border-y border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400">
          <th className="px-4 py-2 font-semibold sm:px-5">Card</th><th className="px-2 py-2 text-right font-semibold">Fans</th><th className="px-4 py-2 text-right font-semibold sm:px-5">Favourites</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">{crowd.events.map(event => <tr key={event.eventId}>
          <td className="max-w-0 truncate px-4 py-2 sm:px-5"><Link to={`/events/${event.eventId}`} className="text-zinc-800 hover:underline">{event.name}</Link> <span className="text-zinc-400">{formatDateShortWithYear(event.date)}</span></td>
          <td className={`px-2 py-2 text-right ${event.crowd.right > event.favourite.right ? "font-semibold text-emerald-600" : "text-zinc-700"}`}>{event.crowd.right}–{event.crowd.wrong}</td>
          <td className="px-4 py-2 text-right text-zinc-700 sm:px-5">{event.favourite.right}–{event.favourite.wrong}</td>
        </tr>)}</tbody>
      </table> : null}
      {crowd.split ? <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 sm:px-5">{crowd.split} evenly split {crowd.split === 1 ? "bout is" : "bouts are"} left out.</p> : null}
    </section>
  </>;
}

const PERIODS: { id: TrendPeriod; label: string }[] = [{ id: "all", label: "All" }, { id: "10y", label: "10 years" }, { id: "5y", label: "5 years" }];

/** A rate with too few bouts behind it is shown as its count alone. */
function RateCells({ rate, minimum, onOpen }: { rate: Rate; minimum: number; onOpen?: () => void }) {
  const thin = rate.n < minimum;
  const n = onOpen ? <button type="button" onClick={onOpen} className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500">{rate.n.toLocaleString()}</button> : rate.n.toLocaleString();
  return <>
    <td className="px-2 py-1.5 text-right text-zinc-500">{n}</td>
    <td className="px-2 py-1.5 text-right font-semibold text-zinc-900">{thin ? "—" : pct(rate.winPct)}</td>
    <td className="px-2 py-1.5 text-right text-zinc-500">{thin ? "—" : pct(rate.expectedPct)}</td>
    <td className={`px-2 py-1.5 text-right ${thin ? "text-zinc-400" : tone(rate.roi)}`}>{thin || rate.roi == null ? "—" : signedPercent(rate.roi)}</td>
  </>;
}
const RATE_HEAD = <>
  <th className="px-2 py-2 text-right font-semibold">Bouts</th>
  <th className="px-2 py-2 text-right font-semibold">Won</th>
  <th className="px-2 py-2 text-right font-semibold" title="The chance the closing odds gave them, with the bookmaker's margin taken out">Priced</th>
  <th className="px-2 py-2 text-right font-semibold" title="Return from $100 on every one of them at the closing line">Flat ROI</th>
</>;
const TABLE = "w-full min-w-[28rem] text-left text-xs tabular-nums";
const HEAD_ROW = "border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400";

function SampleDialog({ period, sampleKey, label, onClose }: { period: TrendPeriod; sampleKey: string; label: string; onClose: () => void }) {
  const { data, error, retry } = useApi<TrendSample>(sampleUrl(period, sampleKey));
  return <section className={`${PANEL_SHELL} overflow-hidden`} aria-label={`Bouts behind: ${label}`}>
    <PanelHeading title={label} subtitle={data ? `Newest ${data.bouts.length} of ${data.total.toLocaleString()}` : undefined}
      aside={<button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">Close</button>} />
    {!data ? <p className="px-5 py-4 text-sm text-zinc-500">{error ? <>Couldn’t load the bouts. <button className="underline" onClick={retry}>Retry</button></> : "Loading bouts…"}</p>
      : <div className="max-h-96 overflow-y-auto"><table className="w-full text-left text-xs tabular-nums">
        <tbody className="divide-y divide-zinc-100">{data.bouts.map(bout => <tr key={`${bout.fightId}${bout.fighter.id}`}>
          <td className="whitespace-nowrap px-4 py-1.5 text-zinc-400 sm:px-5">{formatDateShortWithYear(bout.date)}</td>
          <td className="max-w-0 truncate px-2 py-1.5"><Link to={`/fights/${bout.fightId}`} className="text-zinc-800 hover:underline">
            <span className="font-medium">{bout.fighter.name}</span> <span className="text-zinc-400">vs</span> {bout.opponent.name}</Link></td>
          <td className="px-2 py-1.5 text-right text-zinc-500">{bout.fighter.line == null ? "—" : formatAmerican(bout.fighter.line)}</td>
          <td className="px-4 py-1.5 text-right sm:px-5"><StateTag state={bout.won ? "won" : "lost"} /></td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

function TrendsTab() {
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.find(entry => entry.id === params.get("period"))?.id ?? "all") as TrendPeriod;
  const sample = params.get("sample");
  const set = (key: string, value: string | null) => setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const { data, error, retry } = useApi<BettingTrends>(trendsUrl(period));
  if (!data) return <Pending error={error} retry={retry} what="betting trends" />;
  const labels = new Map<string, string>([
    ...data.lines.map(row => [row.key, `Closing at ${row.label}`] as const),
    ...data.situations.map(row => [row.key, row.label] as const),
    ...data.spots.map(row => [row.key, `Favourites: ${row.label}`] as const),
  ]);
  const open = (key: string) => () => set("sample", key);
  const { favourites, underdogs } = data.summary;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className={MUTED}>{data.pricedBouts.toLocaleString()} UFC bouts with closing odds{data.firstYear ? ` since ${data.since ? data.since.slice(0, 4) : data.firstYear}` : ""}. Draws and no contests are left out; rows under {data.minimum} bouts show their count only. Press a count for its bouts.</p>
      <div className={segmentedGroup} role="group" aria-label="Period">
        {PERIODS.map(entry => <button key={entry.id} type="button" aria-pressed={period === entry.id} onClick={() => set("period", entry.id === "all" ? null : entry.id)}
          className={`${segmentedOption} ${period === entry.id ? segmentedSelected : segmentedIdle}`}>{entry.label}</button>)}
      </div>
    </div>
    {sample && labels.has(sample) ? <SampleDialog key={`${period}${sample}`} period={period} sampleKey={sample} label={labels.get(sample)!} onClose={() => set("sample", null)} /> : null}
    <section className={`${PANEL_SHELL} grid gap-3 p-4 sm:grid-cols-2 sm:p-5`}>
      {([["Favourites", favourites], ["Underdogs", underdogs]] as const).map(([title, rate]) => <div key={title}>
        <p className={LABEL}>{title}</p>
        <p className="text-2xl font-semibold tabular-nums text-zinc-900">{pct(rate.winPct)}</p>
        <p className="text-xs tabular-nums text-zinc-500">won, against {pct(rate.expectedPct)} priced · flat bets <span className={tone(rate.roi)}>{signedPercent(rate.roi ?? 0)}</span></p>
      </div>)}
      <p className="text-[11px] text-zinc-400 sm:col-span-2">Every return is after the bookmaker’s margin, which is why almost everything loses a little. A row is interesting when its win rate beats what it was priced at.</p>
    </section>
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="By closing price" subtitle="Every side" />
        <div className="overflow-x-auto"><table className={TABLE}>
          <thead><tr className={HEAD_ROW}><th className="px-4 py-2 font-semibold sm:px-5">Line</th>{RATE_HEAD}</tr></thead>
          <tbody className="divide-y divide-zinc-100">{data.lines.map(row => <tr key={row.key}>
            <td className="px-4 py-1.5 text-zinc-700 sm:px-5">{row.label}</td><RateCells rate={row.rate} minimum={data.minimum} onOpen={open(row.key)} /></tr>)}</tbody>
        </table></div>
      </section>
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="Situations" subtitle="The fighter in that spot" />
        <div className="overflow-x-auto"><table className={TABLE}>
          <thead><tr className={HEAD_ROW}><th className="px-4 py-2 font-semibold sm:px-5">Walking in</th>{RATE_HEAD}</tr></thead>
          <tbody className="divide-y divide-zinc-100">{data.situations.map(row => <tr key={row.key}>
            <td className="px-4 py-1.5 text-zinc-700 sm:px-5" title={row.note}>{row.label}</td><RateCells rate={row.rate} minimum={data.minimum} onOpen={open(row.key)} /></tr>)}</tbody>
        </table></div>
      </section>
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="Favourites by spot" subtitle="Underdog ROI beside" />
        <div className="overflow-x-auto"><table className={TABLE}>
          <thead><tr className={HEAD_ROW}><th className="px-4 py-2 font-semibold sm:px-5">Bouts</th>{RATE_HEAD}<th className="px-4 py-2 text-right font-semibold sm:px-5">Dog ROI</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">{data.spots.map(row => <tr key={row.key}>
            <td className="px-4 py-1.5 text-zinc-700 sm:px-5">{row.label}</td><RateCells rate={row.favourites} minimum={data.minimum} onOpen={open(row.key)} />
            <td className={`px-4 py-1.5 text-right sm:px-5 ${row.underdogs.n < data.minimum ? "text-zinc-400" : tone(row.underdogs.roi)}`}>{row.underdogs.n < data.minimum || row.underdogs.roi == null ? "—" : signedPercent(row.underdogs.roi)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="Going the distance" subtitle="Three-round bouts" />
        <div className="overflow-x-auto"><table className={TABLE}>
          <thead><tr className={HEAD_ROW}>
            <th className="px-4 py-2 font-semibold sm:px-5">Division</th><th className="px-2 py-2 text-right font-semibold">Bouts</th>
            <th className="px-2 py-2 text-right font-semibold">Decision</th><th className="px-2 py-2 text-right font-semibold">R1 finish</th>
            <th className="px-2 py-2 text-right font-semibold" title="Past 7:30 of fight time">Over 1½</th><th className="px-2 py-2 text-right font-semibold" title="Past 12:30 of fight time">Over 2½</th>
            <th className="px-4 py-2 text-right font-semibold sm:px-5">Avg min</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">{data.distance.filter(row => row.n >= data.minimum).map(row => <tr key={row.division}>
            <td className="px-4 py-1.5 text-zinc-700 sm:px-5">{row.division}</td><td className="px-2 py-1.5 text-right text-zinc-500">{row.n.toLocaleString()}</td>
            <td className="px-2 py-1.5 text-right font-semibold text-zinc-900">{pct(row.decision)}</td><td className="px-2 py-1.5 text-right text-zinc-700">{pct(row.r1)}</td>
            <td className="px-2 py-1.5 text-right text-zinc-700">{pct(row.over15)}</td><td className="px-2 py-1.5 text-right text-zinc-700">{pct(row.over25)}</td>
            <td className="px-4 py-1.5 text-right text-zinc-500 sm:px-5">{row.minutes}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </div>
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="By year" subtitle="Favourites, underdog ROI beside" />
        <div className="max-h-96 overflow-auto"><table className={TABLE}>
          <thead><tr className={HEAD_ROW}><th className="px-4 py-2 font-semibold sm:px-5">Year</th>{RATE_HEAD}<th className="px-4 py-2 text-right font-semibold sm:px-5">Dog ROI</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">{data.years.map(row => <tr key={row.year}>
            <td className="px-4 py-1.5 text-zinc-700 sm:px-5">{row.year}</td><RateCells rate={row.favourites} minimum={data.minimum} />
            <td className={`px-4 py-1.5 text-right sm:px-5 ${tone(row.underdogs.roi)}`}>{row.underdogs.roi == null ? "—" : signedPercent(row.underdogs.roi)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <section className={`${PANEL_SHELL} overflow-hidden`}>
        <PanelHeading title="Biggest upsets" subtitle="Longest closing price to win" />
        <ul className="divide-y divide-zinc-100">{data.upsets.map(upset => <li key={upset.fightId}>
          <Link to={`/fights/${upset.fightId}`} className="flex items-center gap-3 px-4 py-1.5 text-xs hover:bg-zinc-50 sm:px-5">
            <span className="w-12 shrink-0 font-semibold tabular-nums text-emerald-600">{upset.line}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-800"><span className="font-medium">{upset.winner.name}</span> <span className="text-zinc-400">over</span> {upset.loser.name}</span>
            <span className="shrink-0 tabular-nums text-zinc-400">{formatDateShortWithYear(upset.date)}</span>
          </Link>
        </li>)}</ul>
      </section>
    </div>
  </>;
}

const INPUT = "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm tabular-nums text-zinc-900";
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="flex min-w-0 flex-col gap-1"><span className={LABEL}>{label}</span>
    <input className={INPUT} value={value} inputMode="decimal" placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>;
}
function Out({ label, value, tone: ink }: { label: string; value: string; tone?: string }) {
  return <div className="min-w-0"><p className={LABEL}>{label}</p><p className={`text-lg font-semibold tabular-nums ${ink ?? "text-zinc-900"}`}>{value}</p></div>;
}
const money = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fractional = (decimal: number) => {
  // The nearest fraction with a denominator up to 20, as books quote them.
  let best = { n: 1, d: 1, err: Infinity };
  for (let d = 1; d <= 20; d++) { const n = Math.round((decimal - 1) * d); const err = Math.abs(n / d - (decimal - 1)); if (n > 0 && err < best.err - 1e-9) best = { n, d, err }; }
  return `${best.n}/${best.d}`;
};

function ToolsTab() {
  const [odds, setOdds] = useState("+150");
  const [legs, setLegs] = useState(["-200", "+130", ""]);
  const [stake, setStake] = useState("10");
  const [sideA, setSideA] = useState("-180");
  const [sideB, setSideB] = useState("+155");
  const [mine, setMine] = useState("60");
  const [hedge, setHedge] = useState({ stake: "10", price: "+300", other: "-150" });
  const converted = parseOdds(odds);
  const prices = legs.map(parseOdds).filter((value): value is number => value != null);
  const parlay = prices.reduce((product, value) => product * value, 1);
  const stakeValue = Number(stake) || 0;
  const a = parseOdds(sideA), b = parseOdds(sideB);
  const fairA = a && b ? (1 / a) / (1 / a + 1 / b) : null;
  const margin = a && b ? (1 / a + 1 / b - 1) * 100 : null;
  const chance = Number(mine) / 100;
  const ev = a && chance > 0 && chance < 1 ? (chance * (a - 1) - (1 - chance)) * 100 : null;
  const hStake = Number(hedge.stake) || 0, hPrice = parseOdds(hedge.price), hOther = parseOdds(hedge.other);
  const hedgeStake = hPrice && hOther ? hStake * hPrice / hOther : null;
  const panel = `${PANEL_SHELL} flex flex-col gap-3 p-4 sm:p-5`;
  return <>
    <p className={MUTED}>Calculators for any price, American (+150, −200) or decimal (2.50). Nothing here is saved or sent anywhere.</p>
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className={panel}>
        <h2 className="text-sm font-semibold text-zinc-900">Odds converter</h2>
        <Field label="Price" value={odds} onChange={setOdds} placeholder="+150 or 2.50" />
        {converted ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Out label="American" value={formatAmerican(toAmerican(converted))} />
          <Out label="Decimal" value={converted.toFixed(2)} />
          <Out label="Fractional" value={fractional(converted)} />
          <Out label="Implied" value={pct(Math.round(1000 / converted) / 10)} />
        </div> : <p className={MUTED}>Enter a price.</p>}
      </section>
      <section className={panel}>
        <h2 className="text-sm font-semibold text-zinc-900">Parlay calculator</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {legs.map((leg, index) => <Field key={index} label={`Leg ${index + 1}`} value={leg} onChange={value => setLegs(list => list.map((entry, i) => i === index ? value : entry))} placeholder="+150" />)}
          <Field label="Stake" value={stake} onChange={setStake} placeholder="10" />
        </div>
        <div className="flex gap-2">
          {legs.length < 10 ? <button type="button" className="text-xs font-medium text-zinc-500 underline" onClick={() => setLegs(list => [...list, ""])}>Add a leg</button> : null}
          {legs.length > 2 ? <button type="button" className="text-xs font-medium text-zinc-500 underline" onClick={() => setLegs(list => list.slice(0, -1))}>Remove one</button> : null}
        </div>
        {prices.length >= 2 ? <div className="grid grid-cols-3 gap-3">
          <Out label="Price" value={formatAmerican(toAmerican(parlay))} />
          <Out label="Pays" value={money(stakeValue * parlay)} />
          <Out label="Implied" value={pct(Math.round(1000 / parlay) / 10)} />
        </div> : <p className={MUTED}>Enter at least two legs.</p>}
      </section>
      <section className={panel}>
        <h2 className="text-sm font-semibold text-zinc-900">Fair odds and value</h2>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Fighter A" value={sideA} onChange={setSideA} />
          <Field label="Fighter B" value={sideB} onChange={setSideB} />
          <Field label="Your % for A" value={mine} onChange={setMine} />
        </div>
        {fairA != null && margin != null ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Out label="Fair A" value={`${pct(Math.round(fairA * 1000) / 10)} · ${formatAmerican(toAmerican(1 / fairA))}`} />
          <Out label="Fair B" value={`${pct(Math.round((1 - fairA) * 1000) / 10)} · ${formatAmerican(toAmerican(1 / (1 - fairA)))}`} />
          <Out label="Book margin" value={pct(Math.round(margin * 10) / 10)} />
          <Out label="Your edge on A" value={ev == null ? "—" : signedPercent(ev)} tone={tone(ev)} />
        </div> : <p className={MUTED}>Enter both sides’ prices.</p>}
        <p className="text-[11px] text-zinc-400">Edge is the expected return of a bet on A at its price, if your chance is right.</p>
      </section>
      <section className={panel}>
        <h2 className="text-sm font-semibold text-zinc-900">Hedge calculator</h2>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Original stake" value={hedge.stake} onChange={value => setHedge(h => ({ ...h, stake: value }))} />
          <Field label="At price" value={hedge.price} onChange={value => setHedge(h => ({ ...h, price: value }))} />
          <Field label="Other side now" value={hedge.other} onChange={value => setHedge(h => ({ ...h, other: value }))} />
        </div>
        {hedgeStake != null && hPrice ? <div className="grid grid-cols-2 gap-3">
          <Out label="Hedge stake" value={money(hedgeStake)} />
          <Out label="Locked result" value={signedMoney(hStake * hPrice - hStake - hedgeStake)} tone={tone(hStake * hPrice - hStake - hedgeStake)} />
        </div> : <p className={MUTED}>Enter the stake and both prices.</p>}
        <p className="text-[11px] text-zinc-400">The stake on the other side that pays the same whoever wins.</p>
      </section>
    </div>
  </>;
}

export default function BettingPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find(entry => entry.id === params.get("tab"))?.id ?? "picks";
  useSeo({
    title: "UFC Betting: Top Bettors' Picks, Slips & Betting Trends",
    description: "What ufc.sh's best play-money bettors and predictors are picking on every UFC card, their slips, and how favourites, underdogs and every price band have done.",
    path: "/betting",
  });
  const choose = (id: Tab) => setParams(current => {
    const next = new URLSearchParams();
    if (id !== "picks") next.set("tab", id);
    const event = current.get("event");
    if (event && (id === "picks" || id === "slips")) next.set("event", event);
    return next;
  }, { replace: true });
  return <div className={PAGE}>
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-2 pb-10 sm:p-3">
      <header className="flex flex-col gap-1 px-1 pt-1">
        <h1 className="text-lg font-semibold text-zinc-900">Betting</h1>
        <p className={MUTED}>Play money only. Fans’ own picks and bets on ufc.sh, and how the market has done. Nothing here is a real bet or a tip.</p>
      </header>
      <div className={`${segmentedGroup} w-full`} role="tablist" aria-label="Betting">
        {TABS.map(entry => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => choose(entry.id)}
          className={`${segmentedTab} ${tab === entry.id ? segmentedSelected : segmentedIdle}`}>
          <span className="sm:hidden">{entry.short}</span><span className="hidden sm:inline">{entry.label}</span>
        </button>)}
      </div>
      {tab === "picks" ? <PicksTab /> : tab === "slips" ? <SlipsTab /> : tab === "bettors" ? <BettorsTab /> : tab === "trends" ? <TrendsTab /> : <ToolsTab />}
    </div>
  </div>;
}

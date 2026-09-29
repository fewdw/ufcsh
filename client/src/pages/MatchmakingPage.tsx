import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useApi, type MatchFighter, type MatchmakingData } from "../api";
import { formatDate } from "../format";
import { PAGE, PAGE_BODY } from "../research";
import { useSeo } from "../seo";
import { useRouteScrollRestoration } from "../navigationState";
import Avatar from "../components/Avatar";
import FighterSearch, { type PickedFighter } from "../components/FighterSearch";
import Freshness from "../components/Freshness";
import RequestNotice from "../components/RequestNotice";
import { PageState } from "../components/ResearchKit";
import { PANEL } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedTab, segmentedSelected } from "../components/segmented";

const TABS = [
  { key: "top15", label: "Top 15" },
  { key: "last", label: "Last card" },
  { key: "card", label: "Create a card" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// ---------------------------------------------------------------------------
// Create a card

/** Keep the saved card’s 13 bouts in order: six main-card fights, seven prelims. */
const ROWS = [{ bouts: 2, big: true }, { bouts: 4 }, { bouts: 7, prelims: true }] as const;
const BOUTS = ROWS.reduce((total, row) => total + row.bouts, 0);
const CARD_KEY = "ufcsh:matchmaking-card:v1";

type Slot = PickedFighter | null;

function savedCard(): Slot[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CARD_KEY) ?? "null") as Slot[] | null;
    if (Array.isArray(saved) && saved.length === BOUTS * 2) return saved;
  } catch {
    // An unreadable card starts empty.
  }
  return Array(BOUTS * 2).fill(null);
}

function Corner({ fighter, big, onPick, onClear }: { fighter: Slot; big: boolean; onPick: () => void; onClear: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      {fighter ? (
        <button type="button" onClick={onClear} aria-label={`Remove ${fighter.name}`} title="Remove"
          className="rounded-full transition hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
          <Avatar src={fighter.photo_url} name={fighter.name} size={big ? "lg" : "md"} />
        </button>
      ) : (
        <button type="button" onClick={onPick} aria-label="Add a fighter"
          className={`grid shrink-0 place-items-center rounded-full border border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 transition hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${big ? "h-20 w-20" : "h-12 w-12"}`}>
          <Plus className={big ? "h-6 w-6" : "h-5 w-5"} aria-hidden="true" />
        </button>
      )}
      {fighter ? (
        <Link to={`/fighters/${fighter.id}`} className="w-full text-center text-xs font-semibold leading-4 text-zinc-900 hover:underline">{fighter.name}</Link>
      ) : <span className="w-full text-center text-xs leading-4 text-zinc-500">Add fighter</span>}
    </div>
  );
}

function Bout({ corners, big, onPick, onClear }: { corners: [Slot, Slot]; big: boolean; onPick: (corner: 0 | 1) => void; onClear: (corner: 0 | 1) => void }) {
  return (
    <div className={`flex h-full min-w-0 items-start gap-2 rounded-xl border border-zinc-200 bg-white ${big ? "p-4 sm:p-5" : "px-3 py-4"}`}>
      <Corner fighter={corners[0]} big={big} onPick={() => onPick(0)} onClear={() => onClear(0)} />
      <span className={`shrink-0 text-[10px] font-medium uppercase text-zinc-400 ${big ? "mt-8" : "mt-4"}`}>vs</span>
      <Corner fighter={corners[1]} big={big} onPick={() => onPick(1)} onClear={() => onClear(1)} />
    </div>
  );
}

/** A dialog with the site's fighter search; the chosen fighter fills the slot. */
function Picker({ taken, onPick, onClose }: { taken: PickedFighter[]; onPick: (fighter: PickedFighter) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector("input")?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-zinc-950/40 p-3 pt-[15vh] backdrop-blur-[2px]" onClick={onClose}>
      <div ref={panel} role="dialog" aria-label="Pick a fighter" className={`${PANEL} w-full max-w-md p-3`} onClick={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-zinc-900">Pick a fighter</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {/* Everyone already on the card is "selected", so the search leaves them out. */}
        <FighterSearch selected={taken} showSelected={false} max={BOUTS * 2} emptyPlaceholder="Search any fighter…"
          onChange={(fighters) => { const chosen = fighters.at(-1); if (chosen && !taken.includes(chosen)) onPick(chosen); }} />
      </div>
    </div>
  );
}

function CardBuilder() {
  const [slots, setSlots] = useState<Slot[]>(savedCard);
  const [picking, setPicking] = useState<number | null>(null);
  useEffect(() => {
    try { localStorage.setItem(CARD_KEY, JSON.stringify(slots)); } catch { /* private mode: the card lasts the visit */ }
  }, [slots]);
  const set = (index: number, fighter: Slot) => setSlots((current) => current.map((slot, i) => (i === index ? fighter : slot)));
  const taken = slots.filter((slot): slot is PickedFighter => Boolean(slot));
  let bout = 0;
  return (
    <section className="mx-auto w-full max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-[12px] text-zinc-500">Pick any fighters. Your card stays in this browser.</p>
        {taken.length ? (
          <button type="button" onClick={() => setSlots(Array(BOUTS * 2).fill(null))}
            className="shrink-0 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900">
            Clear card
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {ROWS.map((row, rowIndex) => {
          const first = bout;
          bout += row.bouts;
          const big = "big" in row && row.big;
          return (
            <div key={rowIndex} className="flex flex-col gap-3">
              {"prelims" in row && row.prelims ? (
                <h2 className="mt-3 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Prelims</h2>
              ) : null}
              {rowIndex === 0 ? <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Main card</h2> : null}
              {/* A wrapping row rather than a grid, so an odd bout left over sits centered. */}
              <div className="flex flex-wrap justify-center gap-3">
                {Array.from({ length: row.bouts }, (_, i) => {
                  const index = first + i;
                  return (
                    <div key={index} className={`min-w-0 basis-full ${big ? "sm:basis-[calc(50%-0.375rem)]" : "min-[400px]:basis-[calc(50%-0.375rem)] lg:basis-[calc(25%-0.5625rem)]"}`}>
                      <Bout corners={[slots[index * 2], slots[index * 2 + 1]]} big={big}
                        onPick={(corner) => setPicking(index * 2 + corner)} onClear={(corner) => set(index * 2 + corner, null)} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {picking != null ? (
        <Picker taken={taken} onClose={() => setPicking(null)} onPick={(fighter) => { set(picking, fighter); setPicking(null); }} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Suggestions

const rankLabel = (rank: number | null) => (rank === 0 ? "C" : rank == null ? null : `#${rank}`);

function Streak({ streak }: { streak: number }) {
  if (!streak) return null;
  return (
    <span className={`text-[10px] font-semibold tabular-nums ${streak > 0 ? "text-emerald-700" : "text-rose-700"}`}
      title={`${Math.abs(streak)} straight ${streak > 0 ? "wins" : "losses"}`}>
      {Math.abs(streak)}{streak > 0 ? "W" : "L"}
    </span>
  );
}

/** A fighter's photo, rank, name, record and run. */
function Fighter({ fighter, align = "left" }: { fighter: MatchFighter; align?: "left" | "right" | "responsive" }) {
  const right = align === "right";
  const responsive = align === "responsive";
  const rank = rankLabel(fighter.rank);
  return (
    <>
      <Avatar src={fighter.photo_url} name={fighter.name} size="xs" />
      <span className={`min-w-0 ${right ? "text-right" : responsive ? "@min-[420px]:text-right" : ""}`}>
        <span className={`flex min-w-0 items-center gap-1 ${right ? "flex-row-reverse" : responsive ? "@min-[420px]:flex-row-reverse" : ""}`}>
          {rank ? <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-400">{rank}</span> : null}
          <span className="truncate text-[13px] font-medium text-zinc-900">{fighter.name}</span>
        </span>
        <span className={`flex items-center gap-1 text-[11px] tabular-nums text-zinc-500 ${right ? "flex-row-reverse" : responsive ? "@min-[420px]:flex-row-reverse" : ""}`}>
          {fighter.record}<Streak streak={fighter.streak} />
        </span>
      </span>
    </>
  );
}

/** A fighter in a suggested bout, linking to their profile. */
function Side({ fighter, align = "left" }: { fighter: MatchFighter; align?: "left" | "right" | "responsive" }) {
  const className = `flex min-w-0 flex-1 items-center gap-2 ${align === "right" ? "flex-row-reverse" : align === "responsive" ? "@min-[420px]:flex-row-reverse" : ""}`;
  const body = <Fighter fighter={fighter} align={align} />;
  return fighter.id ? <Link to={`/fighters/${fighter.id}`} title={fighter.name} className={`${className} rounded-lg hover:opacity-80`}>{body}</Link> : <span className={className}>{body}</span>;
}

// ---------------------------------------------------------------------------
// Matchmake it yourself

const PAIRS_KEY = "ufcsh:matchmaker:v1:";
const fighterKey = (fighter: MatchFighter) => fighter.id ?? fighter.name;
type Pair = [string, string];

function savedPairs(id: string, pool: MatchFighter[]): Pair[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PAIRS_KEY + id) ?? "[]") as Pair[];
    const known = new Set(pool.map(fighterKey));
    if (Array.isArray(saved)) return saved.filter((pair) => Array.isArray(pair) && known.has(pair[0]) && known.has(pair[1]));
  } catch {
    // Unreadable pairings start over.
  }
  return [];
}

/** The reader's own fights from a division or a card: tap two fighters to
 *  pair them, tap a fight to split it. The pairings stay in this browser. */
function Matchmaker({ id, pool }: { id: string; pool: MatchFighter[] }) {
  const [pairs, setPairs] = useState(() => savedPairs(id, pool));
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    try { localStorage.setItem(PAIRS_KEY + id, JSON.stringify(pairs)); } catch { /* private mode: the pairings last the visit */ }
  }, [id, pairs]);
  const byKey = new Map(pool.map((fighter) => [fighterKey(fighter), fighter]));
  const paired = new Set(pairs.flat());
  const open = pool.filter((fighter) => !paired.has(fighterKey(fighter)));
  const pick = (key: string) => {
    if (!picked || picked === key) return setPicked(picked ? null : key);
    setPairs((current) => [...current, [picked, key]]);
    setPicked(null);
  };
  return (
    <div className="flex flex-1 flex-col">
      {pairs.length ? (
        <ul>
          {pairs.map(([a, b]) => (
            <li key={`${a}-${b}`} className="border-b border-zinc-100">
              <button type="button" title="Split this fight" aria-label={`Split ${byKey.get(a)!.name} vs ${byKey.get(b)!.name}`}
                onClick={() => setPairs((current) => current.filter((pair) => pair[0] !== a || pair[1] !== b))}
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition hover:bg-zinc-50">
                <span className="flex min-w-0 flex-1 items-center gap-2"><Fighter fighter={byKey.get(a)!} /></span>
                <span className="shrink-0 text-[10px] uppercase text-zinc-400">vs</span>
                <span className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2"><Fighter fighter={byKey.get(b)!} align="right" /></span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open.length ? (
        <>
          <p className="px-3 pt-2.5 text-[11px] leading-4 text-zinc-500">
            {picked ? `Pick an opponent for ${byKey.get(picked)?.name}.` : "Tap two fighters to make a fight. Tap a fight to split it."}
          </p>
          <ul className="grid grid-cols-2 gap-1.5 p-3 @min-[420px]:grid-cols-3">
            {open.map((fighter) => {
              const key = fighterKey(fighter);
              return (
                <li key={key} className="min-w-0">
                  <button type="button" aria-pressed={picked === key} onClick={() => pick(key)}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition ${picked === key ? "border-zinc-400 bg-zinc-100" : "border-zinc-200 hover:bg-zinc-50"}`}>
                    <Fighter fighter={fighter} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : <p className="px-3 py-2.5 text-[11px] text-zinc-500">Everyone has a fight.</p>}
      {pairs.length ? (
        <button type="button" onClick={() => { setPairs([]); setPicked(null); }}
          className="mx-3 mb-3 mt-auto self-start rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900">
          Start over
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels

/** A division's or a card's heading. A phone shows one at a time, so there the
 *  name is a picker for the others; the button swaps the suggestions for the
 *  reader's own matchmaking. */
function PanelHeader({ title, label, options, value, onPick, matchmaking, onMatchmake, children }: {
  title: ReactNode; label: string; options: { value: string; label: string }[]; value: string; onPick: (value: string) => void;
  matchmaking: boolean; onMatchmake: () => void; children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 px-3 py-2">
      <div className="min-w-0 flex-1">
        <label className="block md:hidden">
          <span className="sr-only">{label}</span>
          <select value={value} onChange={(event) => onPick(event.target.value)}
            className="w-full min-w-0 cursor-pointer truncate bg-transparent py-0.5 pr-6 text-sm font-semibold text-zinc-900 outline-none">
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <h2 className="hidden truncate text-sm font-semibold text-zinc-900 md:block">{title}</h2>
        {children}
      </div>
      <button type="button" aria-pressed={matchmaking} onClick={onMatchmake}
        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${matchmaking ? "border-zinc-300 bg-zinc-100 text-zinc-900" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"}`}>
        {matchmaking ? "Done" : "Matchmake"}
      </button>
    </div>
  );
}

const unique = (fighters: MatchFighter[]) => [...new Map(fighters.map((fighter) => [fighterKey(fighter), fighter])).values()];

type Division = MatchmakingData["top15"][number];

function DivisionPanel({ entry, shown, options, onPick }: { entry: Division; shown: boolean; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  const [matchmaking, setMatchmaking] = useState(false);
  const pool = unique([...entry.fights.flatMap((fight) => [fight.a, fight.b]), ...entry.idle.map((idle) => idle.fighter)])
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return (
    <section className={`${PANEL} @container min-w-0 flex-col overflow-hidden ${shown ? "flex" : "hidden md:flex"}`}>
      <PanelHeader title={entry.division} label="Division" options={options} value={entry.division} onPick={onPick}
        matchmaking={matchmaking} onMatchmake={() => setMatchmaking(!matchmaking)} />
      {matchmaking ? <Matchmaker id={`division:${entry.division}`} pool={pool} /> : (
        <ul className="grid flex-1 auto-rows-fr">
          {entry.fights.map((fight) => (
            <li key={`${fight.a.id}-${fight.b.id}`} className="flex min-w-0 flex-col justify-center gap-1 border-b border-zinc-100 px-3 py-2 last:border-0">
              <div className="flex flex-col gap-1 @min-[420px]:flex-row @min-[420px]:items-center @min-[420px]:gap-2">
                <Side fighter={fight.a} />
                <span className="hidden shrink-0 text-[10px] uppercase text-zinc-400 @min-[420px]:block">vs</span>
                <Side fighter={fight.b} align="responsive" />
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-zinc-500">
                {fight.kind !== "suggested" ? (
                  <span className={`shrink-0 rounded px-1.5 text-[10px] font-semibold ${fight.kind === "title" || fight.reason.startsWith("Title") ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}>
                    {fight.kind === "title" ? "Title" : fight.reason.startsWith("Title") ? "Title · booked" : "Booked"}
                  </span>
                ) : null}
                {fight.event
                  ? <Link to={`/events/${fight.event.id}`} title={`${fight.event.name} · ${formatDate(fight.event.date)}`} className="truncate hover:text-zinc-900">{fight.event.name} · {formatDate(fight.event.date)}</Link>
                  : <span className="truncate" title={fight.reason}>{fight.reason}</span>}
              </div>
            </li>
          ))}
          {entry.idle.map(({ fighter, reason }) => (
            <li key={fighter.id} className="flex flex-col justify-center gap-1 border-b border-zinc-100 px-3 py-2 last:border-0">
              <Side fighter={fighter} />
              <p className="text-[11px] leading-4 text-zinc-500">{reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const OUTCOME = { win: "Won", loss: "Lost", draw: "Drew", nc: "No contest" } as const;

type RecentEvent = MatchmakingData["recent_events"][number];

function EventPanel({ event, shown, options, onPick }: { event: RecentEvent; shown: boolean; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  const [matchmaking, setMatchmaking] = useState(false);
  const pool = unique(event.bouts.flatMap((bout) => bout.sides.map((side) => side.fighter)));
  return (
    <section className={`${PANEL} @container min-w-0 flex-col overflow-hidden ${shown ? "flex" : "hidden md:flex"}`}>
      <PanelHeader title={<Link to={`/events/${event.id}`} className="hover:underline">{event.name}</Link>} label="Card" options={options} value={event.id} onPick={onPick}
        matchmaking={matchmaking} onMatchmake={() => setMatchmaking(!matchmaking)}>
        <p className="text-[11px] text-zinc-500">
          {formatDate(event.date)}<Link to={`/events/${event.id}`} className="hover:text-zinc-900 md:hidden"> · Full card</Link>
        </p>
      </PanelHeader>
      {matchmaking ? <Matchmaker id={`event:${event.id}`} pool={pool} /> : (
        <ul>
          {event.bouts.map((bout) => (
            <li key={bout.fight_id} className="border-b border-zinc-100 px-3 py-3 last:border-0">
              <p className="mb-2 text-[11px] text-zinc-400">
                {bout.division}{bout.title ? " · title fight" : ""}{bout.method ? ` · ${bout.method}` : ""}
              </p>
              <div className="flex flex-col gap-2.5">
                {bout.sides.map((side) => (
                  <div key={side.fighter.id} className="grid grid-cols-1 gap-1.5 @min-[560px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @min-[560px]:items-center @min-[560px]:gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`w-16 shrink-0 text-[11px] font-semibold ${side.outcome === "win" ? "text-emerald-700" : side.outcome === "loss" ? "text-rose-700" : "text-zinc-500"}`}>
                        {side.outcome ? OUTCOME[side.outcome] : "—"}
                      </span>
                      <Side fighter={side.fighter} />
                    </div>
                    <span className="hidden text-zinc-300 @min-[560px]:block" aria-hidden="true">→</span>
                    <div className="min-w-0 pl-[4.5rem] @min-[560px]:pl-0">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 @min-[560px]:hidden">Next</p>
                      {side.next.opponent ? <Side fighter={side.next.opponent} /> : null}
                      <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{side.next.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Suggestions({ tab, data, error, retry }: { tab: Tab; data: MatchmakingData | null; error: unknown; retry: () => void }) {
  const [params, setParams] = useSearchParams();
  if (error && !data) return <RequestNotice onRetry={retry}>Couldn’t load the matchups.</RequestNotice>;
  if (!data) return <PageState>Working out matchups…</PageState>;
  // The division or card a phone shows lives in the address, so Back returns to it.
  const param = tab === "top15" ? "division" : "card";
  const show = (value: string) => { const next = new URLSearchParams(params); next.set(param, value); setParams(next, { replace: true }); };
  const wanted = params.get(param);
  let panels: ReactNode;
  if (tab === "top15") {
    const options = data.top15.map((entry) => ({ value: entry.division, label: entry.division }));
    const shown = options.some((option) => option.value === wanted) ? wanted : options[0]?.value;
    panels = (
      <div className="grid grid-cols-1 gap-2 md:auto-rows-fr md:grid-cols-2 2xl:grid-cols-3">
        {data.top15.map((entry) => <DivisionPanel key={entry.division} entry={entry} shown={entry.division === shown} options={options} onPick={show} />)}
      </div>
    );
  } else {
    const events = data.recent_events ?? [];
    const options = events.map((event) => ({ value: event.id, label: event.name }));
    const shown = options.some((option) => option.value === wanted) ? wanted : options[0]?.value;
    panels = events.length ? (
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {events.map((event) => <EventPanel key={event.id} event={event} shown={event.id === shown} options={options} onPick={show} />)}
      </div>
    ) : <section className={`${PANEL} px-4 py-8 text-center text-sm text-zinc-500`}>No completed card yet.</section>;
  }
  return (
    <>
      {panels}
      <div className="px-1"><Freshness label="Rankings updated" at={data.updated_at} staleAfterHours={24 * 8} /></div>
    </>
  );
}

export default function MatchmakingPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((option) => option.key === params.get("tab")) ? params.get("tab") as Tab : "top15";
  const { data, error, retry } = useApi<MatchmakingData>(tab === "card" ? null : "/api/matchmaking");
  const scroll = useRouteScrollRestoration<HTMLDivElement>("matchmaking", tab === "card" || Boolean(data));
  useSeo({ title: "UFC Matchmaking", description: "Build your own UFC card, and see the fights to make next: title fights, ranked matchups and next opponents for the fighters on recent cards.", path: "/matchmaking" });
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY.replace("max-w-5xl", "max-w-[1600px]")}>
        {/* On a phone the tabs are the bar across the top of the page. */}
        <header className="-mx-2 -mt-2 flex justify-center border-b border-zinc-200 bg-white px-2 py-1.5 sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
          <h1 className="sr-only">Matchmaking</h1>
          <div className={`${segmentedGroup} w-full max-w-md`} role="group" aria-label="Matchmaking">
            {TABS.map((option) => (
              <button key={option.key} type="button" aria-pressed={tab === option.key}
                onClick={() => setParams(option.key === "top15" ? {} : { tab: option.key }, { replace: true })}
                className={`${segmentedTab.replace("flex-auto", "flex-1")} ${tab === option.key ? segmentedSelected : segmentedIdle}`}>
                {option.label}
              </button>
            ))}
          </div>
        </header>
        {tab === "card" ? <CardBuilder /> : <Suggestions tab={tab} data={data} error={error} retry={retry} />}
      </div>
    </div>
  );
}

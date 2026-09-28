import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useApi, type MatchFighter, type MatchmakingData } from "../api";
import { formatDate } from "../format";
import { PAGE, PAGE_BODY } from "../research";
import { useSeo } from "../seo";
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
        <div className="relative">
          <Link to={`/fighters/${fighter.id}`} title={fighter.name} className="rounded-full focus-visible:outline-2 focus-visible:outline-zinc-900">
            <Avatar src={fighter.photo_url} name={fighter.name} size={big ? "lg" : "md"} />
          </Link>
          <button type="button" onClick={onClear} aria-label={`Remove ${fighter.name}`}
            className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:text-zinc-900">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={onPick} aria-label="Add a fighter"
          className={`grid shrink-0 place-items-center rounded-full border border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 transition hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${big ? "h-20 w-20" : "h-12 w-12"}`}>
          <Plus className={big ? "h-6 w-6" : "h-5 w-5"} aria-hidden="true" />
        </button>
      )}
      <span className={`w-full text-center text-xs leading-4 ${fighter ? "font-semibold text-zinc-900" : "text-zinc-500"}`}>
        {fighter?.name ?? "Add fighter"}
      </span>
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
              <div className={`grid gap-3 ${big ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-4"}`}>
                {Array.from({ length: row.bouts }, (_, i) => {
                  const index = first + i;
                  return (
                    <div key={index} className="min-w-0">
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
  if (Math.abs(streak) < 2) return null;
  return (
    <span className={`rounded px-1 text-[10px] font-semibold tabular-nums ${streak > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
      title={`${Math.abs(streak)} straight ${streak > 0 ? "wins" : "losses"}`}>
      {streak > 0 ? "W" : "L"}{Math.abs(streak)}
    </span>
  );
}

/** A fighter in a suggested bout: photo, rank, name, record and run. */
function Side({ fighter, align = "left" }: { fighter: MatchFighter; align?: "left" | "right" }) {
  const rank = rankLabel(fighter.rank);
  const right = align === "right";
  const body = (
    <>
      <Avatar src={fighter.photo_url} name={fighter.name} size="sm" />
      <span className={`min-w-0 ${right ? "text-right" : ""}`}>
        <span className={`flex min-w-0 items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
          {rank ? <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-400">{rank}</span> : null}
          <span className="truncate text-[13px] font-medium text-zinc-900">{fighter.name}</span>
        </span>
        <span className={`flex items-center gap-1 text-[11px] tabular-nums text-zinc-500 ${right ? "flex-row-reverse" : ""}`}>
          {fighter.record}<Streak streak={fighter.streak} />
        </span>
      </span>
    </>
  );
  const className = `flex min-w-0 flex-1 items-center gap-2 ${right ? "flex-row-reverse" : ""}`;
  return fighter.id ? <Link to={`/fighters/${fighter.id}`} className={`${className} rounded-lg hover:opacity-80`}>{body}</Link> : <span className={className}>{body}</span>;
}

const KIND = {
  title: { label: "Title fight", tone: "bg-amber-50 text-amber-800" },
  booked: { label: "Booked", tone: "bg-zinc-100 text-zinc-600" },
  suggested: { label: "Suggested", tone: "bg-sky-50 text-sky-700" },
} as const;

function Top15({ data }: { data: MatchmakingData }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {data.top15.map((entry) => (
        <section key={entry.division} className={`${PANEL} min-w-0 overflow-hidden`}>
          <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900">{entry.division}</h2>
          <ul>
            {entry.fights.map((fight) => (
              <li key={`${fight.a.id}-${fight.b.id}`} className="border-b border-zinc-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Side fighter={fight.a} />
                  <span className="shrink-0 text-[10px] font-bold uppercase text-zinc-400">vs</span>
                  <Side fighter={fight.b} align="right" />
                </div>
                <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] leading-4 text-zinc-500">
                  <span className={`rounded-full px-2 py-px text-[10px] font-semibold ${KIND[fight.kind].tone}`}>
                    {fight.kind === "booked" && fight.reason.startsWith("Title") ? "Title fight · booked" : KIND[fight.kind].label}
                  </span>
                  {fight.event
                    ? <Link to={`/events/${fight.event.id}`} className="hover:text-zinc-900">{fight.event.name} · {formatDate(fight.event.date)}</Link>
                    : <span>{fight.reason}</span>}
                </p>
              </li>
            ))}
            {entry.idle.length ? (
              <li className="px-4 py-3">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Not matched</h3>
                <ul className="flex flex-col gap-1">
                  {entry.idle.map(({ fighter, reason }) => (
                    <li key={fighter.id} className="flex items-baseline gap-2 text-[12px]">
                      <span className="shrink-0 tabular-nums text-zinc-400">{rankLabel(fighter.rank)}</span>
                      <Link to={`/fighters/${fighter.id}`} className="font-medium text-zinc-800 hover:text-zinc-950">{fighter.name}</Link>
                      <span className="text-zinc-500">{reason}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}

const OUTCOME = { win: "Won", loss: "Lost", draw: "Drew", nc: "No contest" } as const;

function LastCard({ event }: { event: MatchmakingData["recent_events"][number] }) {
  return (
    <section className={`${PANEL} min-w-0 overflow-hidden`}>
      <div className="border-b border-zinc-100 px-4 py-3">
        <h2><Link to={`/events/${event.id}`} className="text-sm font-semibold text-zinc-900 hover:underline">{event.name}</Link></h2>
        <p className="text-[12px] text-zinc-500">{formatDate(event.date)}</p>
      </div>
      <ul>
        {event.bouts.map((bout) => (
          <li key={bout.fight_id} className="border-b border-zinc-100 px-4 py-3">
            <p className="mb-2 text-[11px] text-zinc-400">
              {bout.division}{bout.title ? " · title fight" : ""}{bout.method ? ` · ${bout.method}` : ""}
            </p>
            <div className="flex flex-col gap-2.5">
              {bout.sides.map((side) => (
                <div key={side.fighter.id} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`w-16 shrink-0 text-[11px] font-semibold ${side.outcome === "win" ? "text-emerald-700" : side.outcome === "loss" ? "text-rose-700" : "text-zinc-500"}`}>
                      {side.outcome ? OUTCOME[side.outcome] : "—"}
                    </span>
                    <Side fighter={side.fighter} />
                  </div>
                  <span className="hidden text-zinc-300 sm:block" aria-hidden="true">→</span>
                  <div className="min-w-0 pl-[4.5rem] sm:pl-0">
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 sm:hidden">Next</p>
                    {side.next.opponent ? <Side fighter={side.next.opponent} /> : null}
                    <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{side.next.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Suggestions({ tab }: { tab: Tab }) {
  const { data, error, retry } = useApi<MatchmakingData>("/api/matchmaking");
  if (error && !data) return <RequestNotice onRetry={retry}>Couldn’t load the matchups.</RequestNotice>;
  if (!data) return <PageState>Working out matchups…</PageState>;
  return (
    <>
      {tab === "top15" ? <Top15 data={data} /> : (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {data.recent_events?.length ? data.recent_events.map((event) => <LastCard key={event.id} event={event} />) : (
            <section className={`${PANEL} px-4 py-8 text-center text-sm text-zinc-500`}>No completed card yet.</section>
          )}
        </div>
      )}
      <div className="px-1"><Freshness label="Rankings updated" at={data.updated_at} staleAfterHours={24 * 8} /></div>
    </>
  );
}

export default function MatchmakingPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((option) => option.key === params.get("tab")) ? params.get("tab") as Tab : "top15";
  useSeo({ title: "UFC Matchmaking", description: "Build your own UFC card, and see the fights to make next: title fights, ranked matchups and next opponents for the fighters on recent cards.", path: "/matchmaking" });
  return (
    <div className={PAGE}>
      <div className={PAGE_BODY.replace("max-w-5xl", "max-w-[1600px]")}>
        <header className="flex justify-center">
          <h1 className="sr-only">Matchmaking</h1>
          <div className={`${segmentedGroup} w-full max-w-md`} role="group" aria-label="Matchmaking">
            {TABS.map((option) => (
              <button key={option.key} type="button" aria-pressed={tab === option.key}
                onClick={() => setParams(option.key === "top15" ? {} : { tab: option.key }, { replace: true })}
                className={`${segmentedTab} ${tab === option.key ? segmentedSelected : segmentedIdle}`}>
                {option.label}
              </button>
            ))}
          </div>
        </header>
        {tab === "card" ? <CardBuilder /> : <Suggestions tab={tab} />}
      </div>
    </div>
  );
}

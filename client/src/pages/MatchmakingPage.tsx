import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useApi, type MatchFighter, type MatchmakingData } from "../api";
import { formatDate, lastName } from "../format";
import { PAGE, PAGE_BODY } from "../research";
import { useSeo } from "../seo";
import Avatar from "../components/Avatar";
import FighterSearch, { type PickedFighter } from "../components/FighterSearch";
import Freshness from "../components/Freshness";
import RequestNotice from "../components/RequestNotice";
import { PageState } from "../components/ResearchKit";
import { PANEL } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

const TABS = [
  { key: "card", label: "Create a card" },
  { key: "top15", label: "Top 15" },
  { key: "last", label: "After the last card" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// ---------------------------------------------------------------------------
// Create a card

/** The poster's rows: two big bouts, four, the prelims, four, and three. */
const ROWS = [{ bouts: 2, big: true }, { bouts: 4 }, { bouts: 4, prelims: true }, { bouts: 3 }] as const;
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
  if (!fighter) {
    return (
      <button type="button" onClick={onPick} aria-label="Add a fighter"
        className={`grid shrink-0 place-items-center rounded-full border border-dashed border-zinc-300 text-zinc-400 transition hover:border-zinc-400 hover:bg-white hover:text-zinc-700 ${big ? "h-28 w-28" : "h-12 w-12"}`}>
        <Plus className={big ? "h-6 w-6" : "h-4 w-4"} aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className="relative flex min-w-0 flex-col items-center gap-1">
      <Link to={`/fighters/${fighter.id}`} title={fighter.name} className="rounded-full focus-visible:outline-2 focus-visible:outline-zinc-900">
        <Avatar src={fighter.photo_url} name={fighter.name} size={big ? "xl" : "md"} />
      </Link>
      <button type="button" onClick={onClear} aria-label={`Remove ${fighter.name}`}
        className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm transition hover:text-zinc-900">
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

function Bout({ corners, big, onPick, onClear }: { corners: [Slot, Slot]; big: boolean; onPick: (corner: 0 | 1) => void; onClear: (corner: 0 | 1) => void }) {
  const names = corners.map((fighter) => (fighter ? lastName(fighter.name) : "TBA"));
  return (
    <div className={`flex min-w-0 flex-col items-center gap-2 rounded-2xl border border-zinc-100 bg-zinc-50 ${big ? "p-4" : "p-3"}`}>
      <div className="flex w-full items-center justify-center gap-2">
        <div className="flex min-w-0 flex-1 justify-end"><Corner fighter={corners[0]} big={big} onPick={() => onPick(0)} onClear={() => onClear(0)} /></div>
        <span className="shrink-0 text-[10px] font-bold uppercase text-zinc-400">vs</span>
        <div className="flex min-w-0 flex-1 justify-start"><Corner fighter={corners[1]} big={big} onPick={() => onPick(1)} onClear={() => onClear(1)} /></div>
      </div>
      <p className={`max-w-full truncate text-center font-bold uppercase tracking-wide text-zinc-900 ${big ? "text-sm sm:text-base" : "text-[11px]"}`}>
        {names[0]} <span className="font-medium text-zinc-400">vs</span> {names[1]}
      </p>
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
    <section className={`${PANEL} p-3 sm:p-4`}>
      <div className="mb-3 flex items-center justify-between gap-3">
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
                <div className="rounded-lg bg-zinc-900 py-1.5 text-center text-xs font-bold uppercase tracking-[0.2em] text-white">Prelims</div>
              ) : null}
              {rowIndex === 0 ? <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-400">Main card</p> : null}
              {/* Rows of four fill the width; a row of three sits centred under them. */}
              <div className="flex flex-wrap justify-center gap-3">
                {Array.from({ length: row.bouts }, (_, i) => {
                  const index = first + i;
                  return (
                    <div key={index} className={big ? "w-full sm:w-[calc(50%-0.375rem)]" : "w-[calc(50%-0.375rem)] lg:w-[calc(25%-0.5625rem)]"}>
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
  suggested: { label: "Suggested", tone: "bg-sky-50 text-sky-800" },
} as const;

function Top15({ data }: { data: MatchmakingData }) {
  const [params, setParams] = useSearchParams();
  const divisions = data.top15.map((entry) => entry.division);
  const division = divisions.includes(params.get("division") ?? "") ? params.get("division")! : divisions[0];
  const entry = data.top15.find((item) => item.division === division);
  const pick = (next: string) => setParams((current) => { const copy = new URLSearchParams(current); copy.set("division", next); return copy; }, { replace: true });
  return (
    <section className={`${PANEL} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <p className="text-[12px] text-zinc-500">From the official rankings: the title fight, then the ranked fights worth making next.</p>
        <select aria-label="Division" value={division} onChange={(event) => pick(event.target.value)}
          className="h-8 rounded-full border border-zinc-200 bg-zinc-50 pl-3 pr-7 text-xs font-medium text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400">
          {divisions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      {entry ? (
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
      ) : null}
    </section>
  );
}

const OUTCOME = { win: "Won", loss: "Lost", draw: "Drew", nc: "No contest" } as const;

function LastCard({ data }: { data: MatchmakingData }) {
  const event = data.last_event;
  if (!event) return <section className={`${PANEL} px-4 py-8 text-center text-sm text-zinc-500`}>No completed card yet.</section>;
  return (
    <section className={`${PANEL} overflow-hidden`}>
      <div className="border-b border-zinc-100 px-4 py-3">
        <Link to={`/events/${event.id}`} className="text-sm font-semibold text-zinc-900 hover:underline">{event.name}</Link>
        <p className="text-[12px] text-zinc-500">{formatDate(event.date)} · a next opponent for everyone on the card, winners with winners and losers with losers of similar standing.</p>
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
      {tab === "top15" ? <Top15 data={data} /> : <LastCard data={data} />}
      <div className="px-1"><Freshness label="Rankings updated" at={data.updated_at} staleAfterHours={24 * 8} /></div>
    </>
  );
}

export default function MatchmakingPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((option) => option.key === params.get("tab")) ? params.get("tab") as Tab : "card";
  useSeo({ title: "UFC Matchmaking", description: "Build your own UFC card, and see the fights to make next: title fights, ranked matchups and next opponents for everyone on the last card.", path: "/matchmaking" });
  return (
    <div className={PAGE}>
      <div className={`${PAGE_BODY} xl:max-w-6xl`}>
        <header className={`${PANEL} flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5`}>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">Matchmaking</h1>
          <div className={`${segmentedGroup} max-w-full overflow-x-auto`} role="group" aria-label="Matchmaking">
            {TABS.map((option) => (
              <button key={option.key} type="button" aria-pressed={tab === option.key}
                onClick={() => setParams(option.key === "card" ? {} : { tab: option.key }, { replace: true })}
                className={`${segmentedOption} ${tab === option.key ? segmentedSelected : segmentedIdle}`}>
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

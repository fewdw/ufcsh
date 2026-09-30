import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@clerk/react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Plus, Save, Trash2, X } from "lucide-react";
import { useApi, type MatchFighter, type MatchmakingData } from "../api";
import { accountsEnabled, useAccount } from "../auth";
import { formatDate } from "../format";
import { PAGE, FULL_PAGE_BODY } from "../research";
import { useSeo } from "../seo";
import { useRouteScrollRestoration } from "../navigationState";
import PageToolbar, { FilterSelect } from "../components/PageToolbar";
import OptionsSheet, { SwitchRow } from "../components/OptionsSheet";
import Avatar from "../components/Avatar";
import FighterSearch, { type PickedFighter } from "../components/FighterSearch";
import Freshness from "../components/Freshness";
import RequestNotice from "../components/RequestNotice";
import { PageState } from "../components/ResearchKit";
import { PANEL } from "../components/chartTokens";
import { ConfirmRemove } from "../components/ConfirmRemove";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../ui";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

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
/** Which saved card the one being built came from, so saving updates it. */
const OPEN_KEY = "ufcsh:matchmaking-open:v1";

type Slot = PickedFighter | null;
/** A fighter no longer on record comes back as an empty corner. */
type SavedCard = { id: string; name: string; updatedAt: number; slots: Slot[] };
/** Saved cards live with the account, so they follow the reader to every device. */
type CardAccount = {
  signedIn: boolean; cards: SavedCard[]; signIn: () => void;
  save: (name: string, slots: PickedFighter[], id?: string) => Promise<SavedCard>;
  remove: (id: string) => Promise<void>;
};

const emptyCard = (): Slot[] => Array(BOUTS * 2).fill(null);
const isCard = (value: unknown): value is Slot[] => Array.isArray(value) && value.length === BOUTS * 2;
const isFull = (slots: Slot[]): slots is PickedFighter[] => slots.every(Boolean);
const sameCard = (a: Slot[], b: Slot[]) => a.every((slot, i) => slot?.id === b[i]?.id);
const lastName = (fighter: Slot) => fighter?.name.split(" ").at(-1) ?? "TBD";
const headline = (card: SavedCard) => `${lastName(card.slots[0])} vs ${lastName(card.slots[1])}`;

function stored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null; // Unreadable starts empty.
  }
}

function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: it lasts the visit */ }
}

function draftCard(): Slot[] {
  const draft = stored(CARD_KEY);
  return isCard(draft) ? draft : emptyCard();
}

function Corner({ fighter, big, onPick, onClear }: { fighter: Slot; big: boolean; onPick: () => void; onClear: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      {/* The photo grows with its corner up to a modest cap. */}
      <div className={`relative aspect-square w-4/5 ${big ? "max-w-28" : "max-w-20"}`}>
        {fighter ? (
          <button type="button" onClick={onClear} aria-label={`Remove ${fighter.name}`} title="Remove"
            className="group block h-full w-full rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
            <Avatar src={fighter.photo_url} name={fighter.name} size="fill" />
            {/* Shown on hover only: a tap anywhere on the photo removes the fighter. */}
            <span aria-hidden="true" className={`absolute right-[4%] top-[4%] grid place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 opacity-0 shadow-sm transition group-hover:opacity-100 group-hover:text-zinc-900 group-focus-visible:opacity-100 ${big ? "h-7 w-7" : "h-6 w-6"}`}>
              <X className={big ? "h-3.5 w-3.5" : "h-3 w-3"} />
            </span>
          </button>
        ) : (
          <button type="button" onClick={onPick} aria-label="Add a fighter"
            className="grid h-full w-full place-items-center rounded-full border border-dashed border-zinc-300 text-zinc-400 transition hover:border-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
            <Plus className={big ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
          </button>
        )}
      </div>
      {fighter ? (
        <Link to={`/fighters/${fighter.id}`} className={`w-full text-center font-semibold text-zinc-900 hover:underline ${big ? "text-sm sm:text-base" : "text-xs leading-4 sm:text-sm"}`}>{fighter.name}</Link>
      ) : <span className={`w-full text-center text-zinc-400 ${big ? "text-sm" : "text-xs leading-4"}`}>Add fighter</span>}
    </div>
  );
}

function Bout({ corners, big, onPick, onClear }: { corners: [Slot, Slot]; big: boolean; onPick: (corner: 0 | 1) => void; onClear: (corner: 0 | 1) => void }) {
  return (
    <div className={`flex h-full min-w-0 items-start gap-2 rounded-xl border border-zinc-200 bg-white ${big ? "p-4 sm:p-5" : "px-3 py-4"}`}>
      <Corner fighter={corners[0]} big={big} onPick={() => onPick(0)} onClear={() => onClear(0)} />
      {/* Level with the photos rather than the names below them. */}
      <span className="-mt-6 shrink-0 self-center text-[10px] font-medium uppercase text-zinc-400 sm:text-xs">vs</span>
      <Corner fighter={corners[1]} big={big} onPick={() => onPick(1)} onClear={() => onClear(1)} />
    </div>
  );
}

/** A small dialog: a title, a close ✕ and what it holds. Escape or a click
 *  outside closes it; its first field takes the focus. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector("input")?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-zinc-950/40 p-3 pt-[15vh] backdrop-blur-[2px]" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={`${PANEL} w-full max-w-md p-3`} onClick={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The site's fighter search; the chosen fighter fills the slot. */
function Picker({ taken, onPick, onClose }: { taken: PickedFighter[]; onPick: (fighter: PickedFighter) => void; onClose: () => void }) {
  return (
    <Dialog title="Pick a fighter" onClose={onClose}>
      {/* Everyone already on the card is "selected", so the search leaves them out. */}
      <FighterSearch selected={taken} showSelected={false} max={BOUTS * 2} emptyPlaceholder="Search any fighter…"
        onChange={(fighters) => { const chosen = fighters.at(-1); if (chosen && !taken.includes(chosen)) onPick(chosen); }} />
    </Dialog>
  );
}

function SaveDialog({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = name.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    // On success the dialog closes; only a failure is shown here.
    try { await onSave(trimmed); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "That card could not be saved."); setBusy(false); }
  };
  return (
    <Dialog title="Save card" onClose={onClose}>
      <form className="flex gap-2 px-1 pb-1" onSubmit={(event) => void submit(event)}>
        {/* 16px on a phone, so iOS doesn't zoom in on focus. */}
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Name this card" aria-label="Card name"
          className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-base text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 sm:text-sm" />
        <button type="submit" disabled={!trimmed || busy} className={BUTTON_PRIMARY}>{busy ? "Saving…" : "Save"}</button>
      </form>
      {error ? <p role="alert" className="px-1 pt-1 text-xs text-rose-600">{error}</p> : null}
    </Dialog>
  );
}

/** Saved cards: a list beside the card from `lg` up, a dropdown above it
 *  below that. Not drawn at all until a card has been saved. */
function SavedCards({ cards, open, draft, onOpen, onNew, onRemove }: {
  cards: SavedCard[]; open: SavedCard | null; draft: boolean;
  onOpen: (card: SavedCard) => void; onNew: () => void; onRemove: (card: SavedCard) => void;
}) {
  return <>
    <div className="flex items-center gap-2 lg:hidden">
      <select value={open?.id ?? ""} aria-label="Saved cards"
        onChange={(event) => { const card = cards.find((each) => each.id === event.target.value); if (card) onOpen(card); else onNew(); }}
        className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-base font-medium text-zinc-900 outline-none transition focus:border-zinc-400 sm:text-sm">
        <option value="">{draft && !open ? "Unsaved card" : "New card"}</option>
        {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
      </select>
      {open ? (
        <button type="button" onClick={() => onRemove(open)} aria-label={`Delete ${open.name}`} title="Delete card"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
    {/* Each saved card is a tile like the bouts beside it; the open one is outlined. */}
    <aside aria-label="Saved cards" className="sticky top-0 hidden max-h-[calc(100dvh-7rem)] w-64 shrink-0 overflow-y-auto lg:block">
      <h2 className="flex min-h-10 items-center justify-between px-1 pb-2 text-sm font-semibold text-zinc-900">
        Saved cards<span className="text-xs font-normal tabular-nums text-zinc-500">{cards.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {cards.map((card) => {
          const current = card.id === open?.id;
          return (
            <li key={card.id} className="group relative">
              <button type="button" onClick={() => onOpen(card)} aria-current={current ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl border bg-white p-2.5 pr-8 text-left transition-colors ${current ? "border-zinc-400 ring-1 ring-inset ring-zinc-200" : "border-zinc-200 hover:border-zinc-300"}`}>
                {/* The main event's two faces, overlapping. */}
                <span className="flex shrink-0 -space-x-2.5">
                  {card.slots.slice(0, 2).map((fighter, index) => <Avatar key={index} src={fighter?.photo_url} name={fighter?.name ?? "TBD"} size="sm" />)}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-semibold leading-tight text-zinc-900">{card.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">{headline(card)}</span>
                </span>
              </button>
              {/* Always there on a touch screen, where nothing hovers. */}
              <button type="button" onClick={() => onRemove(card)} aria-label={`Delete ${card.name}`} title="Delete card"
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  </>;
}

/** The last list read for an account, shown at once on the next visit while
 *  it is read again, so a reload never flashes an empty sidebar. */
const CARDS_CACHE_KEY = "ufcsh:matchmaking-saved-cache:v1";
function cachedCards(userId: string | null): SavedCard[] {
  const cache = stored(CARDS_CACHE_KEY) as { userId?: unknown; cards?: unknown } | null;
  return cache && cache.userId === userId && Array.isArray(cache.cards) ? cache.cards as SavedCard[] : [];
}

/** The account's saved cards, read again whenever the tab comes back into
 *  view so a card saved on another device shows up. Mounted only where
 *  sign-in exists, since Clerk's hooks need it. */
function AccountCardBuilder({ navigation }: { navigation: ReactNode }) {
  const { getToken } = useAuth();
  const { isLoaded, user, signIn } = useAccount();
  const userId = user?.id ?? null;
  // Before Clerk has loaded, the last account's list stands in.
  const [cards, setCards] = useState<SavedCard[]>(() => { const cache = stored(CARDS_CACHE_KEY) as { cards?: unknown } | null; return Array.isArray(cache?.cards) ? cache.cards as SavedCard[] : []; });
  // Every change to the list is also kept for the next visit.
  const update = useCallback((change: (current: SavedCard[]) => SavedCard[]) => setCards((current) => {
    const next = change(current);
    store(CARDS_CACHE_KEY, { userId, cards: next });
    return next;
  }), [userId]);
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    const response = await fetch(path, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please retry.");
    return data;
  }, [getToken]);
  useEffect(() => {
    if (!isLoaded) return;
    setCards(cachedCards(userId));
    if (!userId) return;
    let live = true;
    let retry: number | undefined;
    // A session still starting up can briefly have no token: try again shortly.
    const load = (attempt = 0) => {
      request("/api/cards")
        .then((data: { cards: SavedCard[] }) => { if (live) update(() => data.cards); })
        .catch(() => { if (live && attempt < 3) retry = window.setTimeout(() => load(attempt + 1), 1_000 * 2 ** attempt); });
    };
    const visible = () => { if (document.visibilityState === "visible") load(); };
    load();
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; window.clearTimeout(retry); document.removeEventListener("visibilitychange", visible); };
  }, [isLoaded, userId, request, update]);
  const save = async (name: string, slots: PickedFighter[], id?: string) => {
    const card = await request("/api/cards", { method: "POST", body: JSON.stringify({ id, name, fighters: slots.map((slot) => slot.id) }) }) as SavedCard;
    update((current) => [card, ...current.filter((each) => each.id !== card.id)]);
    return card;
  };
  const remove = async (id: string) => {
    await request(`/api/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
    update((current) => current.filter((each) => each.id !== id));
  };
  return <CardBuilder navigation={navigation} account={{ signedIn: isLoaded && Boolean(user), cards, signIn, save, remove }} />;
}

/** `account` is null where this deployment has no sign-in: the card is built
 *  but not saved. */
function CardBuilder({ account, navigation }: { account: CardAccount | null; navigation: ReactNode }) {
  const [section, setSection] = useState("all");
  const [filled, setFilled] = useState("all");
  const [slots, setSlots] = useState<Slot[]>(draftCard);
  const [openId, setOpenId] = useState<string | null>(() => { const id = stored(OPEN_KEY); return typeof id === "string" ? id : null; });
  const [picking, setPicking] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<SavedCard | null>(null);
  const [removal, setRemoval] = useState({ busy: false, error: "" });
  useEffect(() => store(CARD_KEY, slots), [slots]);
  useEffect(() => store(OPEN_KEY, openId), [openId]);
  const cards = account?.cards ?? [];
  const set = (index: number, fighter: Slot) => setSlots((current) => current.map((slot, i) => (i === index ? fighter : slot)));
  const taken = slots.filter((slot): slot is PickedFighter => Boolean(slot));
  // Saving an opened card updates it; anything else is saved as a new one.
  const open = cards.find((card) => card.id === openId) ?? null;
  const saved = open !== null && sameCard(open.slots, slots);
  const startNew = () => { setSlots(emptyCard()); setOpenId(null); };
  const openCard = (card: SavedCard) => { setSlots(card.slots); setOpenId(card.id); };
  const save = async (name: string) => {
    if (!account || !isFull(slots)) return;
    const card = await account.save(name, slots, open?.id);
    setOpenId(card.id);
    setSaving(false);
  };
  const remove = async (card: SavedCard) => {
    if (!account || removal.busy) return;
    setRemoval({ busy: true, error: "" });
    try {
      await account.remove(card.id);
      if (card.id === openId) setOpenId(null);
      setRemoving(null);
      setRemoval({ busy: false, error: "" });
    } catch (problem) {
      setRemoval({ busy: false, error: problem instanceof Error ? problem.message : "That card could not be deleted." });
    }
  };
  const visibleBout = (index: number) => {
    const complete = Boolean(slots[index * 2] && slots[index * 2 + 1]);
    return (section === "all" || (section === "prelims") === (index >= 6)) && (filled === "all" || (filled === "complete" ? complete : !complete));
  };
  let bout = 0;
  return (
    <>
      <PageToolbar>
        {navigation}
        <div className="min-w-0 flex-1 basis-32">
          {/* Below `lg` the saved-cards dropdown already names it. */}
          <h2 className={`truncate text-base font-semibold text-zinc-900 ${cards.length ? "max-lg:hidden" : ""}`}>{open?.name ?? "New card"}</h2>
        </div>
        {taken.length || open ? (
          <button type="button" onClick={startNew} className={BUTTON_SECONDARY}>{open ? "New card" : "Clear card"}</button>
        ) : null}
        {account && isFull(slots) ? (
          <button type="button" onClick={() => (account.signedIn ? setSaving(true) : account.signIn())} disabled={saved}
            title={account.signedIn ? undefined : "Sign in to save cards to your account"} className={`${BUTTON_PRIMARY} !py-1.5`}>
            {saved ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
            {saved ? "Saved" : "Save card"}
          </button>
        ) : null}
        <OptionsSheet label="Filters" count={Number(section !== "all") + Number(filled !== "all") || undefined} onReset={() => { setSection("all"); setFilled("all"); }}>
          <div className="space-y-3 p-4">
            <FilterSelect label="Card section" value={section} onChange={setSection} options={[{ value: "all", label: "Full card" }, { value: "main", label: "Main card" }, { value: "prelims", label: "Prelims" }]} />
            <FilterSelect label="Bouts" value={filled} onChange={setFilled} options={[{ value: "all", label: "All bouts" }, { value: "complete", label: "Both fighters picked" }, { value: "open", label: "Open slots" }]} />
          </div>
        </OptionsSheet>
      </PageToolbar>
      <section className="flex w-full flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
        {cards.length ? <SavedCards cards={cards} open={open} draft={taken.length > 0} onOpen={openCard} onNew={startNew} onRemove={setRemoving} /> : null}
        <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-3">
          {!Array.from({ length: BOUTS }, (_, index) => index).some(visibleBout) ? <p className="py-8 text-center text-sm text-zinc-500">No bouts match these filters.</p> : null}
          {ROWS.map((row, rowIndex) => {
            const first = bout;
            bout += row.bouts;
            const big = "big" in row && row.big;
            const indices = Array.from({ length: row.bouts }, (_, i) => first + i).filter(visibleBout);
            if (!indices.length) return null;
            return (
              <div key={rowIndex} className="flex flex-col gap-3">
                {"prelims" in row && row.prelims ? (
                  <h2 className="mt-3 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Prelims</h2>
                ) : null}
                {(rowIndex === 0 || rowIndex === 1 && ![0, 1].some(visibleBout)) ? <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Main card</h2> : null}
                {/* A wrapping row rather than a grid, so an odd bout left over sits centered. */}
                <div className="flex flex-wrap justify-center gap-3">
                  {indices.map((index) => {
                    return (
                      <div key={index} className={`min-w-0 basis-full ${big ? "sm:basis-[calc(50%-0.375rem)]" : "min-[400px]:basis-[calc(50%-0.375rem)] xl:basis-[calc(25%-0.5625rem)]"}`}>
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
      </div>
      {picking != null ? (
        <Picker taken={taken} onClose={() => setPicking(null)} onPick={(fighter) => { set(picking, fighter); setPicking(null); }} />
      ) : null}
      {saving ? <SaveDialog initial={open?.name ?? ""} onSave={save} onClose={() => setSaving(false)} /> : null}
      {removing ? (
        <ConfirmRemove title="Delete this saved card?" detail={removing.name} busy={removal.busy} error={removal.error}
          onCancel={() => { setRemoving(null); setRemoval({ busy: false, error: "" }); }} onConfirm={() => void remove(removing)} />
      ) : null}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Suggestions

// Set like the Rankings page: a panel per division or card, rows of rank,
// photo, name and a small line under it. A title fight, booked or not, is
// yellow and any other booked fight blue, as a booked fighter is there.

const rankLabel = (rank: number | null) => (rank === 0 ? "C" : rank == null ? "" : String(rank));
const BOOKED = { title: "activity-booked", fight: "activity-recent" } as const;
const tint = (kind: string, title: boolean) => (title ? BOOKED.title : kind === "booked" ? BOOKED.fight : "");
const TAG = "shrink-0 rounded-full px-1.5 text-[10px] font-semibold ring-1 ring-inset";

function Streak({ streak }: { streak: number }) {
  if (!streak) return null;
  return (
    <span className={`font-bold ${streak > 0 ? "text-emerald-600" : "text-rose-500"}`}
      title={`${Math.abs(streak)} straight ${streak > 0 ? "wins" : "losses"}`}>
      {Math.abs(streak)}{streak > 0 ? "W" : "L"}
    </span>
  );
}

/** A fighter as a ranking row has them: rank, photo, name, and their record
 *  and run under it. `responsive` mirrors them once the row is wide;
 *  `compact` narrows the rank for the recent cards' two fighters a row. */
function Side({ fighter, align = "left", compact = false }: { fighter: MatchFighter; align?: "left" | "responsive"; compact?: boolean }) {
  const rank = rankLabel(fighter.rank);
  const flip = align === "responsive" ? "@min-[420px]:flex-row-reverse" : "";
  const className = `flex min-w-0 flex-1 items-center ${compact ? "gap-1.5" : "gap-2"} ${flip}`;
  const body = (
    <>
      <span className={`flex h-5 ${compact ? "w-5" : "w-7"} shrink-0 items-center justify-center text-[12px] tabular-nums ${rank === "C" ? "font-bold text-amber-500" : "font-semibold text-zinc-800"}`}
        title={rank === "C" ? "Champion" : undefined}>{rank}</span>
      <Avatar src={fighter.photo_url} name={fighter.name} size="xs" />
      <span className={`min-w-0 ${align === "responsive" ? "@min-[420px]:text-right" : ""}`}>
        <span className="block truncate text-[13px] font-medium leading-4 text-zinc-900">{fighter.name}</span>
        <span className={`flex gap-1.5 text-[10px] leading-3.5 tabular-nums text-zinc-400 ${align === "responsive" ? "@min-[420px]:justify-end" : ""}`}>
          {fighter.record}<Streak streak={fighter.streak} />
        </span>
      </span>
    </>
  );
  return fighter.id ? <Link to={`/fighters/${fighter.id}`} title={fighter.name} className={`${className} hover:opacity-80`}>{body}</Link> : <span className={className}>{body}</span>;
}

/** Under a row, lined up with the first name. */
const NOTE = "mt-0.5 flex min-w-0 items-center gap-1.5 pl-[4.5rem] text-[10px] leading-3.5 text-zinc-500";

function Panel({ title, chip, children }: { title: ReactNode; chip?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${PANEL} @container min-w-0 overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3.5 py-2.5">
        <h2 className="truncate text-sm font-semibold text-zinc-900">{title}</h2>
        {chip ? <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">{chip}</span> : null}
      </div>
      <ul className="divide-y divide-zinc-50">{children}</ul>
    </section>
  );
}

type Division = MatchmakingData["top15"][number];

function DivisionPanel({ entry }: { entry: Division }) {
  return (
    <Panel title={entry.division}>
      {entry.fights.map((fight) => (
        <li key={`${fight.a.id}-${fight.b.id}`} className={`px-2.5 py-1.5 ${tint(fight.kind, fight.title)}`}>
          <div className="flex flex-col gap-1 @min-[420px]:flex-row @min-[420px]:items-center @min-[420px]:gap-2">
            <Side fighter={fight.a} />
            <span className="hidden shrink-0 text-[10px] uppercase text-zinc-400 @min-[420px]:block">vs</span>
            <Side fighter={fight.b} align="responsive" />
          </div>
          <p className={NOTE}>
            {fight.event
              ? <Link to={`/events/${fight.event.id}`} title={`${fight.event.name} · ${formatDate(fight.event.date)}`} className="truncate hover:text-zinc-900">{fight.event.name} · {formatDate(fight.event.date)}</Link>
              : <span className="truncate" title={fight.reason}>{fight.reason}</span>}
          </p>
        </li>
      ))}
      {entry.idle.map(({ fighter, reason }) => (
        <li key={fighter.id} className="px-2.5 py-1.5">
          <Side fighter={fighter} />
          <p className={NOTE}>{reason}</p>
        </li>
      ))}
    </Panel>
  );
}

const OUTCOME = {
  win: ["W", "Won", "bg-emerald-50 text-emerald-700"],
  loss: ["L", "Lost", "bg-rose-50 text-rose-700"],
  draw: ["D", "Drew", "bg-zinc-100 text-zinc-600"],
  nc: ["NC", "No contest", "bg-zinc-100 text-zinc-600"],
} as const;

type RecentEvent = MatchmakingData["recent_events"][number];

/** Each bout's two fighters, what they did and who they fight next. */
function EventPanel({ event }: { event: RecentEvent }) {
  return (
    <Panel title={<Link to={`/events/${event.id}`} className="hover:underline">{event.name}</Link>} chip={formatDate(event.date)}>
      {event.bouts.map((bout) => (
        <li key={bout.fight_id} className="py-0.5">
          {bout.sides.map((side) => {
            const [letter, word, tone] = side.outcome ? OUTCOME[side.outcome] : ["–", "No result", "bg-zinc-100 text-zinc-500"];
            const { next } = side;
            // Wide: result, fighter, arrow, next fight, and why across the row
            // below. Narrow, the next fight wraps under the fighter.
            const why = <>
              {next.kind === "cut" ? <span className={`${TAG} bg-rose-50 text-rose-700 ring-rose-200`}>Cut</span> : null}
              <span className="min-w-0">{next.reason}</span>
            </>;
            return (
              <div key={side.fighter.id} className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1.5 gap-y-1 px-2.5 py-1 @min-[400px]:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] ${tint(next.kind, next.title)}`}>
                <span title={word} className={`mt-1 grid h-5 min-w-5 place-items-center rounded px-1 text-[10px] font-bold ${tone}`}>
                  {letter}<span className="sr-only"> {word}</span>
                </span>
                <Side fighter={side.fighter} compact />
                <span className="mt-1.5 text-center text-[11px] leading-4 text-zinc-300" aria-hidden="true">→</span>
                <div className="min-w-0">
                  <span className="sr-only">Next: </span>
                  {next.opponent ? <Side fighter={next.opponent} compact /> : <p className="flex min-w-0 items-start gap-1.5 pt-1.5 text-[10px] leading-3.5 text-zinc-500">{why}</p>}
                </div>
                {next.opponent ? <p className="col-[2/-1] -mt-0.5 flex min-w-0 items-start gap-1.5 pl-[3.75rem] text-[10px] leading-3.5 text-zinc-500">{why}</p> : null}
              </div>
            );
          })}
        </li>
      ))}
    </Panel>
  );
}

function Suggestions({ tab, data, error, retry, navigation }: { tab: Tab; data: MatchmakingData | null; error: unknown; retry: () => void; navigation: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const gender = params.get("gender") ?? "all";
  const kind = params.get("kind") ?? "all";
  const card = params.get("card") ?? "all";
  const outcome = params.get("outcome") ?? "all";
  const nextKind = params.get("next") ?? "all";
  const idle = params.get("idle") !== "0";
  const titlesOnly = params.get("titles") === "1";
  const set = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === "all" || !value) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });
  const top = tab === "top15";
  const top15 = (data?.top15 ?? []).filter((entry) => gender === "all" || entry.division.startsWith("Women") === (gender === "women")).map((entry) => ({
    ...entry,
    fights: entry.fights.filter((fight) => kind === "all" || fight.kind === kind),
    idle: idle && kind === "all" ? entry.idle : [],
  })).filter((entry) => entry.fights.length || entry.idle.length);
  const events = (data?.recent_events ?? []).filter((event) => card === "all" || event.id === card).map((event) => ({
    ...event,
    bouts: event.bouts.filter((bout) => !titlesOnly || bout.title).map((bout) => ({
      ...bout,
      sides: bout.sides.filter((side) => (outcome === "all" || side.outcome === outcome) && (nextKind === "all" || side.next.kind === nextKind)),
    })).filter((bout) => bout.sides.length),
  })).filter((event) => event.bouts.length);
  const count = top ? Number(kind !== "all") + Number(!idle) : Number(card !== "all") + Number(outcome !== "all") + Number(nextKind !== "all") + Number(titlesOnly);
  return <>
    <PageToolbar>
      {navigation}
      {top ? <div className={segmentedGroup} role="group" aria-label="Divisions shown">
        {(["men", "women", "all"] as const).map((value) => <button key={value} type="button" aria-pressed={gender === value}
          onClick={() => setParams((current) => { const next = new URLSearchParams(current); if (value === "all") next.delete("gender"); else next.set("gender", value); return next; }, { replace: true })}
          className={`${segmentedOption} ${gender === value ? segmentedSelected : segmentedIdle}`}>{value === "men" ? "Men" : value === "women" ? "Women" : "All"}</button>)}
      </div> : null}
      <div className="ml-auto flex min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto">
        <span className="hidden items-center gap-3 text-[11px] text-zinc-500 md:flex">
          <span className="flex items-center gap-1.5"><span className={`${BOOKED.title} activity-swatch h-2.5 w-2.5 rounded-sm border`} />Title fight</span>
          <span className="flex items-center gap-1.5"><span className={`${BOOKED.fight} activity-swatch h-2.5 w-2.5 rounded-sm border`} />Booked</span>
        </span>
        <OptionsSheet label="Filters" count={count || undefined} onReset={() => { setParams(top ? {} : { tab: "last" }, { replace: true }); }}>
          <div className="space-y-3 p-4">
            {!top ? <FilterSelect label="Card" value={card} onChange={(value) => set("card", value)} options={[{ value: "all", label: "Recent cards" }, ...(data?.recent_events ?? []).map((event) => ({ value: event.id, label: event.name }))]} /> : null}
            {top ? <>
              <FilterSelect label="Matchups" value={kind} onChange={(value) => set("kind", value)} options={[{ value: "all", label: "All matchups" }, { value: "title", label: "Suggested title fights" }, { value: "suggested", label: "Suggested ranked fights" }, { value: "booked", label: "Booked fights" }]} />
              <SwitchRow label="Show unpaired fighters" on={idle} onChange={(on) => set("idle", on ? "" : "0")} />
            </> : <>
              <FilterSelect label="Result" value={outcome} onChange={(value) => set("outcome", value)} options={[{ value: "all", label: "All results" }, { value: "win", label: "Winners" }, { value: "loss", label: "Losers" }, { value: "draw", label: "Draws" }, { value: "nc", label: "No contests" }]} />
              <FilterSelect label="Next fight" value={nextKind} onChange={(value) => set("next", value)} options={[{ value: "all", label: "All fighters" }, { value: "suggested", label: "Suggested opponent" }, { value: "booked", label: "Already booked" }, { value: "title", label: "Title opportunity" }, { value: "cut", label: "Released" }, { value: "none", label: "No opponent yet" }]} />
              <SwitchRow label="Title bouts only" on={titlesOnly} onChange={(on) => set("titles", on ? "1" : "")} />
            </>}
            <Freshness label="Rankings updated" at={data?.updated_at} staleAfterHours={24 * 8} />
          </div>
        </OptionsSheet>
      </div>
    </PageToolbar>
    {error && !data ? <RequestNotice onRetry={retry}>Couldn’t load the matchups.</RequestNotice> : !data ? <PageState>Working out matchups…</PageState> : top ?
      top15.length ? <div className="grid grid-cols-1 gap-2 sm:gap-3 md:grid-cols-2 2xl:grid-cols-3">{top15.map((entry) => <DivisionPanel key={entry.division} entry={entry} />)}</div>
        : <p className="py-8 text-center text-sm text-zinc-500">No matchups match these filters.</p>
      : events.length ? <div className="grid grid-cols-1 gap-2 sm:gap-3 min-[768px]:grid-cols-2 min-[1400px]:grid-cols-3 min-[1800px]:grid-cols-4">{events.map((event) => <EventPanel key={event.id} event={event} />)}</div>
        : <p className="py-8 text-center text-sm text-zinc-500">{data.recent_events.length ? "No fighters match these filters." : "No completed card yet."}</p>}
  </>;
}

export default function MatchmakingPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((option) => option.key === params.get("tab")) ? params.get("tab") as Tab : "top15";
  const { data, error, retry } = useApi<MatchmakingData>(tab === "card" ? null : "/api/matchmaking");
  const scroll = useRouteScrollRestoration<HTMLDivElement>("matchmaking", tab === "card" || Boolean(data));
  useSeo({ title: "UFC Matchmaking", description: "Build your own UFC card, and see the fights to make next: title fights, ranked matchups and next opponents for the fighters on recent cards.", path: "/matchmaking" });
  const navigation = <div className={`${segmentedGroup} shrink-0`} role="group" aria-label="Matchmaking">
    {TABS.map((option) => <button key={option.key} type="button" aria-pressed={tab === option.key}
      onClick={() => setParams(option.key === "top15" ? {} : { tab: option.key }, { replace: true })}
      className={`${segmentedOption} ${tab === option.key ? segmentedSelected : segmentedIdle}`}>{option.label}</button>)}
  </div>;
  return <div ref={scroll} className={PAGE}>
    <div className={FULL_PAGE_BODY}>
      <h1 className="sr-only">Matchmaking</h1>
      {tab === "card" ? accountsEnabled ? <AccountCardBuilder navigation={navigation} /> : <CardBuilder navigation={navigation} account={null} />
        : <Suggestions key={tab} navigation={navigation} tab={tab} data={data} error={error} retry={retry} />}
    </div>
  </div>;
}

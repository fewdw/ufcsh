import { useAuth } from "@clerk/react";
import { Check, ChevronDown, Flag, LogOut, Pencil, Search, Settings, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiCache, prefetch, useApi } from "../api";
import { accountsEnabled, useAccount } from "../auth";
import { ConfirmRemove, RemoveX } from "../components/ConfirmRemove";
import Avatar from "../components/Avatar";
import ProgressiveImage from "../components/ProgressiveImage";
import { PANEL_SHELL, PanelHeading } from "../components/FightStats";
import { LIST_META, LIST_ROW } from "../components/InfiniteList";
import { segmentedGroup, segmentedSelected, segmentedIdle } from "../components/segmented";
import ProfilePredictions from "../components/ProfilePredictions";
import ProfileBets from "../components/ProfileBets";
import ProfileComments from "../components/ProfileComments";
import ReportIssueDialog from "../components/ReportIssueDialog";
import Leaderboards from "../components/Leaderboards";
import { formatDateShortWithYear, formatMethod } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { useMyProfile } from "../profile";
import { cardWinner, usernameProblem } from "../scoring";
import type { ProfileFilter, ScorerCard, ScorerIdentity, ScorerProfile } from "../scoring";
import { useSeo } from "../seo";

const FILTERS: ProfileFilter[] = ["all", "decisions", "agreed", "disagreed"];
/** Bouts that went to the judges are the ones a card can be read against, so
 *  the list opens on them and finishes are one checkbox away. */
const DEFAULT_FILTER: ProfileFilter = "decisions";
/** `short` is what a phone shows, so all five fit on one line without scrolling. */
const TABS = [
  { id: "scorecards", label: "Scorecards", short: "Scores" }, { id: "predictions", label: "Predictions", short: "Picks" },
  { id: "bets", label: "Bets", short: "Bets" }, { id: "comments", label: "Comments", short: "Comments" },
  { id: "leaderboards", label: "Leaderboards", short: "Leaderboards" },
] as const;
type Section = (typeof TABS)[number]["id"];
const quiet = "rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40";
/** The account's own actions: short enough that all three sit on one line. */
const action = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40";
const primary = "rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40";

/** A public profile. Anyone can open anyone's: the scorer is named by the
 *  username they chose, or by the one minted for them when they signed up. */
export default function ProfilePage() {
  const { handle = "" } = useParams();
  return handle === "me" ? <MyProfileRedirect /> : <Profile handle={handle} />;
}

/** `/profiles/me` is the reader's own address before they know their handle:
 *  it resolves once, then the public profile below takes over. */
function MyProfileRedirect() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { identity, loading, error, signedIn } = useMyProfile();
  const { signIn } = useAccount();
  useSeo({ title: "Your profile" });
  useEffect(() => {
    if (identity) navigate({ pathname: `/profiles/${identity.handle}`, search: search.toString() }, { replace: true });
  }, [identity, navigate, search]);
  if (error) return <Empty message={error} />;
  if (!loading && (!accountsEnabled || !signedIn))
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-sm text-zinc-500">
        <p>Sign in to see your scorecards and predictions.</p>
        {accountsEnabled ? <button type="button" onClick={signIn} className={primary}>Sign in</button> : null}
      </div>
    );
  return <div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Opening your profile…</div>;
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-sm text-zinc-500">
      <p>{message}</p>
      <Link to="/" className="font-semibold text-zinc-900 underline">Back to events</Link>
    </div>
  );
}

function Profile({ handle }: { handle: string }) {
  const [search, setSearch] = useSearchParams();
  const filter = (FILTERS.find(value => value === search.get("filter")) ?? DEFAULT_FILTER) as ProfileFilter;
  const query = (search.get("q") ?? "").slice(0, 60);
  const pageUrl = useCallback(
    (offset: number) => `/api/profiles/${encodeURIComponent(handle)}?filter=${filter}&q=${encodeURIComponent(query)}&offset=${offset}`,
    [filter, handle, query],
  );
  const { data, error, retry } = useApi<ScorerProfile>(pageUrl(0));
  // Changing a filter or typing in the search box must not blank the page: the
  // last answer stays on screen, dimmed, until the next one arrives.
  const shown = useRef<ScorerProfile | null>(null);
  const shownFor = useRef(handle);
  if (shownFor.current !== handle) { shownFor.current = handle; shown.current = null; }
  if (data) shown.current = data;
  const view = data ?? shown.current;

  // Pages are fetched one at a time as the list is scrolled, and `ready` is
  // what keeps a fast scroll from asking for five of them at once.
  const [pages, setPages] = useState(1);
  const [ready, setReady] = useState(1);
  const [confirming, setConfirming] = useState<ScorerCard | null>(null);
  const { identity } = useMyProfile();
  const mine = Boolean(identity && view && identity.publicId === view.scorer.publicId);
  // A fan's comments are a tab for others only once they have chosen to show them.
  const tabs = TABS.filter(tab => tab.id !== "comments" || mine || view?.scorer.commentsPublic);
  const section: Section = tabs.find(tab => tab.id === search.get("tab"))?.id ?? "scorecards";
  const scroll = useRouteScrollRestoration<HTMLDivElement>("profile", Boolean(view));
  const sentinel = useRef<HTMLDivElement>(null);

  const name = view?.scorer.displayName;
  useSeo({
    title: name ? `${name}’s ${section}` : "Fan profile",
    description: name
      ? `Every UFC fight ${name} has scored round by round, and how often their cards matched the judges.`
      : "A fan's UFC scorecards, fight by fight.",
    path: `/profiles/${handle}`,
    type: "profile",
  });
  useEffect(() => { setPages(1); setReady(1); }, [handle, filter, query]);

  const pageSize = view?.pageSize ?? 25;
  const more = Boolean(data && pages * pageSize < data.total);
  useEffect(() => {
    // Only reach for the next page once the one before it has arrived.
    if (!more || ready < pages) return;
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => { if (entries.some(entry => entry.isIntersecting)) setPages(value => value + 1); },
      { root: scroll.current, rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [more, pages, ready, scroll]);

  /** After a card is removed, or a name changes, every page on screen is stale. */
  const refresh = useCallback(() => {
    for (let index = 0; index < pages; index++) void apiCache.load(pageUrl(index * pageSize));
  }, [pageUrl, pageSize, pages]);
  const removed = useCallback(() => { setConfirming(null); refresh(); }, [refresh]);
  const removal = useRemoveCard(removed);
  const setParam = (key: "filter" | "q", value: string | null) => {
    const params = new URLSearchParams(search);
    if (value) params.set(key, value); else params.delete(key);
    params.set("tab", "scorecards");
    setSearch(params, { replace: true });
  };
  const setFilter = (next: ProfileFilter) => setParam("filter", next === DEFAULT_FILTER ? null : next);

  if (error && !view) return <Empty message="This profile could not be loaded." />;
  if (!view) return <div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Loading profile…</div>;
  const { scorer, agreement } = view;

  return (
    <div ref={scroll} className="h-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-2 px-2 py-2 sm:gap-3 sm:px-5 sm:py-4">
        <ProfileHeader scorer={scorer} mine={mine} onRenamed={refresh} />

        <div role="tablist" aria-label="Profile sections" className={`${segmentedGroup} w-full`}>
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`profile-tab-${tab.id}`}
              aria-controls="profile-tabpanel"
              aria-selected={section === tab.id}
              tabIndex={section === tab.id ? 0 : -1}
              onClick={() => { const params = new URLSearchParams(search); params.set("tab", tab.id); setSearch(params, { replace: true }); }}
              onKeyDown={event => {
                const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
                if (next == null) return;
                event.preventDefault();
                const params = new URLSearchParams(search); params.set("tab", tabs[next].id); setSearch(params, { replace: true });
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              }}
              className={`min-h-9 flex-auto whitespace-nowrap rounded-full px-1 py-2 text-xs font-medium transition min-[375px]:px-1.5 min-[375px]:text-[13px] sm:px-3 sm:text-sm ${section === tab.id ? segmentedSelected : segmentedIdle}`}
            >
              <span className="sm:hidden">{tab.short}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        <div id="profile-tabpanel" role="tabpanel" aria-labelledby={`profile-tab-${section}`} className="flex flex-col gap-3">
          {section === "predictions" ? <ProfilePredictions key={handle} handle={handle} mine={mine} />
            : section === "bets" ? <ProfileBets key={handle} handle={handle} mine={mine} />
            : section === "comments" ? <ProfileComments key={handle} handle={handle} mine={mine} visible={scorer.commentsPublic}
                visibilityControl={mine ? <CommentsVisibility visible={scorer.commentsPublic} onChanged={refresh} /> : null} />
            : section === "leaderboards" ? <Leaderboards handle={handle} /> : <>
          <section className={`${PANEL_SHELL} overflow-hidden`}>
            <PanelHeading
              title="Scored fights"
              subtitle={`${view.total.toLocaleString()} of ${scorer.cards.toLocaleString()}`}
              controls={
                <div className="flex w-full items-center gap-2">
                  <SearchBox value={query} onChange={value => setParam("q", value || null)} />
                  <ScorecardFilter value={filter} agreement={agreement} total={scorer.cards} onChange={setFilter} />
                </div>
              }
            />
            <div className={data ? "" : "opacity-60 transition-opacity"}>
              {view.total === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-zinc-500">
                  {scorer.cards === 0
                    ? mine ? "You haven’t scored a fight yet. Open a completed bout and use its Score tab."
                      : "This scorer hasn’t saved a card yet."
                    : query ? `Nothing matches “${query}”.` : "No cards match this filter."}
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {Array.from({ length: pages }, (_, index) => (
                    index === 0
                      ? <CardRows key={index} cards={view.cards} mine={mine} onRemove={setConfirming} />
                      : <CardPage key={index} url={pageUrl(index * pageSize)} mine={mine} onRemove={setConfirming}
                          onReady={() => setReady(value => Math.max(value, index + 1))} />
                  ))}
                </ul>
              )}
            </div>
            {more ? <div ref={sentinel} role="status" className="border-t border-zinc-100 px-5 py-4 text-center text-sm text-zinc-400">Loading more…</div> : null}
          </section>
          </>}
        </div>

        {removal.error ? <p role="alert" className="text-center text-xs text-red-600">{removal.error}</p> : null}
        {error ? (
          <p role="alert" className="text-center text-xs text-red-600">
            Couldn’t refresh. <button className="underline" onClick={retry}>Retry</button>
          </p>
        ) : null}
      </div>
      {confirming ? (
        <ConfirmRemove
          title="Remove this scorecard?"
          detail={`${confirming.fight.f1_name} vs ${confirming.fight.f2_name} · ${confirming.total1}–${confirming.total2}`}
          busy={removal.busy === confirming.fightId}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void removal.remove(confirming.fightId, confirming.revision)}
        />
      ) : null}
    </div>
  );
}

/** Typing narrows the list without a request per keystroke, and without the
 *  address bar filling with history entries. */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [typed, setTyped] = useState(value);
  const committed = useRef(value);
  useEffect(() => { if (committed.current !== value) { committed.current = value; setTyped(value); } }, [value]);
  useEffect(() => {
    if (typed === committed.current) return;
    const timer = window.setTimeout(() => { committed.current = typed; onChange(typed); }, 250);
    return () => window.clearTimeout(timer);
  }, [typed, onChange]);
  return (
    <label className="relative min-w-0 flex-1 sm:max-w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
      <input
        type="search"
        value={typed}
        onChange={event => setTyped(event.target.value.slice(0, 60))}
        placeholder="Search fights…"
        aria-label="Search scored fights"
        // Names are not words: no autocorrect, capitals or suggestions.
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:h-8 sm:text-[13px]"
      />
    </label>
  );
}

/** Agreement is a list filter, so it lives with search instead of taking over
 * a full card above the results. Counts make each compact option unambiguous. */
function ScorecardFilter({ value, agreement, total, onChange }: {
  value: ProfileFilter;
  agreement: ScorerProfile["agreement"];
  total: number;
  onChange: (value: ProfileFilter) => void;
}) {
  const options: { value: ProfileFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: total },
    { value: "decisions", label: "Judged", count: agreement.decisions },
    { value: "agreed", label: "Agreed", count: agreement.agreed },
    { value: "disagreed", label: "Disagreed", count: agreement.disagreed },
  ];
  const current = options.find(option => option.value === value) ?? options[0];
  // A native select is as wide as its longest option. The chip shows only the
  // current one, with the select laid invisibly over it to open the picker.
  return (
    <label className="relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 pl-3.5 pr-3 text-[13px] font-medium text-zinc-700 transition-colors focus-within:border-zinc-400 hover:border-zinc-300 sm:h-8 sm:text-xs">
      <span className="whitespace-nowrap">{current.label} <span className="tabular-nums text-zinc-400">{current.count.toLocaleString()}</span></span>
      <ChevronDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
      <select
        value={value}
        onChange={event => onChange(event.target.value as ProfileFilter)}
        aria-label="Filter scored fights"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label} · {option.count.toLocaleString()}</option>)}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// identity

function ProfileHeader({ scorer, mine, onRenamed }: { scorer: ScorerProfile["scorer"]; mine: boolean; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { user, manage, signOut } = useAccount();
  return (
    <header className={`${PANEL_SHELL} px-4 py-3 sm:px-5`}>
      <div className="flex items-center gap-3 sm:gap-4">
        <ScorerPortrait scorer={scorer} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <UsernameEditor scorer={scorer} onClose={() => setEditing(false)} onRenamed={onRenamed} />
          ) : (
            <>
              <h1 className="flex min-w-0 items-center gap-1.5 text-base font-bold text-zinc-900 sm:text-lg">
                <span className="min-w-0 [overflow-wrap:anywhere]">{scorer.displayName}</span>
                {mine ? (
                  <button type="button" onClick={() => setEditing(true)} title="Change username"
                    aria-label="Change username"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : null}
              </h1>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {scorer.cards.toLocaleString()} {scorer.cards === 1 ? "fight scored" : "fights scored"}
                {scorer.joinedAt ? ` · Joined ${formatDateShortWithYear(new Date(scorer.joinedAt).toISOString().slice(0, 10))}` : ""}
              </p>
              {mine && user?.primaryEmailAddress?.emailAddress ? (
                <p className="mt-1 text-xs text-zinc-500 [overflow-wrap:anywhere]">{user.primaryEmailAddress.emailAddress}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
      {mine && user ? (
        <div className="mt-3 flex items-center justify-center gap-1 border-t border-zinc-100 pt-2 sm:gap-1.5">
          <button type="button" onClick={() => setReportOpen(true)} className={action} title="Report an issue">
            <Flag className="h-3.5 w-3.5" aria-hidden="true" />Report
          </button>
          <button type="button" onClick={manage} className={action} title="Manage account">
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />Account
          </button>
          <button type="button" onClick={signOut} className={action}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />Sign out
          </button>
          <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} />
        </div>
      ) : null}
    </header>
  );
}

/** Whether the Comments tab is shown to other people. Hidden until the owner
 *  unticks it; the list itself is always there for them. */
function CommentsVisibility({ visible, onChanged }: { visible: boolean; onChanged: () => void }) {
  const { getToken } = useAuth();
  const [hidden, setHidden] = useState(!visible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setHidden(!visible); }, [visible]);
  const change = async (next: boolean) => {
    setHidden(next); setBusy(true); setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/profiles/mine", {
        method: "PUT", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ commentsPublic: !next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "That setting could not be saved.");
      onChanged();
    } catch (problem) {
      setHidden(!next);
      setError(problem instanceof Error ? problem.message : "That setting could not be saved.");
    } finally { setBusy(false); }
  };
  return (
    <label className={`${action} cursor-pointer`} title={error || "Hide the Comments tab from your profile. Your comments stay on each fight either way."}>
      <input type="checkbox" checked={hidden} disabled={busy} onChange={event => void change(event.target.checked)} className="h-3.5 w-3.5 accent-zinc-900" />
      Hide from my profile
      {error ? <span role="alert" className="text-red-600">· {error}</span> : null}
    </label>
  );
}

function ScorerPortrait({ scorer }: { scorer: ScorerIdentity }) {
  const [failed, setFailed] = useState(false);
  const letter = scorer.displayName.slice(0, 1).toUpperCase();
  if (!scorer.imageUrl || failed)
    return (
      <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-zinc-100 text-base font-semibold text-zinc-400 ring-1 ring-zinc-200">
        {/^[A-Z0-9]$/.test(letter) ? letter : <User className="h-5 w-5" />}
      </span>
    );
  return (
    <ProgressiveImage
      src={scorer.imageUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-12 w-12 shrink-0 rounded-full bg-zinc-100 object-cover ring-1 ring-zinc-200"
    />
  );
}

/** Claiming a name. The field refuses what the server would refuse, and the
 *  address bar follows the answer, so a renamed profile is never left on a URL
 *  that no longer resolves. Changing only capitalisation keeps the same
 *  address, so the page is reloaded rather than left waiting for a navigation
 *  that would change nothing. */
function UsernameEditor({ scorer, onClose, onRenamed }: { scorer: ScorerIdentity; onClose: () => void; onRenamed: () => void }) {
  const { setUsername } = useMyProfile();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [value, setValue] = useState(scorer.username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = usernameProblem(value);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || problem) { setError(problem ?? ""); return; }
    setBusy(true); setError("");
    try {
      const identity = await setUsername(value);
      // A new address reloads the profile by itself; the same one — only
      // recapitalised — has to be asked for again.
      if (identity.handle === scorer.handle) onRenamed();
      else navigate({ pathname: `/profiles/${identity.handle}`, search: search.toString() }, { replace: true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That username could not be saved.");
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="min-w-0">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={event => { setValue(event.target.value); setError(""); }}
          maxLength={20}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Username"
          aria-invalid={Boolean(error)}
          placeholder="username"
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
        />
        <button type="submit" className={primary} disabled={busy || Boolean(problem)} title="Save username">
          {busy ? "Saving…" : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        <button type="button" className={quiet} onClick={onClose} disabled={busy} aria-label="Cancel">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <p className={`mt-1 truncate text-[11px] ${error ? "text-red-600" : "text-zinc-400"}`} role={error ? "alert" : undefined}>
        {error || problem || `ufc.sh/profiles/${value.toLowerCase()}`}
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// the list

function useRemoveCard(onRemoved: () => void) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const remove = useCallback(async (fightId: string, revision: number) => {
    setBusy(fightId); setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch(`/api/fights/${fightId}/scores/mine`, {
        method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "That scorecard could not be removed.");
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That scorecard could not be removed.");
    } finally { setBusy(null); }
  }, [getToken, onRemoved]);
  return { remove, busy, error };
}

function CardPage({ url, mine, onRemove, onReady }: {
  url: string; mine: boolean; onRemove: (card: ScorerCard) => void; onReady: () => void;
}) {
  const { data, error, retry } = useApi<ScorerProfile>(url);
  useEffect(() => { if (data) onReady(); }, [data, onReady]);
  if (error && !data)
    return (
      <li className="px-5 py-4 text-center text-sm text-red-600">
        Couldn’t load more. <button className="underline" onClick={retry}>Retry</button>
      </li>
    );
  if (!data) return <li role="status" className="px-5 py-4 text-center text-sm text-zinc-400">Loading…</li>;
  return <CardRows cards={data.cards} mine={mine} onRemove={onRemove} />;
}

/** A fragment so every page's rows sit in the one list. */
function CardRows({ cards, mine, onRemove }: { cards: ScorerCard[]; mine: boolean; onRemove: (card: ScorerCard) => void }) {
  return <>{cards.map(card => <CardRow key={card.fightId} card={card} mine={mine} onRemove={onRemove} />)}</>;
}

/** One scored fight: the two fighters with the reader's own score between
 *  them, and one line saying which bout it was. The row opens that bout's
 *  Score tab, which is both where the card is read in full and where it is
 *  changed. */
function CardRow({ card, mine, onRemove }: { card: ScorerCard; mine: boolean; onRemove: (card: ScorerCard) => void }) {
  const { fight } = card;
  const winner = cardWinner(card);
  const warm = () => prefetch(`/api/fights/${card.fightId}`);
  const scored = Boolean(card.rounds.length);
  return (
    <li className="relative">
      <Link
        to={`/fights/${card.fightId}?tab=score`}
        onPointerEnter={warm}
        onFocus={warm}
        className={`block ${LIST_ROW} transition-colors hover:bg-zinc-50 ${mine ? "pr-9 sm:pr-10" : ""}`}
      >
        <div className="flex items-center gap-2">
          <Avatar src={fight.f1_photo} name={fight.f1_name} size="sm" outcome={fight.f1_outcome as "win" | "loss" | null} />
          <p className="min-w-0 flex-1 truncate text-right text-sm font-semibold text-f1-ink">{fight.f1_name}</p>
          <p className="shrink-0 text-base font-bold tabular-nums">
            <span className={winner === 1 ? "text-f1-ink" : "text-zinc-400"}>{scored ? card.total1 : "—"}</span>
            <span className="mx-1 text-zinc-300">–</span>
            <span className={winner === 2 ? "text-f2-ink" : "text-zinc-400"}>{scored ? card.total2 : "—"}</span>
          </p>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-f2-ink">{fight.f2_name}</p>
          <Avatar src={fight.f2_photo} name={fight.f2_name} size="sm" outcome={fight.f2_outcome as "win" | "loss" | null} />
        </div>
        <p className={`mt-1 truncate text-center ${LIST_META}`}>
          {fight.event_name} · {formatDateShortWithYear(fight.date)}
          {fight.weight_class ? ` · ${fight.weight_class}` : ""}
          {card.agreement ? (
            <span className={card.agreement === "agreed" ? "text-emerald-600" : "text-rose-600"}>
              {" · "}{card.agreement === "agreed" ? "Agreed" : "Disagreed"}
            </span>
          ) : null}
          {fight.method ? ` · ${formatMethod(fight.method, fight.round, fight.time)}` : ""}
        </p>
      </Link>
      {mine ? <RemoveX large label={`Remove your scorecard for ${fight.f1_name} vs ${fight.f2_name}`} onClick={() => onRemove(card)} /> : null}
    </li>
  );
}

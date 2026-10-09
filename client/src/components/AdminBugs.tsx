import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAdminRequest, useAdminResource } from "../admin";
import { formatDateShortWithYear } from "../format";

type BugLink = { label: string; href: string; internal?: boolean };
type BugAction = { id: string; label: string; target: string };
/** Graded on the server, per item, from how close its card is and what it
 *  breaks: the same gap climbs as fight night approaches. */
type Level = "critical" | "must" | "minor" | "ok";
type BugItem = {
  key: string;
  title: string;
  subtitle?: string;
  date?: string;
  level: Level;
  facts: [string, string][];
  links: BugLink[];
  actions: BugAction[];
};
type BugCheck = {
  id: string;
  group: string;
  label: string;
  description: string;
  level: Level;
  total: number;
  items: BugItem[];
};
type BugReport = {
  generated_at: number;
  can_act: boolean;
  sync: { last_tick_at: string | null; last_sync_error: string | null };
  checks: BugCheck[];
};

const LEVELS: { id: Level; label: string; hint: string; dot: string }[] = [
  { id: "critical", label: "Critical", hint: "Wrong or missing where readers are looking right now", dot: "bg-danger" },
  { id: "must", label: "Must fix", hint: "Will be seen soon, or wrong on a live page", dot: "bg-attention" },
  { id: "minor", label: "Not bad", hint: "A real gap nobody is waiting on", dot: "bg-yellow-400" },
  { id: "ok", label: "OK", hint: "Expected for now, or cosmetic", dot: "bg-line-strong" },
];
const LEVEL = Object.fromEntries(LEVELS.map((level) => [level.id, level])) as Record<Level, (typeof LEVELS)[number]>;
const rank = (level: Level) => LEVELS.findIndex((item) => item.id === level);
const isLevel = (value: string | null): value is Level => LEVELS.some((level) => level.id === value);

function Dot({ level, className = "" }: { level: Level; className?: string }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${LEVEL[level].dot} ${className}`} title={`${LEVEL[level].label}: ${LEVEL[level].hint}`} />;
}

type Review = { at: number; note: string };
const REVIEW_KEY = "bugs-reviewed-v1";
const PAGE = 100;

function loadReviews(): Record<string, Review> {
  try {
    const saved = JSON.parse(localStorage.getItem(REVIEW_KEY) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

/** Reviewed marks and notes live in this browser only; they are a personal
 * to-do list over the report, not a change to the data. */
function useReviews() {
  const [reviews, setReviews] = useState(loadReviews);
  const save = useCallback((next: Record<string, Review>) => {
    setReviews(next);
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, []);
  const toggle = useCallback((id: string) => {
    const next = { ...loadReviews() };
    if (next[id]) delete next[id];
    else next[id] = { at: Date.now(), note: "" };
    save(next);
  }, [save]);
  const setNote = useCallback((id: string, note: string) => {
    const next = { ...loadReviews() };
    next[id] = { at: next[id]?.at ?? Date.now(), note };
    save(next);
  }, [save]);
  return { reviews, toggle, setNote };
}

/** Side by side from md up; on a phone the checks and one check's items take
 *  turns filling the page. */
const WIDE = "(min-width: 768px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const reviewId = (check: BugCheck, item: BugItem) => `${check.id}:${item.key}`;

function itemText(check: BugCheck, item: BugItem): string {
  return [
    `[${check.label}] ${item.title}${item.date ? ` (${item.date})` : ""}`,
    item.subtitle,
    ...item.facts.map(([label, value]) => `${label}: ${value}`),
    ...item.links.map((link) => `${link.label}: ${link.internal ? `${window.location.origin}${link.href}` : link.href}`),
  ].filter(Boolean).join("\n");
}

function matches(item: BugItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.key, item.title, item.subtitle ?? "", item.date ?? "", ...item.facts.flat()].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

function ago(ms: number | string | null): string {
  const value = Number(ms);
  if (!value) return "never";
  const minutes = Math.round((Date.now() - value) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function ItemRow({
  check, item, canAct, review, onToggle, onNote,
}: {
  check: BugCheck;
  item: BugItem;
  canAct: boolean;
  review: Review | undefined;
  onToggle: () => void;
  onNote: (note: string) => void;
}) {
  const request = useAdminRequest();
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [noteOpen, setNoteOpen] = useState(Boolean(review?.note));

  const run = async (action: BugAction) => {
    setRunning(action.id);
    setResult(null);
    try {
      const body = await request<{ ok?: boolean; message?: string }>(
        `/api/admin/bugs/action?action=${encodeURIComponent(action.id)}&target=${encodeURIComponent(action.target)}`,
        { method: "POST" },
      );
      setResult({ ok: Boolean(body.ok), message: body.message ?? "Done." });
    } catch (err) {
      setResult({ ok: false, message: String(err) });
    } finally {
      setRunning(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(itemText(check, item));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };

  const primary = item.links.find((link) => link.internal);

  return (
    <li className={`border-b border-line-subtle px-4 py-3 last:border-b-0 ${review ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <input
          type="checkbox"
          checked={Boolean(review)}
          onChange={onToggle}
          aria-label={`Mark ${item.title} reviewed`}
          title="Mark reviewed"
          className="mt-1 h-4 w-4 shrink-0 accent-zinc-900"
        />
        {/* Wide enough to read; on a phone the buttons wrap below instead. */}
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Dot level={item.level} className="translate-y-[-1px] self-center" />
            {primary ? (
              <Link to={primary.href} className="font-medium text-foreground hover:underline">{item.title}</Link>
            ) : (
              <span className="font-medium text-foreground">{item.title}</span>
            )}
            {item.date && <span className="text-xs tabular-nums text-muted">{formatDateShortWithYear(item.date)}</span>}
          </div>
          {item.subtitle && <div className="text-xs text-muted">{item.subtitle}</div>}

          {item.facts.length > 0 && (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {item.facts.map(([label, value], i) => (
                <div key={i} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 break-words text-secondary">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {item.links.map((link, i) => link.internal ? (
              <Link key={i} to={link.href} className="text-secondary underline decoration-faint underline-offset-2 hover:text-foreground">{link.label}</Link>
            ) : (
              <a key={i} href={link.href} target="_blank" rel="noreferrer" className="text-secondary underline decoration-faint underline-offset-2 hover:text-foreground">{link.label} ↗</a>
            ))}
          </div>

          {noteOpen && (
            <textarea
              defaultValue={review?.note ?? ""}
              onBlur={(e) => { if (e.target.value !== (review?.note ?? "")) onNote(e.target.value); }}
              placeholder="Note (saved in this browser)"
              rows={2}
              className="mt-2 w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs text-secondary outline-none focus:border-line-strong"
            />
          )}
          {result && (
            <div className={`mt-2 text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</div>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-1.5 pl-7 sm:w-auto sm:pl-0">
          {canAct && item.actions.map((action) => (
            <button
              key={action.id + action.target}
              type="button"
              disabled={running != null}
              onClick={() => void run(action)}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-secondary sm:px-2 sm:py-1 hover:border-line-strong hover:bg-surface-muted disabled:opacity-50"
            >
              {running === action.id ? "Running…" : action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNoteOpen((open) => !open)}
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-muted sm:px-2 sm:py-1 hover:border-line-strong hover:bg-surface-muted"
          >
            Note
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            title="Copy this item as text"
            className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-muted sm:px-2 sm:py-1 hover:border-line-strong hover:bg-surface-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </li>
  );
}

export default function AdminBugs() {
  const { data, loading, error, reload } = useAdminResource<BugReport>("/api/admin/bugs");
  const [params, setParams] = useSearchParams();
  const { reviews, toggle, setNote } = useReviews();
  const [shown, setShown] = useState(PAGE);
  const [refreshing, setRefreshing] = useState(false);
  const wide = useWide();
  const navigate = useNavigate();
  const location = useLocation();
  const root = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLElement>(null);
  const listScroll = useRef(0);

  const query = params.get("q") ?? "";
  const hideReviewed = params.get("reviewed") !== "show";
  const levelParam = params.get("level");
  const level = isLevel(levelParam) ? levelParam : null;
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const isOpen = useCallback((check: BugCheck, item: BugItem) =>
    matches(item, query) && !(hideReviewed && reviews[reviewId(check, item)]), [query, hideReviewed, reviews]);
  // Per check: its open items, the ones beyond the listed thousand (the least
  // serious, since items arrive worst first), and the worst level still open.
  const tally = useMemo(() => new Map((data?.checks ?? []).map((check) => {
    const open = check.items.filter((item) => isOpen(check, item));
    // Items past the listed thousand can't be searched, so a search leaves them out.
    const unlisted = query ? 0 : Math.max(0, check.total - check.items.length);
    const counts = { critical: 0, must: 0, minor: 0, ok: 0 } as Record<Level, number>;
    for (const item of open) counts[item.level]++;
    if (unlisted) counts[check.items.at(-1)?.level ?? check.level] += unlisted;
    const worst = LEVELS.find((entry) => counts[entry.id] > 0)?.id ?? "ok";
    return [check.id, { counts, worst, count: level ? counts[level] : open.length + unlisted }];
  })), [data, isOpen, level, query]);
  const stat = (check: BugCheck) => tally.get(check.id)!;

  // Worst first: groups by their worst check, checks by their worst item, the
  // report's own order breaking ties.
  const groups = useMemo(() => {
    const map = new Map<string, BugCheck[]>();
    for (const check of data?.checks ?? []) map.set(check.group, [...(map.get(check.group) ?? []), check]);
    const worst = (check: BugCheck) => (tally.get(check.id)?.count ? rank(tally.get(check.id)!.worst) : LEVELS.length);
    return [...map.entries()]
      .map(([group, checks]) => [group, [...checks].sort((a, b) => worst(a) - worst(b))] as const)
      .sort((a, b) => worst(a[1][0]) - worst(b[1][0]));
  }, [data, tally]);
  const ordered = useMemo(() => groups.flatMap(([, checks]) => checks), [groups]);

  // A search with no check picked looks through every check at once.
  const picked = params.get("check");
  const searchAll = Boolean(query) && !picked;
  // Wide, the worst check opens beside the list; a phone shows the list first.
  const selected = searchAll ? undefined : ordered.find((check) => check.id === picked)
    ?? (wide ? ordered.find((check) => stat(check).count > 0) ?? ordered[0] : undefined);
  const showList = wide || (!picked && !searchAll);

  // A phone opens a check as its own page: the back gesture returns to the
  // list where it was left, and the check opens at its own heading.
  const scroller = () => root.current?.closest<HTMLElement>("#admin-tabpanel") ?? null;
  const openCheck = (id: string) => {
    if (wide) return setParam("check", id);
    listScroll.current = scroller()?.scrollTop ?? 0;
    const next = new URLSearchParams(params);
    next.set("check", id);
    setParams(next, { state: { fromList: true } });
  };
  const back = () => {
    if (picked && (location.state as { fromList?: boolean } | null)?.fromList) navigate(-1);
    else setParam(picked ? "check" : "q", null);
  };
  // Only opening or leaving a check moves the page: a search typed above the
  // list keeps its place.
  const wasPicked = useRef(picked);
  useLayoutEffect(() => {
    const el = scroller();
    const before = wasPicked.current;
    wasPicked.current = picked;
    if (wide || !el || before === picked) return;
    if (picked) el.scrollTop += (detail.current?.getBoundingClientRect().top ?? 0) - el.getBoundingClientRect().top;
    else if (showList) el.scrollTop = listScroll.current;
  }, [wide, showList, picked]);

  useEffect(() => { setShown(PAGE); }, [selected?.id, query, hideReviewed, level]);

  const visible = useMemo(() => (searchAll ? ordered : selected ? [selected] : []).flatMap((check) => check.items
    .filter((item) => isOpen(check, item) && (!level || item.level === level))
    .map((item) => ({ check, item }))), [searchAll, ordered, selected, isOpen, level]);
  const reviewedHere = selected ? selected.items.filter((item) => reviews[reviewId(selected, item)]).length : 0;
  const matchedChecks = new Set(visible.map(({ check }) => check.id)).size;

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(visible.map(({ check, item }) => itemText(check, item)).join("\n\n")); } catch { /* unavailable */ }
  };

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted">
        <p>Couldn’t load the report. {error}</p>
        <button type="button" onClick={() => void reload()} className="font-medium text-foreground underline">Retry</button>
      </div>
    );
  }
  if (loading || !data) {
    return <div role="status" className="flex items-center justify-center py-16 text-sm text-muted">Checking the database…</div>;
  }

  const totals = LEVELS.map((entry) => ({
    ...entry,
    count: data.checks.reduce((sum, check) => sum + stat(check).counts[entry.id], 0),
  }));

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        {/* Each level is also a filter: the board, its counts and the list
            narrow to it, and a second click lets go. */}
        <div className="grid w-full grid-cols-4 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center" role="group" aria-label="Filter by level">
          {totals.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={level === entry.id}
              onClick={() => setParam("level", level === entry.id ? null : entry.id)}
              title={entry.hint}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl border px-1 py-1.5 text-xs tabular-nums transition sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-2.5 sm:py-1 ${
                level === entry.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-line bg-surface text-secondary hover:border-line-strong hover:bg-surface-muted"
              } ${entry.count || level === entry.id ? "" : "opacity-50"}`}
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${entry.dot}`} aria-hidden="true" />
                <span className="font-medium">{entry.count.toLocaleString()}</span>
              </span>
              <span className="max-w-full truncate text-[11px] sm:text-xs">{entry.label}</span>
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("q", e.target.value); else next.delete("q");
              next.delete("check");
              setParams(next, { replace: true });
            }}
            placeholder="Search every check…"
            aria-label="Search every check by name, event, date or id"
            className="min-w-0 flex-1 basis-full rounded-lg border border-line bg-surface px-2.5 py-2 text-base outline-none focus:border-line-strong sm:basis-auto sm:py-1.5 sm:text-sm md:w-56 md:flex-none"
          />
          <label className="flex flex-1 items-center gap-1.5 py-1 text-xs text-secondary sm:flex-none">
            <input
              type="checkbox"
              checked={hideReviewed}
              onChange={(e) => setParam("reviewed", e.target.checked ? null : "show")}
              className="accent-zinc-900"
            />
            Hide reviewed
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-muted disabled:opacity-50"
          >
            {refreshing ? "Checking…" : "Re-run checks"}
          </button>
        </div>
        <p className="w-full text-[11px] text-muted">
          Built {ago(data.generated_at)} · last sync tick {ago(data.sync.last_tick_at)}
          {!data.can_act && " · repairs are disabled"}
        </p>
        {/* A long error stays two lines on a phone; its full text is in the tooltip and the Copy. */}
        {data.sync.last_sync_error && (
          <p className="-mt-1 line-clamp-2 w-full break-words text-[11px] text-danger sm:line-clamp-none" title={data.sync.last_sync_error}>
            Last sync error: {data.sync.last_sync_error}
          </p>
        )}
      </div>

      {/* Wide, the checks and the selected list each scroll on their own inside
          the space under the tabs and the page never moves. A phone scrolls the
          page through one or the other. */}
      <div className="flex flex-col gap-3 md:grid md:min-h-0 md:flex-1 md:grid-cols-[18rem_minmax(0,1fr)]">
        {showList && <nav className="rounded-xl border border-line bg-surface p-2 md:min-h-0 md:overflow-y-auto md:overscroll-y-contain" aria-label="Checks">
          {query && (
            <button
              type="button"
              onClick={() => setParam("check", null)}
              aria-current={searchAll ? "true" : undefined}
              className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm md:py-1.5 ${searchAll ? "bg-foreground text-background" : "text-secondary hover:bg-surface-strong"}`}
            >
              <span className="min-w-0 flex-1 truncate">All matches</span>
              <span className={`tabular-nums text-xs ${searchAll ? "text-faint" : "text-muted"}`}>
                {ordered.reduce((sum, check) => sum + stat(check).count, 0).toLocaleString()}
              </span>
            </button>
          )}
          {groups.map(([group, groupChecks]) => (
            <div key={group} className="mb-2 last:mb-0">
              <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted">
                <span>{group}</span>
                <span className="tabular-nums" aria-label={`${group} total`}>
                  {groupChecks.reduce((sum, check) => sum + stat(check).count, 0).toLocaleString()}
                </span>
              </div>
              <ul>
                {groupChecks.map((check) => {
                  const { count, worst } = stat(check);
                  const active = check.id === selected?.id;
                  return (
                    <li key={check.id}>
                      <button
                        type="button"
                        onClick={() => openCheck(check.id)}
                        aria-current={active ? "true" : undefined}
                        title={check.label}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm md:py-1.5 ${active ? "bg-foreground text-background" : "text-secondary hover:bg-surface-strong"}`}
                      >
                        <Dot level={count ? worst : "ok"} className={count ? "" : "opacity-40"} />
                        <span className="min-w-0 flex-1 truncate">{check.label}</span>
                        <span className={`tabular-nums text-xs ${active ? "text-faint" : count ? "text-muted" : "text-faint"}`}>{count.toLocaleString()}</span>
                        {!wide && <span className="-mr-0.5 text-faint" aria-hidden="true">›</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>}

        {(selected || searchAll) && (
          <section ref={detail} className="min-w-0 rounded-xl border border-line bg-surface md:min-h-0 md:overflow-y-auto md:overscroll-y-contain">
            <header className="sticky top-0 z-10 rounded-t-xl border-b border-line bg-surface px-4 py-3">
              {!wide && (
                <button type="button" onClick={back} className="-ml-1 mb-1.5 flex items-center gap-1 py-1 pr-2 text-sm text-muted hover:text-foreground">
                  <span aria-hidden="true">‹</span> {picked && query ? "Matches" : picked ? "All checks" : "Clear search"}
                </button>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h2 className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                  {selected ? (
                    <>
                      <Dot level={stat(selected).count ? stat(selected).worst : "ok"} />
                      {selected.label}
                    </>
                  ) : (
                    <span className="min-w-0 truncate">Matches for “{query}”</span>
                  )}
                </h2>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span>
                    {selected ? (
                      <>
                        {visible.length.toLocaleString()} shown · {reviewedHere} reviewed · {selected.total.toLocaleString()} total
                        {selected.total > selected.items.length && ` (first ${selected.items.length} listed)`}
                      </>
                    ) : (
                      `${visible.length.toLocaleString()} in ${matchedChecks} ${matchedChecks === 1 ? "check" : "checks"}`
                    )}
                  </span>
                  <button type="button" onClick={() => void copyAll()} className="underline decoration-faint underline-offset-2 hover:text-foreground">
                    Copy shown
                  </button>
                </div>
              </div>
            </header>
            {/* Read once, then out of the way: it scrolls with the items. */}
            {selected && (
              <div className="border-b border-line-subtle px-4 py-2.5">
                <p className="max-w-3xl text-xs leading-relaxed text-muted">{selected.description}</p>
              </div>
            )}
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {!selected ? "No check has a match." : selected.total === 0 ? "Nothing wrong here." : level ? `Nothing ${LEVEL[level].label.toLowerCase()} here.` : "Everything here is reviewed or filtered out."}
              </p>
            ) : (
              <ul>
                {visible.slice(0, shown).map(({ check, item }, i) => (
                  <Fragment key={`${check.id}:${item.key}`}>
                    {/* Across every check, each run of one check's items is headed by its name. */}
                    {searchAll && check.id !== visible[i - 1]?.check.id && (
                      <li className="border-b border-line-subtle bg-surface-muted px-4 py-1.5">
                        <button
                          type="button"
                          onClick={() => openCheck(check.id)}
                          className="text-[11px] font-medium text-muted hover:text-foreground"
                        >
                          {check.group} · {check.label}
                        </button>
                      </li>
                    )}
                    <ItemRow
                      check={check}
                      item={item}
                      canAct={data.can_act}
                      review={reviews[reviewId(check, item)]}
                      onToggle={() => toggle(reviewId(check, item))}
                      onNote={(note) => setNote(reviewId(check, item), note)}
                    />
                  </Fragment>
                ))}
              </ul>
            )}
            {visible.length > shown && (
              <div className="border-t border-line-subtle px-4 py-3 text-center">
                <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-sm font-medium text-secondary underline decoration-faint underline-offset-2">
                  Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAdminRequest, useAdminResource } from "../admin";
import { formatDateShortWithYear } from "../format";

type BugLink = { label: string; href: string; internal?: boolean };
type BugAction = { id: string; label: string; target: string };
type BugItem = {
  key: string;
  title: string;
  subtitle?: string;
  date?: string;
  facts: [string, string][];
  links: BugLink[];
  actions: BugAction[];
};
type Severity = "high" | "medium" | "low";
type BugCheck = {
  id: string;
  group: string;
  label: string;
  description: string;
  severity: Severity;
  total: number;
  items: BugItem[];
};
type BugReport = {
  generated_at: number;
  can_act: boolean;
  sync: { last_tick_at: string | null; last_sync_error: string | null };
  checks: BugCheck[];
};

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

const severityDot: Record<Severity, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-400",
  low: "bg-zinc-300",
};

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
  const haystack = [item.title, item.subtitle ?? "", item.date ?? "", ...item.facts.flat()].join(" ").toLowerCase();
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
    <li className={`border-b border-zinc-100 px-4 py-3 last:border-b-0 ${review ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <input
          type="checkbox"
          checked={Boolean(review)}
          onChange={onToggle}
          aria-label={`Mark ${item.title} reviewed`}
          title="Mark reviewed"
          className="mt-1 h-4 w-4 shrink-0 accent-zinc-900"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {primary ? (
              <Link to={primary.href} className="font-semibold text-zinc-900 hover:underline">{item.title}</Link>
            ) : (
              <span className="font-semibold text-zinc-900">{item.title}</span>
            )}
            {item.date && <span className="text-xs tabular-nums text-zinc-400">{formatDateShortWithYear(item.date)}</span>}
          </div>
          {item.subtitle && <div className="text-xs text-zinc-500">{item.subtitle}</div>}

          {item.facts.length > 0 && (
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {item.facts.map(([label, value], i) => (
                <div key={i} className="contents">
                  <dt className="text-zinc-400">{label}</dt>
                  <dd className="min-w-0 break-words text-zinc-700">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {item.links.map((link, i) => link.internal ? (
              <Link key={i} to={link.href} className="text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">{link.label}</Link>
            ) : (
              <a key={i} href={link.href} target="_blank" rel="noreferrer" className="text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">{link.label} ↗</a>
            ))}
          </div>

          {noteOpen && (
            <textarea
              defaultValue={review?.note ?? ""}
              onBlur={(e) => { if (e.target.value !== (review?.note ?? "")) onNote(e.target.value); }}
              placeholder="Note (saved in this browser)"
              rows={2}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none focus:border-zinc-400"
            />
          )}
          {result && (
            <div className={`mt-2 text-xs ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.message}</div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {canAct && item.actions.map((action) => (
            <button
              key={action.id + action.target}
              type="button"
              disabled={running != null}
              onClick={() => void run(action)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
            >
              {running === action.id ? "Running…" : action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNoteOpen((open) => !open)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
          >
            Note
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            title="Copy this item as text"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
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

  const query = params.get("q") ?? "";
  const hideReviewed = params.get("reviewed") !== "show";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const openCount = useCallback((check: BugCheck) =>
    check.items.filter((item) => matches(item, query) && !(hideReviewed && reviews[reviewId(check, item)])).length
    + Math.max(0, check.total - check.items.length),
  [query, hideReviewed, reviews]);

  const checks = useMemo(() => data?.checks ?? [], [data]);
  const selected = checks.find((check) => check.id === params.get("check"))
    ?? checks.find((check) => openCount(check) > 0)
    ?? checks[0];

  useEffect(() => { setShown(PAGE); }, [selected?.id, query, hideReviewed]);

  const visible = useMemo(() => selected
    ? selected.items.filter((item) => matches(item, query) && !(hideReviewed && reviews[reviewId(selected, item)]))
    : [], [selected, query, hideReviewed, reviews]);
  const reviewedHere = selected ? selected.items.filter((item) => reviews[reviewId(selected, item)]).length : 0;

  const groups = useMemo(() => {
    const map = new Map<string, BugCheck[]>();
    for (const check of checks) map.set(check.group, [...(map.get(check.group) ?? []), check]);
    return [...map.entries()];
  }, [checks]);

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const copyAll = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(visible.map((item) => itemText(selected, item)).join("\n\n")); } catch { /* unavailable */ }
  };

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <p>Couldn’t load the report. {error}</p>
        <button type="button" onClick={() => void reload()} className="font-semibold text-zinc-900 underline">Retry</button>
      </div>
    );
  }
  if (loading || !data) {
    return <div role="status" className="flex items-center justify-center py-16 text-sm text-zinc-400">Checking the database…</div>;
  }

  const totalOpen = checks.reduce((sum, check) => sum + openCount(check), 0);

  return (
    <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Data bugs</h2>
            <p className="text-xs text-zinc-500">
              {totalOpen.toLocaleString()} open across {checks.length} checks · built {ago(data.generated_at)} · last sync tick {ago(data.sync.last_tick_at)}
              {!data.can_act && " · repairs are disabled"}
            </p>
            {data.sync.last_sync_error && (
              <p className="mt-1 text-xs text-rose-600">Last sync error: {data.sync.last_sync_error}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setParam("q", e.target.value || null)}
              placeholder="Filter by name, event, date…"
              className="w-56 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
            />
            <label className="flex items-center gap-1.5 text-xs text-zinc-600">
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
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Re-run checks"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <nav className="rounded-xl border border-zinc-200 bg-white p-2 md:sticky md:top-0 md:w-72 md:shrink-0" aria-label="Checks">
            {groups.map(([group, groupChecks]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <span>{group}</span>
                  <span className="tabular-nums" aria-label={`${group} total`}>
                    {groupChecks.reduce((sum, check) => sum + openCount(check), 0).toLocaleString()}
                  </span>
                </div>
                <ul>
                  {groupChecks.map((check) => {
                    const count = openCount(check);
                    const active = check.id === selected?.id;
                    return (
                      <li key={check.id}>
                        <button
                          type="button"
                          onClick={() => setParam("check", check.id)}
                          aria-current={active ? "true" : undefined}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${severityDot[check.severity]}`} title={`${check.severity} severity`} />
                          <span className="min-w-0 flex-1 truncate">{check.label}</span>
                          <span className={`tabular-nums text-xs ${active ? "text-zinc-300" : count ? "text-zinc-500" : "text-zinc-300"}`}>{count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {selected && (
            <section className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white">
              <header className="border-b border-zinc-200 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-semibold text-zinc-900">
                    <span className={`h-2 w-2 rounded-full ${severityDot[selected.severity]}`} />
                    {selected.label}
                  </h2>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span>
                      {visible.length.toLocaleString()} shown · {reviewedHere} reviewed · {selected.total.toLocaleString()} total
                      {selected.total > selected.items.length && ` (first ${selected.items.length} listed)`}
                    </span>
                    <button type="button" onClick={() => void copyAll()} className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">
                      Copy shown
                    </button>
                  </div>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-500">{selected.description}</p>
              </header>
              {visible.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-zinc-400">
                  {selected.total === 0 ? "Nothing wrong here." : "Everything here is reviewed or filtered out."}
                </p>
              ) : (
                <ul>
                  {visible.slice(0, shown).map((item) => (
                    <ItemRow
                      key={item.key}
                      check={selected}
                      item={item}
                      canAct={data.can_act}
                      review={reviews[reviewId(selected, item)]}
                      onToggle={() => toggle(reviewId(selected, item))}
                      onNote={(note) => setNote(reviewId(selected, item), note)}
                    />
                  ))}
                </ul>
              )}
              {visible.length > shown && (
                <div className="border-t border-zinc-100 px-4 py-3 text-center">
                  <button type="button" onClick={() => setShown((n) => n + PAGE)} className="text-sm font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2">
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

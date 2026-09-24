import { useAuth } from "@clerk/react";
import { ArrowBigDown, ArrowBigUp, ChevronDown, Ellipsis, Flag, Link2, Minus, Pencil, Plus, Trash2, UserX, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import {
  COLLAPSE_SCORE, COMMENT_MAX, REPORT_REASONS, commentLink, commentSegments, deleteNode, insertReply, pickLabel,
  replyTarget, updateEvery, updateNode,
  type CommentNode, type CommentPick, type CommentSort, type DiscussionPage, type DiscussionThread, type ReportReason, type Viewer,
} from "../discussion";
import { exactTime, relativeAge } from "../format";
import { PANEL_SHELL } from "./FightStats";
import ProgressiveImage from "./ProgressiveImage";
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_QUIET, CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";

type GetToken = () => Promise<string | null>;
type RequestInit = { method?: string; body?: unknown; optional?: boolean };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

const primary = BUTTON_PRIMARY;
const quiet = BUTTON_QUIET;
const action = "inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40";
/** The writing box, and its signed-out and muted stand-ins. */
const box = "min-w-0 rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-zinc-400";
const SORTS: { id: CommentSort; label: string }[] = [{ id: "top", label: "Top" }, { id: "new", label: "New" }, { id: "old", label: "Old" }];
const message = (problem: unknown) => problem instanceof Error ? problem.message : "Something went wrong. Please retry.";
const noToken: GetToken = async () => null;

/** Every discussion request carries the reader's token when there is one, so
 *  their own votes and comments come back marked. Reads work without one. */
async function call<T>(getToken: GetToken, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken().catch(() => null);
  if (!init.optional && !token) throw new Error("Your session expired. Sign in again.");
  const response = await fetch(path, {
    method: init.method ?? "GET", cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${response.status}).`);
  return data as T;
}

type Discussion = {
  fightId: string;
  signedIn: boolean;
  signIn: () => void;
  viewer: Viewer | null;
  focus: string | null;
  replying: string | null;
  setReplying: (id: string | null) => void;
  post: (body: string, parentId: string | null) => Promise<void>;
  edit: (id: string, body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  vote: (node: CommentNode, value: -1 | 0 | 1) => void;
  block: (handle: string, blocked: boolean) => Promise<void>;
  expand: (rootId: string) => Promise<void>;
  report: (node: CommentNode) => void;
  notify: (text: string) => void;
};
const DiscussionContext = createContext<Discussion | null>(null);
const useDiscussion = () => useContext(DiscussionContext)!;

/** A fight's discussion: comments, replies to them, and replies to those. */
export default function FightDiscussion({ fightId }: { fightId: string }) {
  return accountsEnabled ? <WithAccount fightId={fightId} />
    : <DiscussionPanel fightId={fightId} getToken={noToken} signedIn={false} signIn={null} />;
}

function WithAccount({ fightId }: { fightId: string }) {
  const { getToken } = useAuth();
  const { isLoaded, user, signIn } = useAccount();
  if (!isLoaded) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">Loading discussion…</section>;
  // A different account is a different view of the same thread.
  return <DiscussionPanel key={user?.id ?? "guest"} fightId={fightId} getToken={getToken} signedIn={Boolean(user)} signIn={signIn} />;
}

type Meta = { total: number; threads: number; next: number; viewer: Viewer };

function DiscussionPanel({ fightId, getToken, signedIn, signIn }: {
  fightId: string; getToken: GetToken; signedIn: boolean; signIn: (() => void) | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const focus = new URLSearchParams(location.search).get("comment");
  const [sort, setSort] = useState<CommentSort>("top");
  const [comments, setComments] = useState<CommentNode[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replying, setReplying] = useState<string | null>(null);
  const [reporting, setReporting] = useState<CommentNode | null>(null);
  const [notice, setNotice] = useState("");
  const request: Request = useCallback((path, init) => call(getToken, path, init), [getToken]);
  const generation = useRef(0);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showAll = useCallback(() => {
    const search = new URLSearchParams(location.search);
    search.delete("comment");
    navigate({ search: `?${search}` }, { replace: true, state: location.state });
  }, [location.search, location.state, navigate]);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true); setError("");
    try {
      if (focus) {
        const data = await request<DiscussionThread>(`/api/comments/${encodeURIComponent(focus)}/thread?sort=${sort}`, { optional: true });
        if (mine !== generation.current) return;
        // A link to another bout's comment: show this bout's discussion instead.
        if (data.fightId !== fightId) { showAll(); return; }
        setComments([data.comment]);
        setMeta({ total: data.comment.replyCount + 1, threads: 1, next: 1, viewer: data.viewer });
      } else {
        const data = await request<DiscussionPage>(`/api/fights/${fightId}/comments?sort=${sort}`, { optional: true });
        if (mine !== generation.current) return;
        setComments(data.comments);
        setMeta({ total: data.total, threads: data.threads, next: data.pageSize, viewer: data.viewer });
      }
    } catch (problem) {
      if (mine === generation.current) setError(message(problem));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [fightId, focus, request, showAll, sort]);
  useEffect(() => { void load(); }, [load]);

  // A permalink opens scrolled to its comment, once.
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || !comments || scrolled.current === focus) return;
    const node = document.getElementById(`comment-${focus}`);
    if (node) { scrolled.current = focus; node.scrollIntoView({ block: "center" }); }
  }, [comments, focus]);

  const loadMore = async () => {
    if (!meta || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await request<DiscussionPage>(`/api/fights/${fightId}/comments?sort=${sort}&offset=${meta.next}`, { optional: true });
      // Comments posted meanwhile shift the pages; nothing is shown twice.
      setComments(current => {
        const seen = new Set((current ?? []).map(comment => comment.id));
        return [...(current ?? []), ...data.comments.filter(comment => !seen.has(comment.id))];
      });
      setMeta(current => current && { ...current, total: data.total, threads: data.threads, next: current.next + data.pageSize });
    } catch (problem) { setNotice(message(problem)); }
    finally { setLoadingMore(false); }
  };

  const discussion = useMemo<Discussion>(() => ({
    fightId, signedIn, focus, replying, setReplying,
    signIn: () => signIn?.(),
    viewer: meta?.viewer ?? null,
    notify: setNotice,
    post: async (body, parentId) => {
      const created = await request<CommentNode>(`/api/fights/${fightId}/comments`, { method: "POST", body: { body, parentId } });
      setComments(current => {
        if (!parentId) return [created, ...(current ?? [])];
        const [next, found] = insertReply(current ?? [], parentId, created);
        return found ? next : current;
      });
      setMeta(current => current && { ...current, total: current.total + 1, threads: current.threads + (parentId ? 0 : 1) });
      setReplying(null);
    },
    edit: async (id, body) => {
      const updated = await request<CommentNode>(`/api/comments/${id}`, { method: "PATCH", body: { body } });
      setComments(current => current && updateNode(current, id, node => ({ ...node, body: updated.body, editedAt: updated.editedAt, editable: updated.editable })));
    },
    remove: async id => {
      await request(`/api/comments/${id}`, { method: "DELETE" });
      setComments(current => current && deleteNode(current, id)[0]);
      setMeta(current => current && { ...current, total: Math.max(0, current.total - 1) });
    },
    vote: (node, value) => {
      if (!signedIn) { signIn?.(); return; }
      const apply = (vote: -1 | 0 | 1, score: number) =>
        setComments(current => current && updateNode(current, node.id, item => ({ ...item, myVote: vote, score })));
      // Shown at once; put back if the server says no.
      apply(value, node.score - node.myVote + value);
      request<{ score: number; myVote: -1 | 0 | 1 }>(`/api/comments/${node.id}/vote`, { method: "PUT", body: { value } })
        .then(result => apply(result.myVote, result.score))
        .catch(problem => { apply(node.myVote, node.score); setNotice(message(problem)); });
    },
    block: async (handle, blocked) => {
      await request(`/api/comments/blocks/${encodeURIComponent(handle)}`, { method: blocked ? "PUT" : "DELETE" });
      setComments(current => current && updateEvery(current, node => node.author?.handle === handle && !node.mine ? { ...node, blocked } : node));
      setNotice(blocked ? "Blocked. Their comments are collapsed for you, and they can’t reply to yours." : "Unblocked.");
    },
    expand: async rootId => {
      try {
        const data = await request<DiscussionThread>(`/api/comments/${rootId}/thread?sort=${sort}`, { optional: true });
        setComments(current => current && updateNode(current, rootId, () => data.comment));
      } catch (problem) { setNotice(message(problem)); }
    },
    report: node => { if (!signedIn) signIn?.(); else setReporting(node); },
  }), [fightId, focus, meta?.viewer, replying, request, signIn, signedIn, sort]);

  const viewer = meta?.viewer;
  const muted = viewer?.mutedUntil ?? null;
  return (
    <DiscussionContext.Provider value={discussion}>
      {!accountsEnabled ? (
        <div className={box}>
          <p className="px-4 py-3 text-sm leading-6 text-zinc-500">Sign-in must be configured to join the discussion.</p>
        </div>
      ) : !signedIn ? (
        <div className={box}>
          <button type="button" onClick={() => signIn?.()} className="block w-full px-4 pb-1 pt-3 text-left text-sm leading-6 text-zinc-400">Talk about the fight</button>
          <div className="flex justify-end px-2 pb-2">
            <button type="button" className={primary} onClick={() => signIn?.()}>Sign in to comment</button>
          </div>
        </div>
      ) : muted ? (
        <div className={box}>
          <p className="px-4 py-3 text-sm leading-6 text-amber-800" role="status">
            A moderator has paused your commenting {muted >= Number.MAX_SAFE_INTEGER ? "permanently" : `until ${new Date(muted).toLocaleString()}`}. You can still read and report.
          </p>
        </div>
      ) : (
        <Composer placeholder="Talk about the fight" submitLabel="Comment" onSubmit={body => discussion.post(body, null)} />
      )}

      <section className={PANEL_SHELL} aria-busy={loading}>
        <div className="flex items-center justify-end gap-2 border-b border-zinc-100 px-3 py-2 sm:px-4">
          {/* A permalink shows one thread; this goes back to the rest. */}
          {focus ? (
            <button type="button" onClick={showAll}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-800 transition-colors hover:bg-zinc-100">
              Show all threads
            </button>
          ) : null}
          <SortMenu sort={sort} onChange={setSort} />
        </div>
        {error && !comments ? (
          <p className="px-5 py-10 text-center text-sm text-rose-600">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>
        ) : !comments ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-400" role="status">Loading comments…</p>
        ) : !comments.length ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">No comments yet. Start the conversation.</p>
        ) : (
          <ul className={`divide-y divide-zinc-100 ${loading ? "opacity-60 transition-opacity" : ""}`}>
            {comments.map(node => <li key={node.id} className="px-3 py-3 sm:px-4"><Thread node={node} rootId={node.id} /></li>)}
          </ul>
        )}
        {!focus && meta && comments && meta.next < meta.threads ? (
          <div className="border-t border-zinc-100 px-5 py-3 text-center">
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={quiet}>
              {loadingMore ? "Loading…" : "Load more comments"}
            </button>
          </div>
        ) : null}
      </section>

      {notice ? (
        <div role="status" className="fixed inset-x-0 bottom-5 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {notice}
        </div>
      ) : null}
      <ReportDialog node={reporting} onClose={() => setReporting(null)} request={request} onBlock={discussion.block} />
    </DiscussionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// writing

function SortMenu({ sort, onChange }: { sort: CommentSort; onChange: (sort: CommentSort) => void }) {
  return (
    <label className="relative inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500">
      Sort by:
      <select value={sort} onChange={event => onChange(event.target.value as CommentSort)}
        className="cursor-pointer appearance-none rounded-full bg-transparent py-1 pl-1.5 pr-6 text-xs font-semibold text-zinc-800 outline-none transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-300">
        {SORTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
    </label>
  );
}

function Composer({ initial = "", placeholder, submitLabel, autoFocus = false, onSubmit, onCancel }: {
  initial?: string; placeholder: string; submitLabel: string; autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>; onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = field.current;
    if (!autoFocus || !node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [autoFocus]);
  // The box grows with what is written, up to half the screen, then scrolls.
  const fit = useCallback(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, []);
  useLayoutEffect(fit, [fit, text]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (!text.trim()) { setError("Write something first."); return; }
    setBusy(true); setError("");
    try { await onSubmit(text); setText(""); }
    catch (problem) { setError(message(problem)); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={event => void submit(event)} className={box}>
      <textarea
        ref={field}
        value={text}
        onChange={event => { setText(event.target.value); setError(""); }}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
          // Escape closes the matchup page; inside a text box it only cancels.
          if (event.key === "Escape") { event.stopPropagation(); onCancel?.(); }
        }}
        maxLength={COMMENT_MAX}
        rows={autoFocus || initial ? 2 : 1}
        placeholder={placeholder}
        aria-label={placeholder}
        className="block max-h-[50vh] w-full resize-none overflow-y-auto bg-transparent px-4 pb-1 pt-3 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400"
      />
      <div className="flex items-center gap-3 px-2 pb-2 pl-3">
        <p className="min-w-0 flex-1 text-[11px]" aria-live="polite">
          {error ? <span role="alert" className="text-rose-600">{error}</span>
            : text.length > COMMENT_MAX - 300 ? <span className="tabular-nums text-zinc-400">{text.length}/{COMMENT_MAX}</span> : null}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {onCancel ? <button type="button" onClick={onCancel} disabled={busy} className={quiet}>Cancel</button> : null}
          <button type="submit" disabled={busy || !text.trim()} className={primary}>{busy ? "Posting…" : submitLabel}</button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// reading

function ScorerAvatar({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const letter = name.slice(0, 1).toUpperCase();
    return <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-500 ring-1 ring-zinc-200">{/^[A-Z0-9]$/.test(letter) ? letter : "?"}</span>;
  }
  return <ProgressiveImage src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}
    className="h-6 w-6 shrink-0 rounded-full bg-zinc-100 object-cover ring-1 ring-zinc-200" />;
}

/** Plain text and @mentions. Nothing in a comment is ever rendered as markup. */
function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-800 [overflow-wrap:anywhere]">
      {commentSegments(text).map((segment, index) => "mention" in segment
        ? <Link key={index} to={`/profiles/${segment.mention.toLowerCase()}`} className="font-medium text-sky-700 hover:underline">@{segment.mention}</Link>
        : <span key={index}>{segment.text}</span>)}
    </p>
  );
}

const PICK_METHOD_WORDS = { ko: "KO/TKO", submission: "submission", decision: "decision" } as const;

/** What the author predicted, in their pick's corner colour. */
function PickTag({ pick }: { pick: CommentPick }) {
  const said = `Predicted ${pick.fighter}${pick.method ? ` by ${PICK_METHOD_WORDS[pick.method]}` : ""}${pick.round ? ` in round ${pick.round}` : ""}`;
  return (
    <span title={said} aria-label={said}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-[10px] font-semibold leading-4 tracking-wide ring-1 ring-inset ${pick.corner === 1 ? "bg-f1-soft text-f1-ink ring-f1/25" : "bg-f2-soft text-f2-ink ring-f2/25"}`}>
      {pickLabel(pick)}
    </span>
  );
}

function Votes({ node }: { node: CommentNode }) {
  const discussion = useDiscussion();
  const disabled = node.mine || node.state !== "visible" || Boolean(discussion.viewer?.mutedUntil);
  const title = node.mine ? "You can’t vote on your own comment" : undefined;
  return (
    <div className="flex items-center rounded-full bg-zinc-50" title={title}>
      <button type="button" aria-label="Upvote" aria-pressed={node.myVote === 1} disabled={disabled}
        onClick={() => discussion.vote(node, node.myVote === 1 ? 0 : 1)}
        className={`grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-zinc-100 disabled:hover:bg-transparent ${node.myVote === 1 ? "text-orange-700" : "text-zinc-400"}`}>
        <ArrowBigUp className={`h-4 w-4 ${node.myVote === 1 ? "fill-current" : ""}`} aria-hidden="true" />
      </button>
      <span className={`min-w-5 text-center text-[11px] font-semibold tabular-nums ${node.myVote === 1 ? "text-orange-700" : node.myVote === -1 ? "text-sky-700" : "text-zinc-600"}`} aria-label={`Score ${node.score}`}>
        {node.score}
      </span>
      <button type="button" aria-label="Downvote" aria-pressed={node.myVote === -1} disabled={disabled}
        onClick={() => discussion.vote(node, node.myVote === -1 ? 0 : -1)}
        className={`grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-zinc-100 disabled:hover:bg-transparent ${node.myVote === -1 ? "text-sky-700" : "text-zinc-400"}`}>
        <ArrowBigDown className={`h-4 w-4 ${node.myVote === -1 ? "fill-current" : ""}`} aria-hidden="true" />
      </button>
    </div>
  );
}

function Menu({ node, onEdit, onDelete }: { node: CommentNode; onEdit: () => void; onDelete: () => void }) {
  const discussion = useDiscussion();
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) setOpen(false); };
    // Captured so Escape closes the menu without also closing the matchup.
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const name = node.author?.displayName ?? "this person";
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50";
  const choose = (run: () => void) => () => { setOpen(false); run(); };
  const copy = () => {
    const url = `${window.location.origin}${commentLink(discussion.fightId, node.id)}`;
    navigator.clipboard?.writeText(url).then(() => discussion.notify("Link copied."), () => discussion.notify(url));
  };
  return (
    <div ref={anchor} className="relative">
      <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => {
        // Opens upward when there isn't room for it below.
        const rect = anchor.current?.getBoundingClientRect();
        setAbove(Boolean(rect && window.innerHeight - rect.bottom < 240 && rect.top > 240));
        setOpen(value => !value);
      }} className={action}>
        <Ellipsis className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" className={`absolute left-0 z-30 w-48 ${above ? "bottom-8" : "top-8"} overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg`}>
          <button type="button" role="menuitem" className={item} onClick={choose(copy)}><Link2 className="h-3.5 w-3.5" aria-hidden="true" />Copy link</button>
          {node.editable ? <button type="button" role="menuitem" className={item} onClick={choose(onEdit)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</button> : null}
          {node.mine ? <button type="button" role="menuitem" className={`${item} text-rose-600`} onClick={choose(onDelete)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete</button> : null}
          {!node.mine && node.author ? <>
            <button type="button" role="menuitem" className={item} onClick={choose(() => discussion.report(node))}><Flag className="h-3.5 w-3.5" aria-hidden="true" />Report</button>
            {discussion.signedIn ? (
              <button type="button" role="menuitem" className={item}
                onClick={choose(() => void discussion.block(node.author!.handle, !node.blocked).catch(problem => discussion.notify(message(problem))))}>
                <UserX className="h-3.5 w-3.5" aria-hidden="true" /><span className="truncate">{node.blocked ? "Unblock" : "Block"} {name}</span>
              </button>
            ) : null}
          </> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One comment with everything beneath it. */
function Thread({ node, rootId }: { node: CommentNode; rootId: string }) {
  const discussion = useDiscussion();
  const [collapsed, setCollapsed] = useState(node.blocked || node.score <= COLLAPSE_SCORE);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (node.blocked) setCollapsed(true); }, [node.blocked]);
  const gone = node.state === "deleted" || node.state === "removed";
  const focused = discussion.focus === node.id;
  const target = replyTarget(node);
  const replyingHere = discussion.replying === node.id;
  const age = relativeAge(node.createdAt) ?? "";
  const canReply = !gone && node.state !== "held" && !discussion.viewer?.mutedUntil;
  const reply = () => {
    if (!discussion.signedIn) { discussion.signIn(); return; }
    discussion.setReplying(replyingHere ? null : node.id);
  };
  const remove = async () => {
    setBusy(true);
    try { await discussion.remove(node.id); }
    catch (problem) { discussion.notify(message(problem)); setBusy(false); setConfirming(false); }
  };

  return (
    <div id={`comment-${node.id}`} className="scroll-mt-24">
      <div className={`-mx-1.5 rounded-lg px-1.5 py-1 ${focused ? "bg-amber-50 ring-1 ring-amber-200" : ""}`}>
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <button type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand comment" : "Collapse comment"}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            {collapsed ? <Plus className="h-3 w-3" aria-hidden="true" /> : <Minus className="h-3 w-3" aria-hidden="true" />}
          </button>
          {node.author ? (
            <Link to={`/profiles/${node.author.handle}`} className="flex min-w-0 items-center gap-1.5 font-semibold text-zinc-800 hover:underline">
              <ScorerAvatar src={node.author.imageUrl} name={node.author.displayName} />
              <span className="truncate">{node.author.displayName}</span>
            </Link>
          ) : <span className="font-medium italic text-zinc-400">{node.state === "removed" ? "Removed" : "Deleted"}</span>}
          {node.pick ? <PickTag pick={node.pick} /> : null}
          {node.mine ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">You</span> : null}
          {node.blocked ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">Blocked</span> : null}
          <span title={exactTime(node.createdAt) ?? undefined} className="shrink-0 text-zinc-400">{age}</span>
          {node.editedAt ? <span className="shrink-0 text-zinc-400" title={`Edited ${exactTime(node.editedAt) ?? ""}`}>· edited</span> : null}
          {collapsed ? (
            <span className="shrink-0 text-zinc-400">
              {node.score <= COLLAPSE_SCORE && !node.blocked ? "· below threshold " : ""}
              {node.replyCount ? `· ${node.replyCount} ${node.replyCount === 1 ? "reply" : "replies"}` : ""}
            </span>
          ) : null}
        </div>

        {collapsed ? null : (
          <div className="mt-1 pl-7">
            {gone ? <p className="text-sm italic text-zinc-400">{node.state === "removed" ? "Removed by a moderator." : "Deleted by its author."}</p>
              : node.state === "held" && node.body == null ? <p className="text-sm italic text-zinc-400">Hidden while a moderator reviews it.</p>
              : editing ? (
                <Composer initial={node.body ?? ""} placeholder="Edit your comment" submitLabel="Save" autoFocus
                  onSubmit={async body => { await discussion.edit(node.id, body); setEditing(false); }} onCancel={() => setEditing(false)} />
              ) : <>
                <Body text={node.body ?? ""} />
                {node.state === "held" ? <p className="mt-1 text-[11px] text-amber-700">Reported by several readers. Only you can see it until a moderator reviews it.</p> : null}
              </>}

            {!gone && !editing ? (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Votes node={node} />
                {canReply ? <button type="button" onClick={reply} className={action} aria-expanded={replyingHere}>Reply</button> : null}
                <Menu node={node} onEdit={() => setEditing(true)} onDelete={() => setConfirming(true)} />
              </div>
            ) : null}
            {confirming && !gone ? (
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs">
                <span className="mr-auto text-zinc-600">Delete this comment? This can’t be undone.</span>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={quiet}>Cancel</button>
                <button type="button" onClick={() => void remove()} disabled={busy} className={BUTTON_DANGER}>
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            ) : null}
            {replyingHere ? (
              <div className="mt-2">
                <Composer initial={target.prefill} placeholder={`Reply to ${node.author?.displayName ?? "this comment"}`} submitLabel="Reply" autoFocus
                  onSubmit={body => discussion.post(body, target.parentId)} onCancel={() => discussion.setReplying(null)} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {!collapsed && (node.replies.length || node.more) ? (
        <div className="ml-2.5 mt-1 border-l border-zinc-100 pl-3 sm:pl-4">
          <ul className="flex flex-col gap-2 pt-1">
            {node.replies.map(child => <li key={child.id}><Thread node={child} rootId={rootId} /></li>)}
          </ul>
          {node.more ? (
            <button type="button" onClick={() => void discussion.expand(rootId)} className={`${action} mt-1`}>
              {node.more} more {node.more === 1 ? "reply" : "replies"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// reporting

function ReportDialog({ node, onClose, request, onBlock }: {
  node: CommentNode | null; onClose: () => void; request: Request;
  onBlock: (handle: string, blocked: boolean) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (node && !element.open) {
      setReason(""); setNote(""); setError(""); setSent(false); setBlocked(node.blocked);
      element.showModal();
    } else if (!node && element.open) element.close();
  }, [node]);
  const close = () => { if (!busy) onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!node || busy) return;
    if (!reason) { setError("Choose a reason."); return; }
    setBusy(true); setError("");
    try {
      await request(`/api/comments/${node.id}/report`, { method: "POST", body: { reason, note } });
      setSent(true);
    } catch (problem) { setError(message(problem)); }
    finally { setBusy(false); }
  };
  const author = node?.author;
  return (
    <dialog ref={dialog} onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}
      className="search-dialog fixed inset-0 m-auto w-[min(28rem,calc(100%-2rem))] max-w-none rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className={DIALOG_TITLE}>Report comment</h2>
          {author ? <p className="mt-0.5 truncate text-xs text-zinc-500">by {author.displayName}</p> : null}
        </div>
        <button type="button" onClick={close} disabled={busy} aria-label="Close" className={`-mr-2 ${CLOSE_BUTTON}`}>
          <X className={CLOSE_ICON} aria-hidden="true" />
        </button>
      </div>
      {sent ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm font-semibold text-zinc-900">Thanks — a moderator will review it.</p>
          <p className="mt-1 text-sm text-zinc-500">Comments reported by several readers are hidden until they are reviewed.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {author && !blocked ? (
              <button type="button" className={quiet} onClick={() => void onBlock(author.handle, true).then(() => setBlocked(true), problem => setError(message(problem)))}>
                Block {author.displayName}
              </button>
            ) : null}
            <button type="button" onClick={close} className={primary}>Done</button>
          </div>
          {error ? <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p> : null}
        </div>
      ) : (
        <form onSubmit={event => void submit(event)} className="space-y-4 px-5 py-5">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-zinc-700">What’s wrong with it?</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {REPORT_REASONS.map(([value, label]) => (
                <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${reason === value ? "border-zinc-900 text-zinc-900" : "border-zinc-200 text-zinc-600 hover:border-zinc-300"}`}>
                  <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="accent-zinc-900" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-700">Anything else? <span className="font-normal text-zinc-400">(optional)</span></span>
            <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={3}
              className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400" />
          </label>
          {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 pt-4">
            <button type="button" onClick={close} disabled={busy} className={quiet}>Cancel</button>
            <button type="submit" disabled={busy || !reason} className={primary}>{busy ? "Sending…" : "Send report"}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

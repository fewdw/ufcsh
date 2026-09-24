import { useAuth } from "@clerk/react";
import { ArrowBigUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { commentLink, type ProfileComment, type ProfileCommentSort, type ProfileComments as CommentsData } from "../discussion";
import type { ScorerIdentity } from "../scoring";
import { exactTime, relativeAge } from "../format";
import { ConfirmRemove, RemoveX } from "./ConfirmRemove";
import { PANEL_SHELL, PanelHeading } from "./FightStats";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import { fetchPage, LIST_META, CLEAR_REMOVE, LIST_ROW, LoadMore, useInfiniteList } from "./InfiniteList";

/** Everything a fan has said in fight discussions, newest first. Listed to
 *  others only once they have chosen to show it; always to themselves. */
export default function ProfileComments({ handle, mine, visible, visibilityControl }: {
  handle: string; mine: boolean; visible: boolean;
  /** The owner's switch for showing this list to others. */
  visibilityControl?: React.ReactNode;
}) {
  const { getToken } = useAuth();
  const [sort, setSort] = useState<ProfileCommentSort>("new");
  const list = useInfiniteList({
    resetKey: `${handle}:${mine}:${visible}:${sort}`,
    load: async offset => {
      // The owner's token is what lets them read a list they keep private.
      const token = mine ? await getToken().catch(() => null) : null;
      return fetchPage<CommentsData>(`/api/profiles/${encodeURIComponent(handle)}/comments?sort=${sort}&offset=${offset}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }, "Comments could not be loaded.");
    },
    items: page => page.comments,
    itemKey: comment => comment.id,
  });
  const [confirming, setConfirming] = useState<ProfileComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const remove = async (comment: ProfileComment) => {
    if (busy) return;
    setBusy(true); setRemoveError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "That comment could not be removed.");
      setConfirming(null);
    } catch (problem) {
      setRemoveError(problem instanceof Error ? problem.message : "That comment could not be removed.");
    } finally {
      setBusy(false);
      void list.reload();
    }
  };

  const data = list.first;
  if (!data) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {list.error ? <>{list.error} <button type="button" className="underline" onClick={() => void list.retry()}>Retry</button></> : "Loading comments…"}
  </section>;

  return <>
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading
        title="Comments"
        subtitle={data.total ? data.total.toLocaleString() : undefined}
        aside={mine ? visibilityControl ?? (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${visible ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
            {visible ? "Visible on your profile" : "Only you can see this list"}
          </span>
        ) : null}
        controls={data.total > 1 ? <SortToggle sort={sort} onChange={setSort} /> : null}
      />
      {!data.total ? (
        <p className="px-5 py-10 text-center text-sm text-zinc-500">
          {mine ? "You haven’t commented yet. Open any fight and use its Discussion tab." : "No comments yet."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {list.items.map(comment => (
            <li key={comment.id} className="relative">
              <Link to={commentLink(comment.fightId, comment.id)} className={`block ${LIST_ROW} transition-colors hover:bg-zinc-50`}>
                <p className={`flex min-w-0 items-center gap-1.5 ${LIST_META} ${CLEAR_REMOVE(mine)}`}>
                  <span className="min-w-0 truncate font-semibold text-zinc-800">
                    {comment.fight ? `${comment.fight.f1_name} vs ${comment.fight.f2_name}` : "A fight"}
                  </span>
                  {comment.fight ? <span className="hidden min-w-0 truncate sm:inline">· {comment.fight.event_name}</span> : null}
                  <span className="shrink-0" title={exactTime(comment.createdAt) ?? undefined}>· {relativeAge(comment.createdAt)}</span>
                  {comment.depth > 1 ? <span className="shrink-0">· reply</span> : null}
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 font-semibold tabular-nums text-zinc-600">
                    <ArrowBigUp className="h-4 w-4" aria-hidden="true" />{comment.score}
                  </span>
                </p>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[15px] leading-6 text-zinc-900 [overflow-wrap:anywhere]">
                  {comment.body}
                </p>
                {comment.held ? <p className="mt-1 text-xs text-amber-700">Hidden from others while a moderator reviews it.</p> : null}
              </Link>
              {mine ? <RemoveX large label="Delete comment" onClick={() => { setConfirming(comment); setRemoveError(""); }} /> : null}
            </li>
          ))}
        </ul>
      )}
      <LoadMore list={list} />
    </section>
    {mine ? <BlockedPeople /> : null}
    {confirming ? <ConfirmRemove
      title="Delete this comment?"
      detail={confirming.body}
      busy={busy} error={removeError}
      onCancel={() => { setConfirming(null); setRemoveError(""); }}
      onConfirm={() => void remove(confirming)} /> : null}
  </>;
}

const SORTS: { id: ProfileCommentSort; label: string }[] = [{ id: "new", label: "Recent" }, { id: "top", label: "Popular" }];

function SortToggle({ sort, onChange }: { sort: ProfileCommentSort; onChange: (sort: ProfileCommentSort) => void }) {
  return (
    <div role="radiogroup" aria-label="Sort comments" className={`${segmentedGroup} w-fit`}>
      {SORTS.map(option => (
        <button key={option.id} type="button" role="radio" aria-checked={sort === option.id} onClick={() => onChange(option.id)}
          className={`min-h-8 rounded-full px-3.5 text-[13px] font-medium transition sm:min-h-7 sm:text-xs ${sort === option.id ? segmentedSelected : segmentedIdle}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Everyone the reader has blocked in discussions, and the way back. */
function BlockedPeople() {
  const { getToken } = useAuth();
  const [blocked, setBlocked] = useState<ScorerIdentity[] | null>(null);
  const [error, setError] = useState("");
  const request = useCallback(async (method: "GET" | "DELETE", handle = "") => {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    const response = await fetch(`/api/comments/blocks${handle ? `/${encodeURIComponent(handle)}` : ""}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Blocked people could not be loaded.");
    setBlocked((body as { blocked: ScorerIdentity[] }).blocked);
  }, [getToken]);
  useEffect(() => { request("GET").catch(problem => setError(problem instanceof Error ? problem.message : String(problem))); }, [request]);
  if (!blocked?.length && !error) return null;
  return (
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="Blocked people" subtitle={`${(blocked ?? []).length}`} />
      <p className="border-b border-zinc-100 px-5 py-2 text-xs text-zinc-500">Their comments are collapsed for you, and they can’t reply to yours.</p>
      {error ? <p role="alert" className="px-5 py-3 text-xs text-red-600">{error}</p> : null}
      <ul className="divide-y divide-zinc-100">
        {(blocked ?? []).map(person => (
          <li key={person.publicId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
            <Link to={`/profiles/${person.handle}`} className="min-w-0 truncate font-medium text-zinc-800 hover:underline">{person.displayName}</Link>
            <button type="button" onClick={() => request("DELETE", person.handle).catch(problem => setError(problem instanceof Error ? problem.message : String(problem)))}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

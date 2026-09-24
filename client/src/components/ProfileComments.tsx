import { useAuth } from "@clerk/react";
import { ArrowBigUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { commentLink, type ProfileComment, type ProfileComments as CommentsData } from "../discussion";
import type { ScorerIdentity } from "../scoring";
import { exactTime, relativeAge } from "../format";
import { ConfirmRemove, RemoveX } from "./ConfirmRemove";
import { PANEL_SHELL, PanelHeading } from "./FightStats";

/** Everything a fan has said in fight discussions, newest first. Listed to
 *  others only once they have chosen to show it; always to themselves. */
export default function ProfileComments({ handle, mine, visible, visibilityControl }: {
  handle: string; mine: boolean; visible: boolean;
  /** The owner's switch for showing this list to others. */
  visibilityControl?: React.ReactNode;
}) {
  const { getToken } = useAuth();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<CommentsData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
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
      // Step back a page when the last comment on this one went.
      if (data?.comments.length === 1 && offset > 0) setOffset(Math.max(0, offset - data.pageSize));
      else setAttempt(value => value + 1);
    } catch (problem) {
      setRemoveError(problem instanceof Error ? problem.message : "That comment could not be removed.");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    let current = true;
    setError("");
    (async () => {
      // The owner's token is what lets them read a list they keep private.
      const token = mine ? await getToken().catch(() => null) : null;
      const response = await fetch(`/api/profiles/${encodeURIComponent(handle)}/comments?offset=${offset}`, {
        cache: "no-store", signal: AbortSignal.timeout(20_000),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Comments could not be loaded.");
      if (current) setData(body as CommentsData);
    })().catch(problem => { if (current) setError(problem instanceof Error ? problem.message : "Comments could not be loaded."); });
    return () => { current = false; };
  }, [attempt, getToken, handle, mine, offset, visible]);

  if (!data) return <section className={`${PANEL_SHELL} p-5 text-sm text-zinc-500`} role="status">
    {error ? <>{error} <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>Retry</button></> : "Loading comments…"}
  </section>;

  return <>
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading
        title="Comments"
        subtitle={data.total ? `${offset + 1}–${Math.min(offset + data.pageSize, data.total)} of ${data.total.toLocaleString()}` : undefined}
        aside={mine ? visibilityControl ?? (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${visible ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
            {visible ? "Visible on your profile" : "Only you can see this list"}
          </span>
        ) : null}
      />
      {!data.total ? (
        <p className="px-5 py-10 text-center text-sm text-zinc-500">
          {mine ? "You haven’t commented yet. Open any fight and use its Discussion tab." : "No comments yet."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data.comments.map(comment => (
            <li key={comment.id} className="relative">
              <Link to={commentLink(comment.fightId, comment.id)} className={`block py-3 pl-4 transition-colors hover:bg-zinc-50 sm:pl-5 ${mine ? "pr-8" : "pr-4 sm:pr-5"}`}>
                <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="min-w-0 truncate font-semibold text-zinc-600">
                    {comment.fight ? `${comment.fight.f1_name} vs ${comment.fight.f2_name}` : "A fight"}
                  </span>
                  {comment.fight ? <span className="hidden min-w-0 truncate sm:inline">· {comment.fight.event_name}</span> : null}
                  <span className="shrink-0" title={exactTime(comment.createdAt) ?? undefined}>· {relativeAge(comment.createdAt)}</span>
                  {comment.depth > 1 ? <span className="shrink-0">· reply</span> : null}
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 tabular-nums text-zinc-500">
                    <ArrowBigUp className="h-3.5 w-3.5" aria-hidden="true" />{comment.score}
                  </span>
                </p>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-zinc-800 [overflow-wrap:anywhere]">
                  {comment.body}
                </p>
                {comment.held ? <p className="mt-1 text-[11px] text-amber-700">Hidden from others while a moderator reviews it.</p> : null}
              </Link>
              {mine ? <RemoveX label="Delete comment" onClick={() => { setConfirming(comment); setRemoveError(""); }} /> : null}
            </li>
          ))}
        </ul>
      )}
      {data.total > data.pageSize ? (
        <div className="flex justify-between border-t border-zinc-100 px-5 py-3 text-xs text-zinc-600">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pageSize))} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Newer</button>
          <button disabled={offset + data.pageSize >= data.total} onClick={() => setOffset(offset + data.pageSize)} className="rounded-full px-3 py-2 hover:bg-zinc-100 disabled:opacity-40">Older</button>
        </div>
      ) : null}
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
      <PanelHeading title="Blocked people" subtitle="Their comments are collapsed for you, and they can’t reply to yours." />
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

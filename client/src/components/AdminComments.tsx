import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRequest, useAdminResource } from "../admin";
import { commentLink, REPORT_REASONS, type CommentState } from "../discussion";
import type { ScorerIdentity } from "../scoring";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import { BUTTON_DANGER, BUTTON_SECONDARY } from "../ui";

type View = "reported" | "recent" | "removed" | "muted";
type Report = { reason: string; note: string; createdAt: number; status: "open" | "actioned" | "dismissed"; snapshot: string; reporter: ScorerIdentity };
type Moderated = {
  id: string; fightId: string; depth: number; body: string; state: CommentState;
  fight: { id: string; f1_name: string; f2_name: string; event_name: string; date: string } | null;
  createdAt: number; editedAt: number | null; score: number;
  removedAt: number | null; removedBy: string | null; removalReason: string | null;
  author: ScorerIdentity & { comments: number; removed: number; mutedUntil: number | null };
  reports: Report[]; openReports: number;
};
type Queue = { view: Exclude<View, "muted">; counts: { reported: number; held: number }; comments: Moderated[] };
type Sanctions = { sanctions: { scorer: ScorerIdentity; mutedUntil: number; permanent: boolean; reason: string; by: string; at: number }[] };

const REASON = Object.fromEntries(REPORT_REASONS) as Record<string, string>;
const STATE_TONE: Record<CommentState, string> = {
  visible: "bg-emerald-50 text-emerald-700", held: "bg-amber-50 text-amber-700",
  deleted: "bg-zinc-100 text-zinc-500", removed: "bg-rose-50 text-rose-700",
};
const STATE_LABEL: Record<CommentState, string> = { visible: "Visible", held: "Held for review", deleted: "Deleted by author", removed: "Removed" };
const MUTES = [[1, "1 hour"], [24, "24 hours"], [168, "7 days"], [720, "30 days"], [-1, "Permanently"]] as const;
const button = BUTTON_SECONDARY;
const until = (at: number | null, permanent = false) => permanent || (at != null && at >= Number.MAX_SAFE_INTEGER) ? "permanently" : at ? `until ${new Date(at).toLocaleString()}` : "";

function Row({ item, onDone }: { item: Moderated; onDone: () => void }) {
  const request = useAdminRequest();
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState<number>(24);
  const [purge, setPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (path: string, body: unknown) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await request(path, { method: "PUT", body }); onDone(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { setBusy(false); }
  };
  const tally = item.reports.filter(report => report.status === "open").reduce((counts, report) => {
    counts.set(report.reason, (counts.get(report.reason) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <Link to={`/profiles/${item.author.handle}`} className="font-semibold text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">{item.author.displayName}</Link>
        <span>{item.author.comments} comments · {item.author.removed} removed</span>
        {item.author.mutedUntil ? <span className="font-semibold text-rose-600">Muted {until(item.author.mutedUntil)}</span> : null}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_TONE[item.state]}`}>{STATE_LABEL[item.state]}</span>
        <span>Score {item.score}</span>
        <span>{new Date(item.createdAt).toLocaleString()}</span>
        {item.fight ? (
          <Link to={commentLink(item.fightId, item.id)} className="max-w-full truncate text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">
            {item.fight.f1_name} vs {item.fight.f2_name}
          </Link>
        ) : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800 [overflow-wrap:anywhere]">{item.body || <span className="italic text-zinc-400">No text kept.</span>}</p>
      {item.removedAt ? (
        <p className="mt-1 text-[11px] text-zinc-400">Removed by {item.removedBy ?? "an administrator"}{item.removalReason ? ` — ${item.removalReason}` : ""}</p>
      ) : null}

      {item.reports.length ? (
        <div className="mt-3 rounded-lg bg-zinc-50 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {[...tally].map(([key, count]) => (
              <span key={key} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-600 ring-1 ring-zinc-200">{REASON[key] ?? key} × {count}</span>
            ))}
            {!tally.size ? <span className="text-[11px] text-zinc-400">{item.reports.length} closed {item.reports.length === 1 ? "report" : "reports"}</span> : null}
          </div>
          <ul className="mt-2 space-y-1">
            {item.reports.filter(report => report.note || report.snapshot !== item.body).slice(0, 8).map((report, index) => (
              <li key={index} className="text-[11px] text-zinc-500">
                <span className="font-medium text-zinc-600">{report.reporter.displayName}</span> · {REASON[report.reason] ?? report.reason}
                {report.note ? `: “${report.note}”` : ""}
                {report.snapshot && report.snapshot !== item.body ? <span className="block text-zinc-400">When reported: “{report.snapshot}”</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
        {item.openReports || item.state === "held" ? (
          <button type="button" disabled={busy} className={button} onClick={() => void run(`/api/admin/comments/${item.id}`, { action: "dismiss" })}>Keep</button>
        ) : null}
        {item.state === "removed" ? (
          <button type="button" disabled={busy} className={button} onClick={() => void run(`/api/admin/comments/${item.id}`, { action: "restore" })}>Restore</button>
        ) : (
          <>
            <input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} placeholder="Reason (optional)"
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-zinc-400 sm:max-w-56" />
            <button type="button" disabled={busy} onClick={() => void run(`/api/admin/comments/${item.id}`, { action: "remove", reason })}
              className={BUTTON_DANGER}>Remove</button>
          </>
        )}
        <span className="mx-1 hidden h-5 w-px bg-zinc-200 sm:block" aria-hidden="true" />
        <select value={hours} onChange={event => setHours(Number(event.target.value))} aria-label="Mute length"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 pr-7 text-xs text-zinc-700">
          {MUTES.map(([value, label]) => <option key={value} value={value}>Mute {label.toLowerCase()}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <input type="checkbox" checked={purge} onChange={event => setPurge(event.target.checked)} className="accent-zinc-900" />
          and remove all their comments
        </label>
        <button type="button" disabled={busy} className={button}
          onClick={() => void run(`/api/admin/commenters/${item.author.handle}`, { hours, purge, reason })}>Mute author</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </li>
  );
}

function Muted() {
  const request = useAdminRequest();
  const { data, loading, error, reload } = useAdminResource<Sanctions>("/api/admin/commenters");
  const [problem, setProblem] = useState("");
  const lift = async (handle: string) => {
    setProblem("");
    try { await request(`/api/admin/commenters/${handle}`, { method: "PUT", body: { hours: 0 } }); await reload(true); }
    catch (failure) { setProblem(failure instanceof Error ? failure.message : String(failure)); }
  };
  if (loading && !data) return <p className="px-5 py-12 text-center text-sm text-zinc-400">Loading…</p>;
  if (error && !data) return <p className="px-5 py-12 text-center text-sm text-rose-600">{error}</p>;
  if (!data?.sanctions.length) return <p className="px-5 py-12 text-center text-sm text-zinc-500">Nobody is muted.</p>;
  return <>
    {problem ? <p role="alert" className="px-5 pt-3 text-xs text-rose-600">{problem}</p> : null}
    <ul className="divide-y divide-zinc-100">
      {data.sanctions.map(entry => (
        <li key={entry.scorer.publicId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 text-xs text-zinc-500">
            <Link to={`/profiles/${entry.scorer.handle}`} className="font-semibold text-zinc-800 underline decoration-zinc-300 underline-offset-2">{entry.scorer.displayName}</Link>
            <span> · muted {until(entry.mutedUntil, entry.permanent)} · by {entry.by || "an administrator"}</span>
            {entry.reason ? <span className="block text-zinc-400">{entry.reason}</span> : null}
          </div>
          <button type="button" className={button} onClick={() => void lift(entry.scorer.handle)}>Unmute</button>
        </li>
      ))}
    </ul>
  </>;
}

function QueueList({ view, onCounts }: { view: Exclude<View, "muted">; onCounts: (counts: Queue["counts"]) => void }) {
  const { data, loading, error, reload } = useAdminResource<Queue>(`/api/admin/comments?view=${view}`, 30_000);
  useEffect(() => { if (data) onCounts(data.counts); }, [data, onCounts]);
  if (loading && !data) return <p className="px-5 py-12 text-center text-sm text-zinc-400">Loading comments…</p>;
  if (error && !data) return <p className="px-5 py-12 text-center text-sm text-rose-600">{error}</p>;
  if (!data?.comments.length) {
    return <p className="px-5 py-12 text-center text-sm text-zinc-500">{view === "reported" ? "No reported comments. All clear." : "Nothing here."}</p>;
  }
  return <ul className="divide-y divide-zinc-100">{data.comments.map(item => <Row key={item.id} item={item} onDone={() => void reload(true)} />)}</ul>;
}

/** Fight discussions: what readers reported, what was posted lately, what
 *  was taken down, and who cannot post. */
export default function AdminComments() {
  const [view, setView] = useState<View>("reported");
  const [counts, setCounts] = useState<Queue["counts"] | null>(null);
  const views: { id: View; label: string }[] = [
    { id: "reported", label: counts ? `Reported (${counts.reported})` : "Reported" },
    { id: "recent", label: "Recent" }, { id: "removed", label: "Removed" }, { id: "muted", label: "Muted" },
  ];
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Discussion moderation</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {counts ? `${counts.reported} reported · ${counts.held} held until reviewed` : "Loading…"}
              {" · "}Comments reported by three established accounts are held automatically.
            </p>
          </div>
        </div>
        <div role="tablist" aria-label="Moderation views" className={`${segmentedGroup} mt-4 w-full`}>
          {views.map(option => (
            <button key={option.id} type="button" role="tab" aria-selected={view === option.id} onClick={() => setView(option.id)}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${view === option.id ? segmentedSelected : segmentedIdle}`}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {view === "muted" ? <Muted /> : <QueueList key={view} view={view} onCounts={setCounts} />}
    </section>
  );
}

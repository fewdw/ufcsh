import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAdminRequest, useAdminResource } from "../admin";

type Status = "open" | "reviewing" | "resolved" | "dismissed";
type Category = "problem" | "incorrect" | "missing" | "improvement" | "user" | "other";
type Flag = {
  id: string; createdAt: number; updatedAt: number; title: string; category: Category;
  message: string; pageUrl: string; status: Status; resolutionNote: string; updatedBy: string | null;
  reporter: { publicId: string; handle: string; displayName: string; imageUrl: string | null };
};
type Flags = { reports: Flag[]; total: number; counts: Record<Status, number> };

const CATEGORY: Record<Category, string> = {
  problem: "Broken", incorrect: "Incorrect", missing: "Missing", improvement: "Improvement", user: "User report", other: "Other",
};
const STATUS: Record<Status, string> = { open: "Open", reviewing: "Reviewing", resolved: "Resolved", dismissed: "Dismissed" };
const statusTone: Record<Status, string> = {
  open: "bg-rose-50 text-rose-700", reviewing: "bg-amber-50 text-amber-700",
  resolved: "bg-emerald-50 text-emerald-700", dismissed: "bg-zinc-100 text-zinc-500",
};

function FlagRow({ report, onChanged }: { report: Flag; onChanged: (report: Flag) => void }) {
  const request = useAdminRequest();
  const [status, setStatus] = useState<Status>(report.status);
  const [note, setNote] = useState(report.resolutionNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = status !== report.status || note !== report.resolutionNote;
  const save = async (next = status) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const updated = await request<Flag>(`/api/admin/flags/${report.id}`, { method: "PUT", body: { status: next, resolutionNote: note } });
      setStatus(updated.status); setNote(updated.resolutionNote); onChanged(updated);
    } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { setBusy(false); }
  };
  return <li className="px-4 py-4 sm:px-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-zinc-900">{report.title}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone[report.status]}`}>{STATUS[report.status]}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{CATEGORY[report.category]}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span>{new Date(report.createdAt).toLocaleString()}</span>
          <Link to={`/profiles/${report.reporter.handle}`} className="text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">{report.reporter.displayName}</Link>
          <Link to={report.pageUrl} className="max-w-full truncate text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">Open reported page</Link>
        </div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">{report.message}</p>
      </div>
      <button type="button" disabled={busy || report.status === "resolved"} onClick={() => { setStatus("resolved"); void save("resolved"); }}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40">
        Mark fixed
      </button>
    </div>
    <div className="mt-4 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <select value={status} onChange={event => setStatus(event.target.value as Status)}
        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 pr-7 text-xs text-zinc-700">
        {(Object.keys(STATUS) as Status[]).map(value => <option key={value} value={value}>{STATUS[value]}</option>)}
      </select>
      <input value={note} onChange={event => setNote(event.target.value)} maxLength={2000} placeholder="Admin note or what was fixed"
        className="min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 outline-none focus:border-zinc-400" />
      <button type="button" onClick={() => void save()} disabled={busy || !changed}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
    {error ? <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p> : null}
    {report.updatedBy ? <p className="mt-2 text-[10px] text-zinc-400">Last handled by {report.updatedBy}</p> : null}
  </li>;
}

export default function AdminFlags() {
  const { data, loading, error, reload, setData } = useAdminResource<Flags>("/api/admin/flags", 15_000);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("open");
  const [category, setCategory] = useState<Category | "all">("all");
  const reports = useMemo(() => (data?.reports ?? []).filter(report => {
    if (status !== "all" && report.status !== status) return false;
    if (category !== "all" && report.category !== category) return false;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const value = [report.title, report.message, report.pageUrl, report.category, report.status,
      report.reporter.displayName, report.resolutionNote, report.updatedBy ?? ""].join(" ").toLowerCase();
    return words.every(word => value.includes(word));
  }), [category, data, query, status]);
  const changed = (updated: Flag) => setData(current => current ? {
    ...current,
    reports: current.reports.map(report => report.id === updated.id ? updated : report),
    counts: current.reports.reduce((counts, report) => {
      const state = report.id === updated.id ? updated.status : report.status;
      counts[state]++;
      return counts;
    }, { open: 0, reviewing: 0, resolved: 0, dismissed: 0 } as Record<Status, number>),
  } : current);

  return <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
    <div className="border-b border-zinc-100 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Reported issues</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{data ? `${data.counts.open + data.counts.reviewing} need attention · ${data.total} total` : "Loading reports…"}</p>
        </div>
        <button type="button" onClick={() => void reload()} className="text-xs text-zinc-500 underline underline-offset-2">Refresh</button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_9rem_10rem]">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title, message, user or page…"
          className="min-w-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs outline-none focus:border-zinc-400" />
        <select value={status} onChange={event => setStatus(event.target.value as Status | "all")}
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 pr-7 text-xs text-zinc-700">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS) as Status[]).map(value => <option key={value} value={value}>{STATUS[value]} ({data?.counts[value] ?? 0})</option>)}
        </select>
        <select value={category} onChange={event => setCategory(event.target.value as Category | "all")}
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 pr-7 text-xs text-zinc-700">
          <option value="all">All categories</option>
          {(Object.keys(CATEGORY) as Category[]).map(value => <option key={value} value={value}>{CATEGORY[value]}</option>)}
        </select>
      </div>
    </div>
    {loading && !data ? <p className="px-5 py-12 text-center text-sm text-zinc-400">Loading reports…</p>
      : error && !data ? <p className="px-5 py-12 text-center text-sm text-rose-600">{error}</p>
        : reports.length ? <ul className="divide-y divide-zinc-100">{reports.map(report => <FlagRow key={report.id} report={report} onChanged={changed} />)}</ul>
          : <p className="px-5 py-12 text-center text-sm text-zinc-500">No reports match these filters.</p>}
  </section>;
}

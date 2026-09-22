import { useAuth } from "@clerk/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";

const CATEGORIES = [
  ["problem", "Something is broken"],
  ["incorrect", "Incorrect information"],
  ["missing", "Missing information"],
  ["improvement", "Improvement"],
  ["user", "Report a user"],
  ["other", "Other"],
] as const;

export default function ReportIssueDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { getToken } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("problem");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setCategory("problem"); setMessage(""); setSubject(""); setError(""); setSent(false);
      node.showModal();
      requestAnimationFrame(() => title.current?.focus());
    } else if (!open && node.open) node.close();
  }, [open]);

  const close = () => { if (!busy) { dialog.current?.close(); onClose(); } };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: subject, category, message, pageUrl: window.location.pathname + window.location.search }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Unable to send this report.");
      setSent(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to send this report.");
    } finally { setBusy(false); }
  };

  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}
    className="search-dialog fixed inset-0 m-auto w-[min(32rem,calc(100%-2rem))] max-w-none rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl">
    <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
      <div>
        <h2 className="text-base font-semibold">Report an issue</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Tell us what needs attention on this page.</p>
      </div>
      <button type="button" onClick={close} disabled={busy} aria-label="Close report form"
        className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 disabled:opacity-40">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
    {sent ? <div className="px-5 py-8 text-center">
      <p className="text-sm font-semibold text-zinc-900">Report sent</p>
      <p className="mt-1 text-sm text-zinc-500">An administrator can now review it.</p>
      <button type="button" onClick={close} className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700">Close</button>
    </div> : <form onSubmit={event => void submit(event)} className="space-y-4 px-5 py-5">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-zinc-700">Title</span>
        <input ref={title} required minLength={3} maxLength={100} value={subject} onChange={event => setSubject(event.target.value)}
          placeholder="Short summary" className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-zinc-700">Category</span>
        <select value={category} onChange={event => setCategory(event.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 pr-8 text-sm outline-none focus:border-zinc-400">
          {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-zinc-700">Message</span>
        <textarea required minLength={10} maxLength={3000} rows={6} value={message} onChange={event => setMessage(event.target.value)}
          placeholder="What happened, what is wrong, or what could be better? Include names or details that will help us find it."
          className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400" />
        <span className="mt-1 block text-right text-[10px] tabular-nums text-zinc-400">{message.length}/3000</span>
      </label>
      {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}
      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 pt-4">
        <button type="button" onClick={close} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-40">Cancel</button>
        <button type="submit" disabled={busy} className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-40">
          {busy ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>}
  </dialog>;
}

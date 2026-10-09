import { useAuth } from "@clerk/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import { Button } from "./arc/button/button";

const CATEGORIES = [
  ["problem", "Something is broken"],
  ["incorrect", "Incorrect information"],
  ["missing", "Missing information"],
  ["improvement", "Improvement"],
  ["user", "Report a user"],
  ["other", "Other"],
] as const;

/** The report form, as a dialog over the page it's about. */
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

  const close = () => {
    if (busy) return;
    dialog.current?.close();
    onClose();
  };
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

  const body = <>
    <div className="flex items-center justify-between border-b border-line-subtle px-5 py-4">
      <div>
        <h2 className={DIALOG_TITLE}>Report an issue</h2>
        <p className="mt-0.5 text-xs text-muted">Tell us what needs attention on this page.</p>
      </div>
      <button type="button" onClick={close} disabled={busy} aria-label="Close report form" className={`-mr-2 ${CLOSE_BUTTON}`}>
        <X className={CLOSE_ICON} aria-hidden="true" />
      </button>
    </div>
    {sent ? <div className="px-5 py-8 text-center">
      <p className="text-sm font-medium text-foreground">Report sent</p>
      <p className="mt-1 text-sm text-muted">An administrator can now review it.</p>
      <Button variant="secondary" size="sm" onClick={close} className="mt-5">Close</Button>
    </div> : <form onSubmit={event => void submit(event)} className="space-y-4 px-5 py-5">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-secondary">Title</span>
        <input ref={title} required minLength={3} maxLength={100} value={subject} onChange={event => setSubject(event.target.value)}
          placeholder="Short summary" className="min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-foreground" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-secondary">Category</span>
        <select value={category} onChange={event => setCategory(event.target.value)}
          className="min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 pr-8 text-sm outline-none focus:border-foreground">
          {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-secondary">Message</span>
        <textarea required minLength={10} maxLength={3000} rows={6} value={message} onChange={event => setMessage(event.target.value)}
          placeholder="What happened, what is wrong, or what could be better? Include names or details that will help us find it."
          className="w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-foreground" />
        <span className="mt-1 block text-right text-[10px] tabular-nums text-muted">{message.length}/3000</span>
      </label>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      <div className="flex items-center justify-end gap-2 border-t border-line-subtle pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" loading={busy}>Send report</Button>
      </div>
    </form>}
  </>;
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}
    className="search-dialog fixed inset-0 m-auto w-[min(32rem,calc(100%-2rem))] max-w-none rounded-2xl border border-line bg-surface p-0 text-foreground shadow-2xl">
    {body}
  </dialog>;
}


import { useState } from "react";
import { useAdminRequest, useAdminResource, type AdminRecord } from "../admin";
import { BUTTON_PRIMARY } from "../ui";

const when = (at: number | null) => at == null ? "—" : new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * Who can open this panel. One address is fixed in the server's environment
 * and cannot be removed from here by anyone, including itself — that is what
 * makes locking yourself out impossible. Everyone else is a row in the
 * database, and a removal takes effect on their very next request.
 */
export default function AdminAdmins({ email }: { email: string | null }) {
  const request = useAdminRequest();
  const { data, error, loading, reload, setData } = useAdminResource<{ admins: AdminRecord[] }>("/api/admin/admins");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const change = async (init: { method: string; path: string; body?: unknown }) => {
    setBusy(true);
    setFailed(null);
    try {
      const body = await request<{ admins: AdminRecord[] }>(init.path, { method: init.method, body: init.body });
      setData(body);
      setValue("");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const admins = data?.admins ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium tracking-tight text-foreground">Administrators</h2>
        <p className="text-xs text-muted">
          Access is by the verified email on a Clerk account. Someone added here must sign in with that exact address.
        </p>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={event => {
          event.preventDefault();
          if (value.trim()) void change({ method: "POST", path: "/api/admin/admins", body: { email: value.trim() } });
        }}
      >
        <input
          type="email"
          value={value}
          onChange={event => setValue(event.target.value)}
          placeholder="name@example.com"
          autoComplete="off"
          className="w-64 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-line-strong"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className={BUTTON_PRIMARY}
        >
          {busy ? "Saving…" : "Add administrator"}
        </button>
      </form>
      {failed ? <p className="rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">{failed}</p> : null}

      {loading && !data ? (
        <div role="status" className="py-10 text-center text-sm text-muted">Loading administrators…</div>
      ) : error && !data ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted">
          <p>Couldn’t load the list. {error}</p>
          <button type="button" onClick={() => void reload()} className="font-medium text-foreground underline">Retry</button>
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line bg-surface">
          {admins.map(admin => (
            <li key={admin.email} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {admin.email}
                  {admin.email === email ? <span className="ml-2 text-[11px] font-normal text-muted">you</span> : null}
                </p>
                <p className="text-[11px] text-muted">
                  {admin.removable
                    ? `Added ${when(admin.addedAt)}${admin.addedBy ? ` by ${admin.addedBy}` : ""}`
                    : "Set in the server environment · permanent"}
                </p>
              </div>
              {admin.removable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void change({ method: "DELETE", path: `/api/admin/admins?email=${encodeURIComponent(admin.email)}` })}
                  className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-subtle disabled:opacity-50"
                >
                  Remove
                </button>
              ) : (
                <span className="rounded-full bg-surface-strong px-2 py-0.5 text-[11px] font-medium text-muted">Permanent</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

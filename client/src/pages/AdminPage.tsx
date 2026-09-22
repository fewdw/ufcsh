import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { useSeo } from "../seo";

const AdminBugs = lazy(() => import("../components/AdminBugs"));
const AdminLive = lazy(() => import("../components/AdminLive"));
const AdminAdmins = lazy(() => import("../components/AdminAdmins"));
const AdminFlags = lazy(() => import("../components/AdminFlags"));

const TABS = [
  { id: "bugs", label: "Bugs" },
  { id: "live", label: "Live rounds" },
  { id: "admin", label: "Admins" },
  { id: "flags", label: "Flags" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      {children ? <div className="text-sm text-zinc-500">{children}</div> : null}
    </div>
  );
}

/** The panel itself, mounted only once there is an account to identify. */
function AdminShell({ tab, onTab }: { tab: TabId; onTab: (next: TabId) => void }) {
  const { data, error, loading } = useAdminResource<AdminSession>("/api/admin/session");

  if (loading && !data) return <div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Checking access…</div>;
  if (!data?.admin) {
    return (
      <Notice title="This account is not an administrator.">
        {data?.email ? <p>Signed in as {data.email}.</p> : null}
        {error ? <p className="mt-1 text-xs text-zinc-400">{error}</p> : null}
      </Notice>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-zinc-900">Admin</h1>
          <p className="text-xs text-zinc-500">{data.email}</p>
        </div>
        <div role="tablist" aria-label="Admin sections" className={`${segmentedGroup} w-full`}>
          {TABS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`admin-tab-${item.id}`}
              aria-controls="admin-tabpanel"
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => onTab(item.id)}
              onKeyDown={event => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const next = (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
                onTab(TABS[next].id);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              }}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${tab === item.id ? segmentedSelected : segmentedIdle}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
          <Suspense fallback={<div role="status" className="py-16 text-center text-sm text-zinc-400">Loading…</div>}>
            {tab === "bugs" ? <AdminBugs /> : null}
            {tab === "live" ? <AdminLive /> : null}
            {tab === "admin" ? <AdminAdmins email={data.email} /> : null}
            {tab === "flags" ? <AdminFlags /> : null}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  useSeo({ title: "Admin", description: "Site administration.", path: "/admin" });
  const [params, setParams] = useSearchParams();
  const { isLoaded, user, signIn } = useAccount();
  const requested = params.get("tab");
  const tab = (TABS.find(item => item.id === requested)?.id ?? "bugs") as TabId;
  const onTab = (next: TabId) => {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    setParams(search, { replace: true });
  };

  if (!accountsEnabled) return <Notice title="Accounts are not configured." >Set a Clerk publishable key to use the admin panel.</Notice>;
  if (!isLoaded) return <div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Loading…</div>;
  if (!user) {
    return (
      <Notice title="Sign in to continue.">
        <button type="button" onClick={signIn} className="mt-2 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700">
          Sign in
        </button>
      </Notice>
    );
  }
  return <AdminShell tab={tab} onTab={onTab} />;
}

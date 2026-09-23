import { lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { useSeo } from "../seo";

const AdminHealth = lazy(() => import("../components/AdminHealth"));
const AdminBugs = lazy(() => import("../components/AdminBugs"));
const AdminLive = lazy(() => import("../components/AdminLive"));
const AdminAdmins = lazy(() => import("../components/AdminAdmins"));
const AdminFlags = lazy(() => import("../components/AdminFlags"));
const AdminComments = lazy(() => import("../components/AdminComments"));

const TABS = [
  { id: "health", label: "Health" },
  { id: "bugs", label: "Bugs" },
  { id: "live", label: "Live rounds" },
  { id: "admin", label: "Admins" },
  { id: "flags", label: "Flags" },
  { id: "comments", label: "Comments" },
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
  // The server said no: there is nothing here for this reader, so send them home.
  if (data && !data.admin) return <Navigate to="/" replace />;
  if (!data?.admin) {
    return (
      <Notice title="Couldn't check access.">
        {error ? <p className="mt-1 text-xs text-zinc-400">{error}</p> : null}
      </Notice>
    );
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-3 px-2 py-3 sm:gap-4 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-zinc-900">Admin</h1>
          <p className="text-xs text-zinc-500">{data.email}</p>
        </div>
        <div role="tablist" aria-label="Admin sections" className={`${segmentedGroup} w-full gap-0.5 overflow-x-auto p-0.5 sm:gap-1 sm:p-1`}>
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
              className={`flex-auto whitespace-nowrap rounded-full px-1.5 py-1.5 text-xs font-medium transition min-[400px]:px-2 sm:px-3 ${tab === item.id ? segmentedSelected : segmentedIdle}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
          <Suspense fallback={<div role="status" className="py-16 text-center text-sm text-zinc-400">Loading…</div>}>
            {tab === "health" ? <AdminHealth /> : null}
            {tab === "bugs" ? <AdminBugs /> : null}
            {tab === "live" ? <AdminLive /> : null}
            {tab === "admin" ? <AdminAdmins email={data.email} /> : null}
            {tab === "flags" ? <AdminFlags /> : null}
            {tab === "comments" ? <AdminComments /> : null}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  useSeo({ title: "Admin", description: "Site administration.", path: "/admin" });
  const [params, setParams] = useSearchParams();
  const { isLoaded, user } = useAccount();
  const requested = params.get("tab");
  const tab = (TABS.find(item => item.id === requested)?.id ?? "health") as TabId;
  const onTab = (next: TabId) => {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    setParams(search, { replace: true });
  };

  // Without an account there is no way to be an administrator.
  if (!accountsEnabled) return <Navigate to="/" replace />;
  if (!isLoaded) return <div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Loading…</div>;
  if (!user) return <Navigate to="/" replace />;
  return <AdminShell tab={tab} onTab={onTab} />;
}

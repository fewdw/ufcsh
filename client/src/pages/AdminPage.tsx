import { lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { useSeo } from "../seo";
import { PANEL_SHELL } from "../components/FightStats";

const AdminOverview = lazy(() => import("../components/AdminOverview"));
const AdminTraffic = lazy(() => import("../components/AdminTraffic"));
const AdminServer = lazy(() => import("../components/AdminServer"));
const AdminSync = lazy(() => import("../components/AdminSync"));
const AdminBugs = lazy(() => import("../components/AdminBugs"));
const AdminLive = lazy(() => import("../components/AdminLive"));
const AdminAccounts = lazy(() => import("../components/AdminAccounts"));
const AdminFlags = lazy(() => import("../components/AdminFlags"));
const AdminComments = lazy(() => import("../components/AdminComments"));
const AdminSettings = lazy(() => import("../components/AdminSettings"));

/** The sidebar, in groups. `?tab=` names the section, so each is a link. */
const GROUPS = [
  { label: "Site", tabs: [
    { id: "overview", label: "Overview" },
    { id: "traffic", label: "Traffic" },
    { id: "server", label: "Server" },
  ] },
  { label: "Data", tabs: [
    { id: "sync", label: "Sync" },
    { id: "bugs", label: "Bugs" },
    { id: "live", label: "Live rounds" },
  ] },
  { label: "People", tabs: [
    { id: "accounts", label: "Accounts" },
    { id: "comments", label: "Comments" },
    { id: "flags", label: "Flags" },
  ] },
  { label: "Admin", tabs: [
    { id: "settings", label: "Settings" },
  ] },
] as const;
type TabId = (typeof GROUPS)[number]["tabs"][number]["id"];
const TABS: { id: TabId; label: string }[] = GROUPS.flatMap(group => [...group.tabs]);
/** A raised card in both themes (a dark fill would vanish into the dark page). */
const SELECTED = "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200";
/** Addresses from before the sidebar keep working. */
const RENAMED: Record<string, TabId> = { health: "overview", admin: "settings" };

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

  // The page itself never scrolls: the sidebar stays put and each section
  // scrolls inside the space beside it (under it, on a phone). Wide, Bugs
  // splits that space into its own scrolling sections.
  const fills = tab === "bugs";
  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-7xl flex-col gap-3 px-2 pt-3 sm:px-5 sm:pt-4 md:flex-row md:gap-5">
      <nav aria-label="Admin sections" className="shrink-0 md:w-44">
        <div className={`${PANEL_SHELL} p-1.5 md:hidden`}>
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map(item => (
              <button key={item.id} type="button" onClick={() => onTab(item.id)} aria-current={tab === item.id ? "page" : undefined}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === item.id ? SELECTED : "text-zinc-600 hover:bg-zinc-100"}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden flex-col gap-4 md:flex">
          {GROUPS.map(group => (
            <div key={group.label}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{group.label}</p>
              <ul className="flex flex-col gap-0.5">
                {group.tabs.map(item => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onTab(item.id)} aria-current={tab === item.id ? "page" : undefined}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm ${tab === item.id ? `${SELECTED} font-semibold` : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}>
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <main
        id="admin-section"
        aria-label={TABS.find(item => item.id === tab)?.label}
        className={`min-h-0 min-w-0 flex-1 overscroll-y-contain overflow-x-hidden ${fills ? "overflow-y-auto pb-6 md:flex md:flex-col md:overflow-y-visible md:pb-4" : "overflow-y-auto pb-6"}`}
      >
        <Suspense fallback={<div role="status" className="py-16 text-center text-sm text-zinc-400">Loading…</div>}>
          {tab === "overview" ? <AdminOverview /> : null}
          {tab === "traffic" ? <AdminTraffic /> : null}
          {tab === "server" ? <AdminServer /> : null}
          {tab === "sync" ? <AdminSync /> : null}
          {tab === "bugs" ? <AdminBugs /> : null}
          {tab === "live" ? <AdminLive /> : null}
          {tab === "accounts" ? <AdminAccounts /> : null}
          {tab === "comments" ? <AdminComments /> : null}
          {tab === "flags" ? <AdminFlags /> : null}
          {tab === "settings" ? <AdminSettings email={data.email} /> : null}
        </Suspense>
      </main>
    </div>
  );
}

export default function AdminPage() {
  useSeo({ title: "Admin", description: "Site administration.", path: "/admin" });
  const [params, setParams] = useSearchParams();
  const { isLoaded, user } = useAccount();
  const requested = params.get("tab") ?? "";
  const tab = (TABS.find(item => item.id === requested)?.id ?? RENAMED[requested] ?? "overview") as TabId;
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

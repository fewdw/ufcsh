import { lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { useSeo } from "../seo";
import { PANEL_SHELL } from "../components/FightStats";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

const AdminOverview = lazy(() => import("../components/AdminOverview"));
const AdminErrors = lazy(() => import("../components/AdminErrors"));
const AdminSlow = lazy(() => import("../components/AdminSlow"));
const AdminTraffic = lazy(() => import("../components/AdminTraffic"));
const AdminServer = lazy(() => import("../components/AdminServer"));
const AdminBugs = lazy(() => import("../components/AdminBugs"));
const AdminLive = lazy(() => import("../components/AdminLive"));
const AdminAccounts = lazy(() => import("../components/AdminAccounts"));
const AdminFlags = lazy(() => import("../components/AdminFlags"));
const AdminComments = lazy(() => import("../components/AdminComments"));
const AdminSettings = lazy(() => import("../components/AdminSettings"));

/** The sidebar, most important first. A section with views opens on its
 *  first; `?tab=` and `?view=` name them, so each is a link. */
const SECTIONS = [
  { id: "overview", label: "Overview", views: [] },
  { id: "errors", label: "Errors", views: [] },
  { id: "slow", label: "Slow requests", views: [] },
  { id: "people", label: "People", views: [["accounts", "Accounts"], ["comments", "Comments"], ["flags", "Flags"]] },
  { id: "data", label: "Data", views: [["bugs", "Bugs"], ["live", "Live rounds"]] },
  { id: "traffic", label: "Traffic", views: [["visitors", "Visitors"], ["server", "Server"]] },
  { id: "settings", label: "Settings", views: [] },
] as const satisfies readonly { id: string; label: string; views: readonly (readonly [string, string])[] }[];
type TabId = (typeof SECTIONS)[number]["id"];
type Place = { tab: TabId; view: string | null };
/** A raised card in both themes (a dark fill would vanish into the dark page). */
const SELECTED = "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200";
/** Addresses from before this layout keep working. */
const MOVED: Record<string, Place> = {
  health: { tab: "overview", view: null }, sync: { tab: "errors", view: null }, server: { tab: "traffic", view: "server" },
  bugs: { tab: "data", view: "bugs" }, live: { tab: "data", view: "live" },
  accounts: { tab: "people", view: "accounts" }, comments: { tab: "people", view: "comments" }, flags: { tab: "people", view: "flags" },
  admin: { tab: "settings", view: null },
};
function place(tab: string, view: string | null): { tab: TabId; view: string | null } {
  const moved = MOVED[tab];
  const found = SECTIONS.find(item => item.id === (moved?.tab ?? tab)) ?? SECTIONS[0];
  const views: readonly (readonly [string, string])[] = found.views;
  const wanted = moved?.view ?? view;
  return { tab: found.id, view: views.length ? (views.find(([id]) => id === wanted) ?? views[0])[0] : null };
}

function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      {children ? <div className="text-sm text-zinc-500">{children}</div> : null}
    </div>
  );
}

/** The panel itself, mounted only once there is an account to identify. */
function AdminShell({ tab, view, onPlace }: { tab: TabId; view: string | null; onPlace: (tab: TabId, view?: string) => void }) {
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
  const fills = tab === "data" && view === "bugs";
  const views: readonly (readonly [string, string])[] = SECTIONS.find(item => item.id === tab)!.views;
  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-7xl flex-col gap-3 md:flex-row md:gap-5">
      <nav aria-label="Admin sections" className="shrink-0 md:w-40">
        <ul className={`${PANEL_SHELL} flex gap-1 overflow-x-auto p-1.5 md:flex-col md:gap-0.5 md:overflow-visible md:border-0 md:bg-transparent md:p-0 md:shadow-none`}>
          {SECTIONS.map(item => (
            <li key={item.id} className="shrink-0">
              <button type="button" onClick={() => onPlace(item.id)} aria-current={tab === item.id ? "page" : undefined}
                className={`w-full rounded-lg px-3 py-1.5 text-left text-xs md:text-sm ${tab === item.id ? `${SELECTED} font-semibold` : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main
        id="admin-section"
        aria-label={SECTIONS.find(item => item.id === tab)?.label}
        className={`flex min-h-0 min-w-0 flex-1 flex-col gap-3 overscroll-y-contain overflow-x-hidden ${fills ? "overflow-y-auto pb-6 md:overflow-y-visible md:pb-4" : "overflow-y-auto pb-6"}`}
      >
        {views.length ? (
          <div className={`${segmentedGroup} shrink-0 self-start`} role="tablist" aria-label="Views">
            {views.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => onPlace(tab, id)}
                className={`${segmentedOption} ${view === id ? segmentedSelected : segmentedIdle}`}>{label}</button>
            ))}
          </div>
        ) : null}
        <Suspense fallback={<div role="status" className="py-16 text-center text-sm text-zinc-400">Loading…</div>}>
          {tab === "overview" ? <AdminOverview /> : null}
          {tab === "errors" ? <AdminErrors /> : null}
          {tab === "slow" ? <AdminSlow /> : null}
          {view === "accounts" ? <AdminAccounts /> : null}
          {view === "comments" ? <AdminComments /> : null}
          {view === "flags" ? <AdminFlags /> : null}
          {view === "bugs" ? <AdminBugs /> : null}
          {view === "live" ? <AdminLive /> : null}
          {view === "visitors" ? <AdminTraffic /> : null}
          {view === "server" ? <AdminServer /> : null}
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
  const { tab, view } = place(params.get("tab") ?? "", params.get("view"));
  const onPlace = (next: TabId, nextView?: string) => {
    const search = new URLSearchParams(params);
    search.set("tab", next);
    if (nextView) search.set("view", nextView); else search.delete("view");
    setParams(search, { replace: true });
  };

  // Without an account there is no way to be an administrator.
  if (!accountsEnabled) return <Navigate to="/" replace />;
  if (!isLoaded) return <div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Loading…</div>;
  if (!user) return <Navigate to="/" replace />;
  return <AdminShell tab={tab} view={view} onPlace={onPlace} />;
}

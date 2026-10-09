import { lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/arc/tabs/tabs";
import { useSeo } from "../seo";
import { PANEL_SHELL } from "../components/FightStats";

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
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children ? <div className="text-sm text-muted">{children}</div> : null}
    </div>
  );
}

/** The panel itself, mounted only once there is an account to identify. */
function AdminShell({ tab, onTab }: { tab: TabId; onTab: (next: TabId) => void }) {
  const { data, error, loading } = useAdminResource<AdminSession>("/api/admin/session");

  if (loading && !data) return <div role="status" className="flex h-full items-center justify-center text-sm text-muted">Checking access…</div>;
  // The server said no: there is nothing here for this reader, so send them home.
  if (data && !data.admin) return <Navigate to="/" replace />;
  if (!data?.admin) {
    return (
      <Notice title="Couldn't check access.">
        {error ? <p className="mt-1 text-xs text-muted">{error}</p> : null}
      </Notice>
    );
  }

  // The page itself never scrolls: the tabs stay put and each tab scrolls
  // inside the space left under them. Wide, Bugs splits that space into its
  // own scrolling sections; on a phone it scrolls as one like the others.
  const fills = tab === "bugs";
  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-6xl flex-col gap-3 px-2 pt-3 sm:gap-4 sm:px-5 sm:pt-4">
      <Tabs value={tab} onValueChange={next => onTab(next as TabId)} className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4">
      <div className={`${PANEL_SHELL} shrink-0 p-1.5`}>
        <TabsList aria-label="Admin sections">
          {TABS.map(item => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
        </TabsList>
      </div>
      <TabsContent
        value={tab}
        className={`!mt-0 min-h-0 flex-1 overscroll-y-contain overflow-x-hidden !text-foreground ${fills ? "overflow-y-auto pb-6 md:flex md:flex-col md:overflow-y-visible md:pb-4" : "overflow-y-auto pb-6"}`}
      >
        <Suspense fallback={<div role="status" className="py-16 text-center text-sm text-muted">Loading…</div>}>
          {tab === "health" ? <AdminHealth /> : null}
          {tab === "bugs" ? <AdminBugs /> : null}
          {tab === "live" ? <AdminLive /> : null}
          {tab === "admin" ? <AdminAdmins email={data.email} /> : null}
          {tab === "flags" ? <AdminFlags /> : null}
          {tab === "comments" ? <AdminComments /> : null}
        </Suspense>
      </TabsContent>
      </Tabs>
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
  if (!isLoaded) return <div role="status" className="flex h-full items-center justify-center text-sm text-muted">Loading…</div>;
  if (!user) return <Navigate to="/" replace />;
  return <AdminShell tab={tab} onTab={onTab} />;
}

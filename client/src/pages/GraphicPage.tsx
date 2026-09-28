import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { useSeo } from "../seo";
import GraphicsBuilder from "../components/GraphicsBuilder";
import { PageState } from "../components/ResearchKit";

/** The graphics builder as a page. Still an admin tool: anyone else is told
 *  it isn't available rather than shown it. */
function AdminBuilder() {
  const { isLoaded, user } = useAccount();
  const { data, loading } = useAdminResource<AdminSession>(isLoaded && user ? "/api/admin/session" : null);
  if (!isLoaded || loading) return <PageState>Loading…</PageState>;
  if (!data?.admin) return <PageState>The graphics builder isn’t available yet.</PageState>;
  return <GraphicsBuilder inline initial={null} />;
}

export default function GraphicPage() {
  useSeo({ title: "Generate a graphic", path: "/graphic" });
  return accountsEnabled ? <AdminBuilder /> : <PageState>The graphics builder isn’t available yet.</PageState>;
}

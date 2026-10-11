import AdminAdmins from "./AdminAdmins";
import AdminNewsAi from "./AdminNewsAi";
import { SectionHead, ViewHead } from "./adminKit";

/** Switches that change how the site runs, and who may change them. */
export default function AdminSettings({ email }: { email: string | null }) {
  return (
    <div className="flex flex-col gap-6">
      <ViewHead title="Settings" note="Changes apply to the whole site at once." />
      <section className="flex flex-col gap-2">
        <SectionHead title="Features" />
        <AdminNewsAi />
      </section>
      <AdminAdmins email={email} />
    </div>
  );
}

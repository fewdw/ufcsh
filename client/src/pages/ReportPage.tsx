import { accountsEnabled, useAccount } from "../auth";
import { PAGE, PAGE_BODY } from "../research";
import { useSeo } from "../seo";
import ReportIssueDialog from "../components/ReportIssueDialog";
import { PageState } from "../components/ResearchKit";
import { PANEL } from "../components/chartTokens";
import { BUTTON_PRIMARY } from "../ui";

/** The report form as a page, for whatever isn't tied to one page. Reports
 *  come from signed-in readers, as they do from a profile. */
export default function ReportPage() {
  return accountsEnabled ? <Report /> : <PageState>Reports need an account, and accounts are off here.</PageState>;
}

function Report() {
  const { isLoaded, user, signIn } = useAccount();
  useSeo({ title: "Report an issue", path: "/report" });
  return (
    <div className={PAGE}>
      <div className={`${PAGE_BODY} max-w-xl`}>
        {!isLoaded ? <PageState>Loading…</PageState>
          : user ? <ReportIssueDialog inline open onClose={() => {}} />
            : (
              <section className={`${PANEL} px-5 py-8 text-center`}>
                <h1 className="text-base font-semibold text-zinc-900">Report an issue</h1>
                <p className="mt-1 text-sm text-zinc-500">Sign in to send a report, so we can follow up if we need to.</p>
                <button type="button" onClick={signIn} className={`mt-5 ${BUTTON_PRIMARY}`}>Sign in</button>
              </section>
            )}
      </div>
    </div>
  );
}

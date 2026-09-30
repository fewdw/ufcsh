import { Link, Outlet, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "./segmented";

const TABS = [
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/roster", label: "Roster" },
] as const;

/** Browse: Officials, Venues and Roster as tabs over one page. On a phone the
 *  tabs are the bar across the top, as on Matchmaking. */
export default function BrowseLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Browse" className="relative isolate flex shrink-0 justify-center px-2 py-1.5 sm:px-3 sm:pb-0 sm:pt-3 lg:px-4 lg:pt-4">
        <div aria-hidden="true" className="absolute inset-0 -z-10 border-b border-zinc-200 bg-white sm:hidden" />
        <div className={`${segmentedGroup} w-full max-w-md`}>
          {TABS.map((tab) => (
            <Link key={tab.href} to={tab.href} replace aria-current={pathname === tab.href ? "page" : undefined}
              className={`${segmentedTab.replace("flex-auto", "flex-1")} text-center ${pathname === tab.href ? segmentedSelected : segmentedIdle}`}>
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

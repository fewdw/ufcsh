import { Link, Outlet, useLocation } from "react-router-dom";
import { PANEL } from "./chartTokens";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "./segmented";

const TABS = [
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/roster", label: "Roster" },
] as const;

/** Browse: Officials, Venues and Roster as tabs over one page, on a white
 *  card as on Matchmaking and a profile. */
export default function BrowseLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Browse" className="flex shrink-0 justify-center px-2 pt-2 sm:px-3 sm:pt-3 lg:px-4 lg:pt-4">
        <div className={`${PANEL} w-full p-1.5 sm:max-w-md`}>
        <div className={`${segmentedGroup} w-full`}>
          {TABS.map((tab) => (
            <Link key={tab.href} to={tab.href} replace aria-current={pathname === tab.href ? "page" : undefined}
              className={`${segmentedTab.replace("flex-auto", "flex-1")} text-center ${pathname === tab.href ? segmentedSelected : segmentedIdle}`}>
              {tab.label}
            </Link>
          ))}
        </div>
        </div>
      </nav>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

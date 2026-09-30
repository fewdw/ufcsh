import { Link, useLocation } from "react-router-dom";
import { PANEL } from "./chartTokens";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "./segmented";

const TABS = [
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/roster", label: "Roster" },
] as const;

/** Browse: Officials, Venues and Roster as tabs, on a white card as on
 *  Matchmaking. Drawn at the top of each page so it scrolls with it. */
export default function BrowseTabs() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Browse" className="flex justify-center">
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
  );
}

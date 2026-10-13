import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedOption } from "./segmented";

const TABS = [
  { href: "/roster", label: "Roster" },
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/locations", label: "Locations" },
] as const;

/** Browse navigation inside each directory's toolbar. On a phone it spans the
 *  toolbar beside the Filters button, so the toolbar is a single line. */
export default function BrowseTabs() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Browse" className={`${segmentedGroup} shrink-0 max-sm:min-w-0 max-sm:flex-1 max-sm:gap-0.5`}>
      {TABS.map((tab) => (
        <Link key={tab.href} to={tab.href} replace aria-current={pathname === tab.href ? "page" : undefined}
          className={`${segmentedOption} inline-flex items-center max-sm:flex-1 max-sm:justify-center max-sm:px-1 ${pathname === tab.href ? segmentedSelected : segmentedIdle}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedOption } from "./segmented";

const TABS = [
  { href: "/roster", label: "Roster" },
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/locations", label: "Locations" },
] as const;

/** Browse navigation inside each directory's toolbar. */
export default function BrowseTabs() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Browse" className={`${segmentedGroup} shrink-0`}>
      {TABS.map((tab) => (
        <Link key={tab.href} to={tab.href} replace aria-current={pathname === tab.href ? "page" : undefined}
          className={`${segmentedOption} inline-flex items-center ${pathname === tab.href ? segmentedSelected : segmentedIdle}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedOption } from "./segmented";

const TABS = [
  { href: "/roster", label: "Roster" },
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/locations", label: "Locations" },
  { href: "/awards", label: "Awards" },
] as const;

/** Browse navigation inside each directory's toolbar. Five tabs fit a phone
 *  with tighter padding, and scroll sideways on anything narrower. */
export default function BrowseTabs() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Browse" className={`${segmentedGroup} min-w-0 max-w-full overflow-x-auto [scrollbar-width:none]`}>
      {TABS.map((tab) => (
        <Link key={tab.href} to={tab.href} replace aria-current={pathname === tab.href ? "page" : undefined}
          className={`${segmentedOption} inline-flex shrink-0 items-center max-[429px]:px-2 ${pathname === tab.href ? segmentedSelected : segmentedIdle}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

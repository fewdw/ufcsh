import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedOption } from "./segmented";

const TABS = [
  { href: "/roster", label: "Roster" },
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/locations", label: "Locations" },
  { href: "/awards", label: "Awards" },
] as const;

/** On a phone the tabs have the toolbar to themselves (the page's Filters sit
 *  in its list head): they stretch to fill it and sit tighter, a size smaller
 *  below 360px and again below 340px. Anything narrower scrolls the tabs
 *  sideways instead of wrapping. */
const BROWSE_GROUP = `${segmentedGroup} shrink-0 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-0 max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[scrollbar-width:none]`;
const BROWSE_OPTION = `${segmentedOption} inline-flex items-center max-sm:flex-auto max-sm:shrink-0 max-sm:justify-center max-sm:px-1 max-[359px]:text-xs max-[339px]:text-[11px]`;

/** Browse navigation inside each directory's toolbar. */
export default function BrowseTabs() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Browse" className={BROWSE_GROUP}>
      {TABS.map((tab) => (
        <Link key={tab.href} to={tab.href} replace aria-current={pathname === tab.href ? "page" : undefined}
          className={`${BROWSE_OPTION} ${pathname === tab.href ? segmentedSelected : segmentedIdle}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

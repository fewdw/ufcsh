import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedOption } from "./segmented";

const TABS = [
  { href: "/roster", label: "Roster" },
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/locations", label: "Locations" },
] as const;

/** A browse page's pill groups — these tabs and the page's own choice, such as
 *  Signed and Cut — share one line on a phone: each group stretches to fill it
 *  and its pills sit tighter, a size smaller below 400px. */
export const BROWSE_GROUP = `${segmentedGroup} shrink-0 max-sm:min-w-0 max-sm:flex-auto max-sm:gap-0.5`;
export const BROWSE_OPTION = `${segmentedOption} inline-flex items-center max-sm:flex-auto max-sm:justify-center max-sm:px-1 max-[399px]:text-xs`;

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

import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedOption } from "./segmented";

type Tab = { href: string; label: string };

const BROWSE: Tab[] = [
  { href: "/roster", label: "Roster" },
  { href: "/officials", label: "Officials" },
  { href: "/venues", label: "Venues" },
  { href: "/locations", label: "Locations" },
];

const STATS: Tab[] = [
  { href: "/stats", label: "Leaderboards" },
  { href: "/charts", label: "Charts" },
];

/** The pages of one More section, as tabs inside each page's toolbar. */
function SectionTabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label={label} className={`${segmentedGroup} shrink-0`}>
      {tabs.map((tab) => (
        <Link key={tab.href} to={tab.href} replace aria-current={pathname === tab.href ? "page" : undefined}
          className={`${segmentedOption} inline-flex items-center ${pathname === tab.href ? segmentedSelected : segmentedIdle}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export const BrowseTabs = () => <SectionTabs label="Browse" tabs={BROWSE} />;
export const StatsTabs = () => <SectionTabs label="Stats" tabs={STATS} />;

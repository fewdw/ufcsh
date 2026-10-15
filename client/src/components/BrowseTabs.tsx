import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedOption } from "./segmented";
import { BROWSE_FLAT } from "./PageToolbar";
import useMediaQuery from "../useMediaQuery";

type Tab = { href: string; label: string; current: (pathname: string, kind: string | null) => boolean };

const on = (path: string) => (pathname: string) => pathname === path;
const ROSTER: Tab = { href: "/roster", label: "Roster", current: on("/roster") };
const PLACES: Tab[] = [
  { href: "/venues", label: "Venues", current: on("/venues") },
  { href: "/locations", label: "Locations", current: on("/locations") },
  { href: "/awards", label: "Awards", current: on("/awards") },
  { href: "/controversial", label: "Controversial", current: on("/controversial") },
];
/** Below `lg` judges and referees share one tab and the page picks between
 *  them; from `lg` up there is room for each to have its own. */
const OFFICIALS: Tab[] = [{ href: "/officials", label: "Officials", current: on("/officials") }];
const JUDGES_AND_REFEREES: Tab[] = [
  { href: "/officials", label: "Judges", current: (pathname, kind) => pathname === "/officials" && kind !== "referees" },
  { href: "/officials?kind=referees", label: "Referees", current: (pathname, kind) => pathname === "/officials" && kind === "referees" },
];

/** On a phone the tabs have the toolbar to themselves (the page's Filters sit
 *  in its list head): they stretch to fill it, sit tighter and step down in
 *  size so all six fit, smaller again below 360px. Anything
 *  narrower scrolls the tabs sideways instead of wrapping. */
const BROWSE_GROUP = `${segmentedGroup} shrink-0 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-0 max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[scrollbar-width:none]`;
const BROWSE_OPTION = `${segmentedOption} inline-flex items-center max-sm:flex-auto max-sm:shrink-0 max-sm:justify-center max-sm:px-1 max-sm:text-[11px] max-[359px]:px-0.5 max-[359px]:text-[10px]`;

/** Browse navigation inside each directory's toolbar. */
export default function BrowseTabs() {
  const { pathname, search } = useLocation();
  const flat = useMediaQuery(BROWSE_FLAT);
  const kind = new URLSearchParams(search).get("kind");
  const tabs = [ROSTER, ...(flat ? JUDGES_AND_REFEREES : OFFICIALS), ...PLACES];
  return (
    <nav aria-label="Browse" className={BROWSE_GROUP}>
      {tabs.map((tab) => {
        const current = tab.current(pathname, kind);
        return (
          <Link key={tab.href} to={tab.href} replace aria-current={current ? "page" : undefined}
            className={`${BROWSE_OPTION} ${current ? segmentedSelected : segmentedIdle}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

import { Fragment, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

type Section = { href: string; label: string; paths: string[] };
type Group = { label: string; sections: Section[] };

/** The pages behind More, in one column. */
const GROUPS: Group[] = [
  { label: "More", sections: [
    { href: "/stats", label: "Stats", paths: ["/stats"] },
    { href: "/news", label: "News", paths: ["/news"] },
    // Roster, Officials, Venues and Locations, tabbed by `BrowseTabs`.
    { href: "/roster", label: "Browse", paths: ["/roster", "/officials", "/judges", "/referees", "/venues", "/locations"] },
    { href: "/matchmaking", label: "Matchmaking", paths: ["/matchmaking"] },
  ] },
];

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
const current = (pathname: string, section: Section) => section.paths.some((path) => within(pathname, path));
const groupOf = (pathname: string) => GROUPS.find((group) => group.sections.some((section) => current(pathname, section)));

/** Where the More button leads when it is pressed rather than opened. */
export const MORE_HOME = GROUPS[0].sections[0].href;

export const inMore = (pathname: string) => groupOf(pathname) !== undefined;

type Item = (section: Section, active: boolean) => ReactNode;

/** Every More group, in order, as `group` and `item` draw them. */
export function MoreGroups({ group, item }: { group: (label: string, links: ReactNode) => ReactNode; item: Item }) {
  const { pathname } = useLocation();
  return <>
    {GROUPS.map((each) => <Fragment key={each.label}>{group(each.label, each.sections.map((section) => item(section, current(pathname, section))))}</Fragment>)}
  </>;
}

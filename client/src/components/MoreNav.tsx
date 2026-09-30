import { Fragment, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";

type Section = { href: string; label: string; paths: string[] };
type Group = { label: string; sections: Section[]; admin?: true };

/** The pages behind More, in groups: the numbers, the people and places
 *  behind the cards, the news, then the admin tools. The admin group
 *  needs sign-in to exist on this deployment, and is listed only for admins. */
const GROUPS: Group[] = [
  { label: "Data", sections: [
    { href: "/stats", label: "Stats", paths: ["/stats"] },
    { href: "/matchmaking", label: "Matchmaking", paths: ["/matchmaking"] },
  ] },
  { label: "Directory", sections: [
    { href: "/roster", label: "Roster", paths: ["/roster"] },
    { href: "/officials", label: "Officials", paths: ["/officials", "/judges", "/referees"] },
    { href: "/venues", label: "Venues", paths: ["/venues"] },
  ] },
  { label: "Community", sections: [
    { href: "/news", label: "News", paths: ["/news"] },
  ] },
  { label: "Admin", admin: true, sections: [
    { href: "/graphic", label: "Graphic", paths: ["/graphic"] },
    { href: "/admin", label: "Admin", paths: ["/admin"] },
  ] },
];

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
const current = (pathname: string, section: Section) => section.paths.some((path) => within(pathname, path));
const groupOf = (pathname: string) => GROUPS.find((group) => group.sections.some((section) => current(pathname, section)));

/** Where the More button leads when it is pressed rather than opened. */
export const MORE_HOME = GROUPS[0].sections[0].href;

export const inMore = (pathname: string) => groupOf(pathname) !== undefined;

// Remembered across pages, so the Admin links don't blink in on each one.
let wasAdmin = false;

/** Admin pages are listed only for the few who have them. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useAccount();
  const { data } = useAdminResource<AdminSession>(isLoaded && user ? "/api/admin/session" : null);
  if (data) wasAdmin = data.admin;
  else if (isLoaded && !user) wasAdmin = false;
  return wasAdmin ? children : null;
}

type Item = (section: Section, active: boolean) => ReactNode;

/** Every More group, in order, as `group` and `item` draw them. */
export function MoreGroups({ group, item }: { group: (label: string, links: ReactNode) => ReactNode; item: Item }) {
  const { pathname } = useLocation();
  return <>
    {GROUPS.filter((each) => !each.admin || accountsEnabled).map((each) => {
      const drawn = <Fragment key={each.label}>{group(each.label, each.sections.map((section) => item(section, current(pathname, section))))}</Fragment>;
      return each.admin ? <AdminOnly key={each.label}>{drawn}</AdminOnly> : drawn;
    })}
  </>;
}

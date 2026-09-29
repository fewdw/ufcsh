import { Fragment, useEffect, useReducer, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { useApi, type RosterMoves } from "../api";
import { onRosterSeen, seedRosterSeen, unseenMoves } from "../rosterSeen";

type Section = { href: string; label: string; paths: string[]; accounts?: true };
type Group = { label: string; sections: Section[]; admin?: true };

/** The pages behind More, in groups of three: the numbers, the people and
 *  places behind the cards, following along, then help and the admin
 *  tools. `accounts` pages need sign-in to exist on this deployment; the
 *  admin group needs it too, and is listed only for admins. */
const GROUPS: Group[] = [
  { label: "Data", sections: [
    { href: "/stats", label: "Stats", paths: ["/stats"] },
    { href: "/labs", label: "Labs", paths: ["/labs"] },
    { href: "/matchmaking", label: "Matchmaking", paths: ["/matchmaking"] },
  ] },
  { label: "Directory", sections: [
    { href: "/roster", label: "Roster", paths: ["/roster"] },
    { href: "/officials", label: "Officials", paths: ["/officials", "/judges", "/referees"] },
    { href: "/venues", label: "Venues", paths: ["/venues"] },
  ] },
  { label: "Community", sections: [
    { href: "/news", label: "News", paths: ["/news"] },
    { href: "/leaderboards", label: "Leaderboards", paths: ["/leaderboards"], accounts: true },
    { href: "/favorites", label: "Favorites", paths: ["/favorites"] },
  ] },
  { label: "Help", sections: [
    { href: "/report", label: "Report an issue", paths: ["/report"], accounts: true },
  ] },
  { label: "Admin", admin: true, sections: [
    { href: "/graphic", label: "Graphic", paths: ["/graphic"] },
    { href: "/admin", label: "Admin", paths: ["/admin"] },
  ] },
];

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
const current = (pathname: string, section: Section) => section.paths.some((path) => within(pathname, path));
const shown = (group: Group) => group.sections.filter((section) => !section.accounts || accountsEnabled);
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
      const drawn = <Fragment key={each.label}>{group(each.label, shown(each).map((section) => item(section, current(pathname, section))))}</Fragment>;
      return each.admin ? <AdminOnly key={each.label}>{drawn}</AdminOnly> : drawn;
    })}
  </>;
}

/** Signings (green) and releases (red) since Roster was last opened, beside
 *  its name in the sidebar. Read only where the sidebar shows. */
function RosterNews() {
  const [wide] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const { data } = useApi<RosterMoves>(wide ? "/api/roster" : null);
  const [, refresh] = useReducer((turn: number) => turn + 1, 0);
  useEffect(() => onRosterSeen(refresh), []);
  useEffect(() => { if (data) seedRosterSeen(data); }, [data]);
  if (!data) return null;
  const unseen = [...unseenMoves(data)];
  const added = unseen.filter((key) => key.startsWith("signed:")).length;
  const removed = unseen.length - added;
  if (!unseen.length) return null;
  const label = [added ? `${added} new signing${added === 1 ? "" : "s"}` : "", removed ? `${removed} new release${removed === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  return (
    <span className="flex shrink-0 gap-1 text-[11px] font-semibold tabular-nums" role="status" aria-label={label} title={label}>
      {added ? <span className="min-w-5 rounded-full bg-emerald-50 px-1.5 text-center text-emerald-700">{added}</span> : null}
      {removed ? <span className="min-w-5 rounded-full bg-rose-50 px-1.5 text-center text-rose-700">{removed}</span> : null}
    </span>
  );
}

/** The More pages: a sidebar from `md` up; on a phone the header's More
 *  opens the rest. Each page keeps its own scrolling. */
export function MoreLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav aria-label="More" className="hidden w-48 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white p-2 md:block lg:w-52 lg:p-3">
        <ul className="flex flex-col gap-0.5">
          <MoreGroups group={(label, links) => (
            <li key={label} className="border-t border-zinc-100 pt-1 first:border-0 first:pt-0 [&:not(:last-child)]:pb-1">
              <ul aria-label={label} className="flex flex-col gap-0.5">{links}</ul>
            </li>
          )} item={(section, active) => (
            <li key={section.href}>
              <Link to={section.href} aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"}`}>
                {section.label}
                {section.href === "/roster" ? <RosterNews /> : null}
              </Link>
            </li>
          )} />
        </ul>
      </nav>
      <div className="min-h-0 min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

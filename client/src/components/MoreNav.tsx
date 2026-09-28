import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";
import { useApi, type RosterMoves } from "../api";
import { onRosterSeen, seedRosterSeen, unseenMoves } from "../rosterSeen";

type Section = { href: string; label: string; paths: string[]; access?: "accounts" | "admin" };

/** The pages behind More, each with the paths that belong to it: the numbers
 *  first, then the news around the roster, the people and places behind the
 *  cards, the fans, and the tools. `accounts` pages need sign-in to exist on
 *  this deployment; `admin` ones are listed only for admins. */
const SECTIONS: Section[] = [
  { href: "/stats", label: "Stats", paths: ["/stats"] },
  { href: "/labs", label: "Labs", paths: ["/labs"] },
  { href: "/news", label: "News", paths: ["/news"] },
  { href: "/roster", label: "Roster", paths: ["/roster"] },
  { href: "/matchmaking", label: "Matchmaking", paths: ["/matchmaking"] },
  { href: "/officials", label: "Officials", paths: ["/officials", "/judges", "/referees"] },
  { href: "/venues", label: "Venues", paths: ["/venues"] },
  { href: "/leaderboards", label: "Leaderboards", paths: ["/leaderboards"], access: "accounts" },
  { href: "/favorites", label: "Favorites", paths: ["/favorites"] },
  { href: "/report", label: "Report", paths: ["/report"], access: "accounts" },
  { href: "/graphic", label: "Graphic", paths: ["/graphic"], access: "admin" },
  { href: "/admin", label: "Admin", paths: ["/admin"], access: "admin" },
];

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
const current = (pathname: string, section: Section) => section.paths.some((path) => within(pathname, path));

/** Where the More button leads when it is pressed rather than hovered. */
export const MORE_HOME = SECTIONS[0].href;

export const inMore = (pathname: string) => SECTIONS.some((section) => current(pathname, section));

// Remembered across pages, so the Admin link doesn't blink in on each one.
let wasAdmin = false;

/** Admin pages are listed only for the few who have them. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useAccount();
  const { data } = useAdminResource<AdminSession>(isLoaded && user ? "/api/admin/session" : null);
  if (data) wasAdmin = data.admin;
  else if (isLoaded && !user) wasAdmin = false;
  return wasAdmin ? children : null;
}

/** Every More link, in order, as `item` draws it. */
export function MoreLinks({ item }: { item: (section: Section, active: boolean) => ReactNode }) {
  const { pathname } = useLocation();
  return <>
    {SECTIONS.filter((section) => !section.access || accountsEnabled).map((section) => section.access === "admin"
      ? <AdminOnly key={section.href}>{item(section, current(pathname, section))}</AdminOnly>
      : item(section, current(pathname, section)))}
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

/** The More pages: a sidebar from `md` up, a strip of tabs above the page on
 *  a phone. Each page keeps its own scrolling. */
export function MoreLayout() {
  const strip = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    strip.current?.querySelector("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav ref={strip} aria-label="More" className="shrink-0 overflow-x-auto border-b border-zinc-200 bg-white [scrollbar-width:none] md:hidden">
        <ul className="flex w-max gap-1 px-2 py-1.5">
          <MoreLinks item={(section, active) => (
            <li key={section.href}>
              <Link to={section.href} aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}>
                {section.label}
              </Link>
            </li>
          )} />
        </ul>
      </nav>
      <nav aria-label="More" className="hidden w-48 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white p-2 md:block lg:w-52 lg:p-3">
        <ul className="flex flex-col gap-0.5">
          <MoreLinks item={(section, active) => (
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

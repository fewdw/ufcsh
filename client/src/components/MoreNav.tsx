import { useEffect, useRef, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { accountsEnabled, useAccount } from "../auth";
import { useAdminResource, type AdminSession } from "../admin";

/** The pages behind More, each with the paths that belong to it. */
const SECTIONS = [
  { href: "/roster", label: "Roster", paths: ["/roster"] },
  { href: "/favorites", label: "Favorites", paths: ["/favorites"] },
  { href: "/officials", label: "Officials", paths: ["/officials", "/judges", "/referees"] },
  { href: "/venues", label: "Venues", paths: ["/venues"] },
  { href: "/matchmaking", label: "Matchmaking", paths: ["/matchmaking"] },
  { href: "/news", label: "News", paths: ["/news"] },
];
const ADMIN = { href: "/admin", label: "Admin", paths: ["/admin"] };

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
const current = (pathname: string, section: typeof ADMIN) => section.paths.some((path) => within(pathname, path));

export const inMore = (pathname: string) => [...SECTIONS, ADMIN].some((section) => current(pathname, section));

// Remembered across pages, so the Admin link doesn't blink in on each one.
let wasAdmin = false;

/** Admin is listed only for the few who have it. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useAccount();
  const { data } = useAdminResource<AdminSession>(isLoaded && user ? "/api/admin/session" : null);
  if (data) wasAdmin = data.admin;
  else if (isLoaded && !user) wasAdmin = false;
  return wasAdmin ? children : null;
}

/** Every More link, in order, as `item` draws it. */
export function MoreLinks({ item }: { item: (section: typeof ADMIN, active: boolean) => ReactNode }) {
  const { pathname } = useLocation();
  return <>
    {SECTIONS.map((section) => item(section, current(pathname, section)))}
    {accountsEnabled ? <AdminOnly>{item(ADMIN, current(pathname, ADMIN))}</AdminOnly> : null}
  </>;
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
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"}`}>
                {section.label}
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

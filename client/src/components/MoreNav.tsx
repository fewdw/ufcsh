/* oxlint-disable react/only-export-components -- the menus and the component that draws them are one feature. */
import { Fragment, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

type Section = { href: string; label: string; paths: string[] };
type Group = { label: string; sections: Section[] };
export type Menu = { label: string; groups: Group[] };

/** The header's two menus. Browse is the people and places behind the cards;
 *  More is the numbers, then the news and graphics. */
export const MENUS: Menu[] = [
  { label: "Browse", groups: [
    { label: "Browse", sections: [
      { href: "/officials", label: "Officials", paths: ["/officials", "/judges", "/referees"] },
      { href: "/venues", label: "Venues", paths: ["/venues"] },
      { href: "/roster", label: "Roster", paths: ["/roster"] },
    ] },
  ] },
  { label: "More", groups: [
    { label: "Data", sections: [
      { href: "/stats", label: "Stats", paths: ["/stats"] },
      { href: "/matchmaking", label: "Matchmaking", paths: ["/matchmaking"] },
    ] },
    { label: "Community", sections: [
      { href: "/news", label: "News", paths: ["/news"] },
      { href: "/graphic", label: "Graphic", paths: ["/graphic"] },
    ] },
  ] },
];

/** Below `md` there is no room for both pills: More holds Browse too. */
export const PHONE_MENU: Menu = { label: "More", groups: MENUS.flatMap((menu) => menu.groups) };

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
const current = (pathname: string, section: Section) => section.paths.some((path) => within(pathname, path));

/** Where a menu's button leads when it is pressed rather than opened. */
export const menuHome = (menu: Menu) => menu.groups[0].sections[0].href;

export const inMenu = (menu: Menu, pathname: string) => menu.groups.some((group) => group.sections.some((section) => current(pathname, section)));

type Item = (section: Section, active: boolean) => ReactNode;

/** Every group of a menu, in order, as `group` and `item` draw them. */
export function MenuGroups({ menu, group, item }: { menu: Menu; group: (label: string, links: ReactNode) => ReactNode; item: Item }) {
  const { pathname } = useLocation();
  return <>
    {menu.groups.map((each) => <Fragment key={each.label}>{group(each.label, each.sections.map((section) => item(section, current(pathname, section))))}</Fragment>)}
  </>;
}

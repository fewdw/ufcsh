/** Each page's code, loaded on demand. Shared by the router and by
 *  `useLinkPrefetch`, so a hovered link and an idle moment fetch the very
 *  chunk the route will render. */
export const pages = {
  events: () => import("./pages/EventsPage"),
  fighter: () => import("./pages/FighterPage"),
  rankings: () => import("./pages/RankingsPage"),
  stats: () => import("./pages/StatsPage"),
  labs: () => import("./pages/LabsPage"),
  admin: () => import("./pages/AdminPage"),
  profile: () => import("./pages/ProfilePage"),
  auth: () => import("./pages/AuthPage"),
  judge: () => import("./pages/JudgePage"),
  referee: () => import("./pages/RefereePage"),
  venue: () => import("./pages/VenuePage"),
  directories: () => import("./pages/DirectoryPages"),
  info: () => import("./pages/InfoPage"),
};

/** The page a pathname opens, if it is one of ours. */
export function pageFor(pathname: string): (() => Promise<unknown>) | null {
  if (pathname === "/" || /^\/(events|fights)\//.test(pathname)) return pages.events;
  if (pathname.startsWith("/fighters/")) return pages.fighter;
  if (pathname === "/rankings") return pages.rankings;
  if (pathname === "/stats") return pages.stats;
  if (pathname === "/labs") return pages.labs;
  if (pathname.startsWith("/profiles/")) return pages.profile;
  if (pathname.startsWith("/judges/")) return pages.judge;
  if (pathname.startsWith("/referees/")) return pages.referee;
  if (pathname.startsWith("/venues/")) return pages.venue;
  if (pathname === "/officials" || pathname === "/venues") return pages.directories;
  if (pathname === "/info") return pages.info;
  return null;
}

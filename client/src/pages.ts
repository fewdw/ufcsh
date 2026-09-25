/** A page's chunk, fetched once; `module` is set when it has arrived, so a
 *  page already in hand renders at once rather than through Suspense. */
export type PageLoader<M = unknown> = (() => Promise<M>) & { module?: M };

function loader<M>(load: () => Promise<M>): PageLoader<M> {
  let pending: Promise<M> | undefined;
  const run = (() => pending ??= load().then(
    module => (run.module = module),
    error => { pending = undefined; throw error; },
  )) as PageLoader<M>;
  return run;
}

/** Each page's code, loaded on demand. Shared by the router and by
 *  `useLinkPrefetch`, so a hovered link and an idle moment fetch the very
 *  chunk the route will render. */
export const pages = {
  events: loader(() => import("./pages/EventsPage")),
  fighter: loader(() => import("./pages/FighterPage")),
  rankings: loader(() => import("./pages/RankingsPage")),
  stats: loader(() => import("./pages/StatsPage")),
  labs: loader(() => import("./pages/LabsPage")),
  admin: loader(() => import("./pages/AdminPage")),
  profile: loader(() => import("./pages/ProfilePage")),
  auth: loader(() => import("./pages/AuthPage")),
  judge: loader(() => import("./pages/JudgePage")),
  referee: loader(() => import("./pages/RefereePage")),
  venue: loader(() => import("./pages/VenuePage")),
  directories: loader(() => import("./pages/DirectoryPages")),
  info: loader(() => import("./pages/InfoPage")),
};

/** The page a pathname opens, if it is one of ours. */
export function pageFor(pathname: string): PageLoader | null {
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
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return pages.admin;
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) return pages.auth;
  return null;
}

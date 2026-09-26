import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import AccountButton from "./components/AccountButton";
import CmdK from "./components/CmdK";
import SearchGlyph from "./components/SearchGlyph";
import LiveMatchup from "./components/LiveMatchup";
import { segmentedIdle, segmentedSelected } from "./components/segmented";
import { ChevronDown, Keyboard, Moon, ShieldCheck, Star, Sun, Users } from "lucide-react";
import { accountsEnabled, useAccount } from "./auth";
import { useAdminResource, type AdminSession } from "./admin";
import { useSettings, withRanking } from "./settings";
import { prefetch } from "./api";
import { useLinkPrefetch, warmSections } from "./useLinkPrefetch";
import { DEFAULT_STATS_REQUEST } from "./statsDefaults";
import { pages, type PageLoader } from "./pages";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import ParlaySlip from "./components/ParlaySlip";
import { ShortcutProvider, useShortcutHelp } from "./shortcuts";
import { DevStatsOverlay, isDevSite } from "./devStats";
import { GraphicsProvider } from "./graphicsLauncher";

/** A route's page: rendered directly once its code is in hand (the usual case,
 *  since every page's code is fetched in the background), through Suspense
 *  only before then. Chosen once per mount, so a page never remounts. */
function page<M, P extends object>(load: PageLoader<M>, pick: (module: M) => ComponentType<P>) {
  const Lazy = lazy(() => load().then(module => ({ default: pick(module) })));
  return function Page(props: P) {
    const [Component] = useState<ComponentType<P>>(() => load.module ? pick(load.module) : Lazy);
    return <Component {...props} />;
  };
}

const EventsPage = page(pages.events, module => module.default);
const FighterPage = page(pages.fighter, module => module.default);
const RankingsPage = page(pages.rankings, module => module.default);
const StatsPage = page(pages.stats, module => module.default);
const LabsPage = page(pages.labs, module => module.default);
const AdminPage = page(pages.admin, module => module.default);
const ProfilePage = page(pages.profile, module => module.default);
const AuthPage = page(pages.auth, module => module.default);
const JudgePage = page(pages.judge, module => module.default);
const RefereePage = page(pages.referee, module => module.default);
const VenuePage = page(pages.venue, module => module.default);
const OfficialsPage = page(pages.directories, module => module.OfficialsPage);
const VenuesPage = page(pages.directories, module => module.VenuesPage);
const InfoPage = page(pages.info, module => module.default);

const NAV_ITEM = "rounded-full px-1.5 py-1.5 text-[11px] font-medium transition min-[380px]:px-2 min-[380px]:text-xs min-[420px]:px-2.5 sm:px-4 sm:text-sm";

const MORE_PATHS = ["/roster", "/favorites", "/admin"];
const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

function MenuItem({ href, label, icon: Icon, pathname }: { href: string; label: string; icon: typeof Users; pathname: string }) {
  const current = within(pathname, href);
  return <li>
    <Link to={href} aria-current={current ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${current ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"}`}>
      <Icon className="h-4 w-4 text-zinc-400" aria-hidden="true" />
      {label}
    </Link>
  </li>;
}

/** Admin is listed only for the few who have it. */
function AdminMenuItem({ pathname }: { pathname: string }) {
  const { isLoaded, user } = useAccount();
  const { data } = useAdminResource<AdminSession>(isLoaded && user ? "/api/admin/session" : null);
  return data?.admin ? <MenuItem href="/admin" label="Admin" icon={ShieldCheck} pathname={pathname} /> : null;
}

/** The rest of the site, one pill after the sections. A mouse opens it on
 *  hover; a tap or a key opens it on click. */
function MoreMenu({ pathname, active }: { pathname: string; active: boolean }) {
  const { settings, update } = useSettings();
  const dark = settings.theme === "dark";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={ref} className="relative"
    onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }}
    onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}>
    <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="true" aria-label="More"
      className={`${NAV_ITEM} flex items-center gap-0.5 ${active ? segmentedSelected : segmentedIdle}`}>
      <span className="hidden sm:inline">More</span>
      <ChevronDown className={`h-4 w-4 transition-transform sm:h-3.5 sm:w-3.5 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {/* The top padding bridges the gap to the button, so a pointer moving
        down onto the menu never leaves it. */}
    {open ? <div className="absolute right-0 top-full z-50 pt-1.5 sm:left-0 sm:right-auto">
      <ul className="w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
        <MenuItem href="/roster" label="Roster" icon={Users} pathname={pathname} />
        <MenuItem href="/favorites" label="Favorites" icon={Star} pathname={pathname} />
        {accountsEnabled ? <AdminMenuItem pathname={pathname} /> : null}
        {/* The narrowest phones have no room for the theme button in the row. */}
        <li className="min-[380px]:hidden">
          <button type="button" onClick={() => update("theme", dark ? "light" : "dark")}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900">
            {dark ? <Sun className="h-4 w-4 text-zinc-400" aria-hidden="true" /> : <Moon className="h-4 w-4 text-zinc-400" aria-hidden="true" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </li>
      </ul>
    </div> : null}
  </div>;
}

function Header({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const showShortcuts = useShortcutHelp();
  const { settings, update } = useSettings();
  const dark = settings.theme === "dark";
  // The bout on now sits mid-row only while it fits whole; the moment its
  // names would be cut, it drops to its own line instead.
  const slotRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const [pillFits, setPillFits] = useState(true);
  useEffect(() => {
    const slot = slotRef.current;
    const pill = pillRef.current;
    if (!slot || !pill) return;
    const measure = () => setPillFits(pill.offsetWidth <= slot.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(pill);
    return () => observer.disconnect();
  }, []);
  const isRankings = pathname.startsWith("/rankings");
  const isStats = pathname.startsWith("/stats");
  // Labs is a mode of Statistics rather than a top-level destination, so the
  // Stats pill stays lit while it is open and the switch lives on the page.
  const isLabs = pathname.startsWith("/labs");
  const isMore = MORE_PATHS.some(path => within(pathname, path));
  // A profile belongs to no section of the nav, so none of them is lit.
  const isProfile = pathname.startsWith("/profiles");
  const links = [
    // Pointing at a section starts its code and its first data, so a tap
    // lands on it loaded.
    { href: "/", label: "Events", active: !isRankings && !isStats && !isLabs && !isProfile && !isMore, load: () => { warmSections(settings.rankingSource); return pages.events(); } },
    { href: "/rankings", label: "Rankings", active: isRankings, load: () => { prefetch(withRanking("/api/rankings", settings.rankingSource)); return pages.rankings(); } },
    { href: "/stats", label: "Stats", active: isStats || isLabs, load: () => { prefetch(DEFAULT_STATS_REQUEST); return pages.stats(); } },
  ];

  return (
    <header className="shrink-0 border-b border-zinc-200 bg-white">
      {/* One row, everything in normal flow: the logo and the nav on the left,
          the actions on the right, and the bout on now taking whatever is
          between them. Nothing is positioned over anything else, so no width
          can make two of them collide. */}
      <div className="flex w-full items-center gap-1 px-2 py-2 min-[380px]:gap-1.5 min-[380px]:px-2.5 min-[420px]:gap-2 sm:gap-3 sm:px-5 sm:py-3">
        <Link to="/" aria-label="UFC.sh home" className={`shrink-0 text-sm font-extrabold tracking-tight min-[380px]:text-[15px] min-[420px]:text-base sm:text-lg ${isDevSite ? "text-sky-500" : "text-zinc-900"}`}>
          UFC<span className={isDevSite ? "font-bold" : "font-bold text-zinc-400"}>.sh</span>
        </Link>
        {/* The shared pill group, tightened on a phone so the row still fits a
            320px screen with nothing clipped and nothing dropped. */}
        <nav className="flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-100 p-0.5 sm:gap-1 sm:p-1">
          {links.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              onPointerEnter={() => { void link.load().catch(() => {}); }}
              onFocus={() => { void link.load().catch(() => {}); }}
              onTouchStart={() => { void link.load().catch(() => {}); }}
              aria-current={link.active ? "page" : undefined}
              className={`${NAV_ITEM} ${link.active ? segmentedSelected : segmentedIdle}`}
            >
              {link.label}
            </Link>
          ))}
          <MoreMenu pathname={pathname} active={isMore} />
        </nav>

        {/* The middle of the row from `md` up, and its own line below that —
            never dropped or cut short, since it is the one thing on the page
            that changes minute to minute. */}
        <div ref={slotRef} className="hidden min-w-0 flex-1 justify-center overflow-hidden md:flex">
          <div ref={pillRef} className={`w-max shrink-0 ${pillFits ? "" : "invisible"}`}><LiveMatchup /></div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 min-[380px]:gap-1 sm:gap-2 md:ml-0">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search fighters, events and fights"
            className="flex h-8 w-8 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white text-sm text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600 sm:h-9 sm:w-auto sm:justify-start sm:py-1.5 sm:pl-3 sm:pr-3.5"
          >
            <SearchGlyph />
            <span className="hidden sm:inline">Search anything</span>
            <kbd className="hidden rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 lg:inline">⌘K</kbd>
          </button>
          {/* Keyboards live on desktops: the sheet is one press of ? away, and
              this is where someone who has never pressed it finds it. */}
          <button
            type="button"
            onClick={showShortcuts}
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="?"
            title="Keyboard shortcuts (?)"
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 lg:grid"
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => update("theme", dark ? "light" : "dark")}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={dark}
            title={dark ? "Light mode" : "Dark mode"}
            className="hidden h-8 w-8 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 min-[380px]:grid sm:h-9 sm:w-9"
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          {accountsEnabled ? <AccountButton /> : null}
        </div>
      </div>

      {/* `empty:hidden` keeps this strip off the page entirely on the days
          there is no card running, which is most of them. */}
      <div className={`flex justify-center border-t border-zinc-100 px-2.5 py-1.5 empty:hidden ${pillFits ? "md:hidden" : ""}`}>
        <LiveMatchup />
      </div>
    </header>
  );
}

/** The events list, an event's card and a fight opened on top of it are one
 *  continuous view — opening or closing a fight, or switching between fights
 *  on the same card, must not reset it. Everything else still remounts (and
 *  clears a stuck error) on its own pathname. */
function routeGroup(pathname: string): string {
  return pathname === "/" || pathname.startsWith("/events/") || pathname.startsWith("/fights/") ? "events" : pathname;
}

export default function App() {
  const location = useLocation();
  const trackedPath = useRef<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const { settings } = useSettings();
  useLinkPrefetch(settings.rankingSource);

  useEffect(() => {
    // React changes pages without a new document request. Count those views by
    // route on the server; it discards usernames and fight IDs immediately.
    const path = location.pathname;
    if (path === "/profiles/me" || trackedPath.current === path) return;
    trackedPath.current = path;
    void fetch("/api/pageview", {
      method: "POST", headers: { "Content-Type": "text/plain" }, body: path,
      credentials: "omit", keepalive: true,
    }).catch(() => {});
  }, [location.pathname]);

  // Colour transitions come back once the first page has been drawn (see the
  // theme script in index.html).
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.documentElement.classList.remove("no-transitions"));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.history.scrollRestoration = previous;
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  return (
    <ShortcutProvider onSearch={openSearch}>
    <GraphicsProvider>
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100 text-zinc-900">
      <Header onSearch={openSearch} />
      {isDevSite ? <DevStatsOverlay /> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* One boundary for the whole app, outside the per-section error
            boundary: navigations run as transitions, so a page whose code is
            still on its way leaves the current one on screen until it is
            ready instead of flashing a fallback. */}
        <Suspense fallback={<div role="status" className="appear-late flex h-full items-center justify-center text-sm text-zinc-400">Loading…</div>}>
        <RouteErrorBoundary key={routeGroup(location.pathname)}>
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/events/:eventId" element={<EventsPage />} />
          <Route path="/fights/:fightId" element={<EventsPage />} />
          <Route path="/fighters/:fighterId" element={<FighterPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/bugs" element={<AdminPage />} />
          <Route path="/roster" element={null} />
          <Route path="/favorites" element={null} />
          <Route path="/profiles/:handle" element={<ProfilePage />} />
          <Route path="/judges/:slug" element={<JudgePage />} />
          <Route path="/referees/:slug" element={<RefereePage />} />
          <Route path="/officials" element={<OfficialsPage />} />
          <Route path="/venues" element={<VenuesPage />} />
          <Route path="/venues/:slug" element={<VenuePage />} />
          <Route path="/info" element={<InfoPage />} />
          <Route path="/sign-in/*" element={<AuthPage mode="sign-in" />} />
          <Route path="/sign-up/*" element={<AuthPage mode="sign-up" />} />
          <Route path="*" element={<div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500"><p>This page couldn’t be found.</p><Link to="/" className="font-semibold text-zinc-900 underline">Back to events</Link></div>} />
        </Routes>
        </RouteErrorBoundary>
        </Suspense>
      </div>
      <CmdK open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ParlaySlip />
    </div>
    </GraphicsProvider>
    </ShortcutProvider>
  );
}

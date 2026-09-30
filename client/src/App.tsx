import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type MouseEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import AccountButton from "./components/AccountButton";
import CmdK from "./components/CmdK";
import SearchGlyph from "./components/SearchGlyph";
import LiveMatchup from "./components/LiveMatchup";
import { segmentedIdle, segmentedSelected } from "./components/segmented";
import { ChevronDown, Moon, Shield, Sun } from "lucide-react";
import { accountsEnabled, useAccount } from "./auth";
import { useAdminResource, type AdminSession } from "./admin";
import { inMore, MORE_HOME, MoreGroups } from "./components/MoreNav";
import { useSettings, withRanking } from "./settings";
import { prefetch } from "./api";
import { useLinkPrefetch, warmSections } from "./useLinkPrefetch";
import { pages, type PageLoader } from "./pages";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import ParlaySlip from "./components/ParlaySlip";
import { ShortcutProvider } from "./shortcuts";
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
const AdminPage = page(pages.admin, module => module.default);
const ProfilePage = page(pages.profile, module => module.default);
const AuthPage = page(pages.auth, module => module.default);
const JudgePage = page(pages.judge, module => module.default);
const RefereePage = page(pages.referee, module => module.default);
const VenuePage = page(pages.venue, module => module.default);
const OfficialsPage = page(pages.directories, module => module.OfficialsPage);
const VenuesPage = page(pages.directories, module => module.VenuesPage);
const LocationsPage = page(pages.directories, module => module.LocationsPage);
const LocationPage = page(pages.venue, module => module.LocationPage);
const InfoPage = page(pages.info, module => module.default);
const RosterPage = page(pages.roster, module => module.default);
const MatchmakingPage = page(pages.matchmaking, module => module.default);
const NewsPage = page(pages.news, module => module.default);
const GraphicPage = page(pages.graphic, module => module.default);

const NAV_ITEM = "rounded-full px-1.5 py-1.5 text-[11px] font-medium transition min-[380px]:px-2 min-[380px]:text-xs min-[420px]:px-2.5 sm:px-4 sm:text-sm";

// Remembered across pages and reloads, so the Admin link doesn't blink in on
// each one. Only a hint for drawing it: the admin pages check on the server.
const ADMIN_KEY = "ufcsh:admin:v1";
let wasAdmin = (() => { try { return localStorage.getItem(ADMIN_KEY) === "1"; } catch { return false; } })();
function rememberAdmin(admin: boolean) {
  if (admin === wasAdmin) return;
  wasAdmin = admin;
  try { if (admin) localStorage.setItem(ADMIN_KEY, "1"); else localStorage.removeItem(ADMIN_KEY); } catch { /* private mode: this visit only */ }
}

/** Admin, just before More, as a shield: listed only for the few who have it. */
function AdminLink({ active }: { active: boolean }) {
  const { isLoaded, user } = useAccount();
  const { data } = useAdminResource<AdminSession>(isLoaded && user ? "/api/admin/session" : null);
  if (data) rememberAdmin(data.admin);
  else if (isLoaded && !user) rememberAdmin(false);
  if (!wasAdmin) return null;
  const load = () => { void pages.admin().catch(() => {}); };
  return (
    <Link to="/admin" aria-label="Admin" title="Admin" aria-current={active ? "page" : undefined} onPointerEnter={load} onFocus={load} onTouchStart={load}
      className={`${NAV_ITEM} flex items-center self-stretch ${active ? segmentedSelected : segmentedIdle}`}>
      <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
    </Link>
  );
}

/** The rest of the site, one pill after the sections. From `md` up a mouse
 *  opens its groups on hover and a press opens Stats; a tap or a key opens
 *  them. On a phone they open as a panel across the width of the header. */
function MoreMenu({ pathname, active, open, setOpen }: { pathname: string; active: boolean; open: boolean; setOpen: (open: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname, setOpen]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, setOpen]);
  const wide = () => window.matchMedia("(min-width: 768px)").matches;
  const press = (e: MouseEvent<HTMLAnchorElement>) => {
    const pointer = (e.nativeEvent as PointerEvent).pointerType;
    if (!wide() || pointer !== "mouse") { e.preventDefault(); setOpen(!open); }
    else if (active) e.preventDefault();
  };
  return <div ref={ref} className="md:relative"
    onPointerEnter={(e) => { if (e.pointerType === "mouse" && wide()) setOpen(true); }}
    onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}>
    <Link to={MORE_HOME} onClick={press} aria-expanded={open} aria-haspopup="true"
      aria-current={active ? "page" : undefined}
      className={`${NAV_ITEM} flex items-center gap-0.5 ${open || active ? segmentedSelected : segmentedIdle}`}>
      More
      <ChevronDown className={`hidden h-3.5 w-3.5 transition-transform md:block ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </Link>
    {/* A thin triangle beside the button catches a pointer cutting across
        to a far link; the top padding bridges the gap below it. */}
    {open ? <div aria-hidden="true" className="absolute left-full top-0 hidden h-full w-56 [clip-path:polygon(0_0,100%_100%,0_100%)] md:block" /> : null}
    {open ? <div className="absolute inset-x-2 top-full z-50 pt-1.5 md:inset-x-auto md:left-0">
      {/* One column: across the header on a phone, under the button above that. */}
      <div className="rounded-xl border border-zinc-200 bg-white p-2 shadow-lg md:w-max md:min-w-44">
        <MoreGroups group={(label, links) => (
          <ul key={label} aria-label={label} className="flex flex-col gap-0.5">{links}</ul>
        )} item={(section, current) => (
          <li key={section.href}>
            <Link to={section.href} aria-current={current ? "page" : undefined}
              className={`block whitespace-nowrap rounded-lg px-2 py-2 text-[13px] transition-colors min-[375px]:px-3 min-[375px]:text-sm ${current ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"}`}>
              {section.label}
            </Link>
          </li>
        )} />
      </div>
    </div> : null}
  </div>;
}

function Header({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const { settings, update } = useSettings();
  const dark = settings.theme === "dark";
  const [moreOpen, setMoreOpen] = useState(false);
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
  const isMore = inMore(pathname);
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  // A profile belongs to no section of the nav, so none of them is lit.
  const isProfile = pathname.startsWith("/profiles");
  const links = [
    // Pointing at a section starts its code and its first data, so a tap
    // lands on it loaded.
    { href: "/", label: "Events", active: !isRankings && !isProfile && !isMore && !isAdmin, load: () => { warmSections(settings.rankingSource); return pages.events(); } },
    { href: "/rankings", label: "Rankings", active: isRankings, load: () => { prefetch(withRanking("/api/rankings", settings.rankingSource)); return pages.rankings(); } },
  ];

  return (
    <header className="relative shrink-0 border-b border-zinc-200 bg-white">
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
              className={`${NAV_ITEM} ${link.active && !moreOpen ? segmentedSelected : segmentedIdle}`}
            >
              {link.label}
            </Link>
          ))}
          {accountsEnabled ? <AdminLink active={isAdmin && !moreOpen} /> : null}
          <MoreMenu pathname={pathname} active={isMore} open={moreOpen} setOpen={setMoreOpen} />
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
          <button
            type="button"
            onClick={() => update("theme", dark ? "light" : "dark")}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={dark}
            title={dark ? "Light mode" : "Dark mode"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 sm:h-9 sm:w-9"
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
          <Route path="/officials" element={<OfficialsPage />} />
          <Route path="/venues" element={<VenuesPage />} />
          <Route path="/locations" element={<LocationsPage />} />
          <Route path="/roster" element={<RosterPage />} />
          <Route path="/judges/:slug" element={<JudgePage />} />
          <Route path="/referees/:slug" element={<RefereePage />} />
          <Route path="/venues/:slug" element={<VenuePage />} />
          <Route path="/locations/:slug" element={<LocationPage />} />
          <Route path="/matchmaking" element={<MatchmakingPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/graphic" element={<GraphicPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/bugs" element={<AdminPage />} />
          <Route path="/profiles/:handle" element={<ProfilePage />} />
          {/* Both moved into the profile. */}
          <Route path="/leaderboards" element={<Navigate to="/profiles/me?tab=leaderboards" replace />} />
          <Route path="/report" element={<Navigate to="/profiles/me" replace />} />
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

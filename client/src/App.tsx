import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import AccountButton from "./components/AccountButton";
import CmdK from "./components/CmdK";
import SearchGlyph from "./components/SearchGlyph";
import LiveMatchup from "./components/LiveMatchup";
import { segmentedIdle, segmentedSelected } from "./components/segmented";
import { Moon, Sun } from "lucide-react";
import { accountsEnabled, useAccount } from "./auth";
import { useAdminResource, type AdminSession } from "./admin";
import { useSettings } from "./settings";
import { useFighterPrefetch } from "./useFighterPrefetch";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import ParlaySlip from "./components/ParlaySlip";

const loadEventsPage = () => import("./pages/EventsPage");
const loadRankingsPage = () => import("./pages/RankingsPage");
const loadStatsPage = () => import("./pages/StatsPage");
const EventsPage = lazy(loadEventsPage);
const FighterPage = lazy(() => import("./pages/FighterPage"));
const RankingsPage = lazy(loadRankingsPage);
const StatsPage = lazy(loadStatsPage);
const LabsPage = lazy(() => import("./pages/LabsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));

function AdminNavItem({ active }: { active: boolean }) {
  const { isLoaded, user } = useAccount();
  const { data } = useAdminResource<AdminSession>(isLoaded && user ? "/api/admin/session" : null);
  if (!data?.admin) return null;
  return <Link to="/admin" aria-current={active ? "page" : undefined}
    className={`rounded-full px-1 py-1.5 text-[11px] font-medium transition min-[380px]:px-2.5 min-[380px]:text-xs sm:px-4 sm:text-sm ${active ? segmentedSelected : segmentedIdle}`}>
    Admin
  </Link>;
}

function Header({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const { settings, update } = useSettings();
  const dark = settings.theme === "dark";
  const isRankings = pathname.startsWith("/rankings");
  const isStats = pathname.startsWith("/stats");
  // Labs is a mode of Statistics rather than a top-level destination, so the
  // Stats pill stays lit while it is open and the switch lives on the page.
  const isLabs = pathname.startsWith("/labs");
  const isAdmin = pathname.startsWith("/admin");
  // A profile belongs to no section of the nav, so none of them is lit.
  const isProfile = pathname.startsWith("/profiles");
  const links = [
    { href: "/", label: "Events", active: !isRankings && !isStats && !isLabs && !isProfile && !isAdmin, load: loadEventsPage },
    { href: "/rankings", label: "Rankings", active: isRankings, load: loadRankingsPage },
    { href: "/stats", label: "Stats", active: isStats || isLabs, load: loadStatsPage },
  ];

  return (
    <header className="shrink-0 border-b border-zinc-200 bg-white">
      {/* One row, everything in normal flow: the logo and the nav on the left,
          the actions on the right, and the bout on now taking whatever is
          between them. Nothing is positioned over anything else, so no width
          can make two of them collide. */}
      <div className="flex w-full items-center gap-1 px-2 py-2.5 min-[380px]:gap-2 min-[380px]:px-2.5 sm:gap-3 sm:px-5 sm:py-3">
        <Link to="/" className="shrink-0 text-sm font-bold tracking-tight text-zinc-900 min-[380px]:text-base sm:text-lg">
          ufc<span className="text-zinc-400">.sh</span>
        </Link>
        {/* The shared pill group, tightened below 380px so the row still fits a
            320px screen with nothing clipped and nothing dropped. */}
        <nav className="flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-100 p-0.5 min-[380px]:gap-1 min-[380px]:p-1">
          {links.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              onPointerEnter={() => { void link.load().catch(() => {}); }}
              onFocus={() => { void link.load().catch(() => {}); }}
              aria-current={link.active ? "page" : undefined}
              className={`rounded-full px-1 py-1.5 text-[11px] font-medium transition min-[380px]:px-2.5 min-[380px]:text-xs sm:px-4 sm:text-sm ${
                link.active ? segmentedSelected : segmentedIdle
              }`}
            >
              {link.label}
            </Link>
          ))}
          {accountsEnabled ? <AdminNavItem active={isAdmin} /> : null}
        </nav>

        {/* The middle of the row from `md` up, and its own line below that —
            never dropped, since it is the one thing on the page that changes
            minute to minute. */}
        <div className="hidden min-w-0 flex-1 justify-center md:flex">
          <LiveMatchup />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:ml-0">
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
      <div className="flex justify-center border-t border-zinc-100 px-2.5 py-1.5 empty:hidden md:hidden">
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
  const [searchOpen, setSearchOpen] = useState(false);
  const { settings } = useSettings();
  useFighterPrefetch(settings.rankingSource);

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100 text-zinc-900">
      <Header onSearch={() => setSearchOpen(true)} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <RouteErrorBoundary key={routeGroup(location.pathname)}>
        <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Loading…</div>}>
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
          <Route path="/profiles/:handle" element={<ProfilePage />} />
          <Route path="*" element={<div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500"><p>This page couldn’t be found.</p><Link to="/" className="font-semibold text-zinc-900 underline">Back to events</Link></div>} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
      </div>
      <CmdK open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ParlaySlip />
    </div>
  );
}

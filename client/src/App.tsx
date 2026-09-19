import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import AccountButton from "./components/AccountButton";
import CmdK from "./components/CmdK";
import SearchGlyph from "./components/SearchGlyph";
import LiveMatchup from "./components/LiveMatchup";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./components/segmented";
import { Moon, Sun } from "lucide-react";
import { accountsEnabled } from "./auth";
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
const BugsPage = lazy(() => import("./pages/BugsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));

function Header({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const { settings, update } = useSettings();
  const dark = settings.theme === "dark";
  const isRankings = pathname.startsWith("/rankings");
  const isStats = pathname.startsWith("/stats");
  // Labs is a mode of Statistics rather than a top-level destination, so the
  // Stats pill stays lit while it is open and the switch lives on the page.
  const isLabs = pathname.startsWith("/labs");
  // A profile belongs to no section of the nav, so none of them is lit.
  const isProfile = pathname.startsWith("/profiles");
  const links = [
    { href: "/", label: "Events", active: !isRankings && !isStats && !isLabs && !isProfile, load: loadEventsPage },
    { href: "/rankings", label: "Rankings", active: isRankings, load: loadRankingsPage },
    { href: "/stats", label: "Stats", active: isStats || isLabs, load: loadStatsPage },
  ];

  return (
    <header className="relative shrink-0 border-b border-zinc-200 bg-white">
      {/* Centred on the header itself rather than between its two groups, so
          the bout on now sits in the middle of the page whatever the nav and
          the search button happen to measure. Absolute so it cannot push them
          around, and out of the layout entirely on a narrow screen. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden max-w-[min(24rem,32vw)] -translate-x-1/2 items-center lg:flex">
        <div className="pointer-events-auto min-w-0">
          <LiveMatchup />
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 min-[380px]:gap-3 sm:gap-6">
          <Link to="/" className="shrink-0 text-base font-bold tracking-tight text-zinc-900 sm:text-lg">
            ufc<span className="text-zinc-400">.sh</span>
          </Link>
          {/* Below `sm` this is pulled out of the flex flow and centred on
              the header itself (same trick as the live-bout indicator above),
              so it lands on the page's true midpoint regardless of how wide
              the logo and the action buttons on the right measure — a
              justify-between row alone would only centre it within whatever
              space is left over, which skews toward whichever side is
              narrower. From `sm` it drops back into normal flow beside the
              logo. */}
          <nav className={`${segmentedGroup} absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 sm:static sm:left-auto sm:top-auto sm:translate-x-0 sm:translate-y-0`}>
            {links.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                onPointerEnter={() => { void link.load().catch(() => {}); }}
                onFocus={() => { void link.load().catch(() => {}); }}
                aria-current={link.active ? "page" : undefined}
                className={`rounded-full px-2 py-1.5 text-xs font-medium transition min-[380px]:px-2.5 sm:px-4 sm:text-sm ${
                  link.active ? segmentedSelected : segmentedIdle
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search fighters, events and fights"
            className="flex h-9 w-9 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white text-sm sm:w-auto sm:justify-start sm:py-1.5 sm:pl-3 sm:pr-3.5 text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600"
          >
            <SearchGlyph />
            <span className="hidden sm:inline">Search anything</span>
            <kbd className="hidden rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 md:inline">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => update("theme", dark ? "light" : "dark")}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={dark}
            title={dark ? "Light mode" : "Dark mode"}
            className="grid h-9 w-9 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
          >
            {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          </button>
          {accountsEnabled ? <AccountButton /> : null}
        </div>
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
          <Route path="/bugs" element={<BugsPage />} />
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

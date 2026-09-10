import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import CmdK from "./components/CmdK";
import SearchGlyph from "./components/SearchGlyph";
import LiveMatchup from "./components/LiveMatchup";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./components/segmented";
import { Moon, Sun } from "lucide-react";
import { useSettings } from "./settings";

const EventsPage = lazy(() => import("./pages/EventsPage"));
const FighterPage = lazy(() => import("./pages/FighterPage"));
const RankingsPage = lazy(() => import("./pages/RankingsPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const LabsPage = lazy(() => import("./pages/LabsPage"));

function Header({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const { settings, update } = useSettings();
  const dark = settings.theme === "dark";
  const isRankings = pathname.startsWith("/rankings");
  const isStats = pathname.startsWith("/stats");
  // Labs is a mode of Statistics rather than a top-level destination, so the
  // Stats pill stays lit while it is open and the switch lives on the page.
  const isLabs = pathname.startsWith("/labs");
  const links = [
    { href: "/", label: "Events", active: !isRankings && !isStats && !isLabs },
    { href: "/rankings", label: "Rankings", active: isRankings },
    { href: "/stats", label: "Stats", active: isStats || isLabs },
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
      <div className="flex w-full items-center justify-between px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link to="/" className="shrink-0 text-base font-bold tracking-tight text-zinc-900 sm:text-lg">
            ufc<span className="text-zinc-400">.sh</span>
          </Link>
          <nav className={segmentedGroup}>
            {links.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                aria-current={link.active ? "page" : undefined}
                className={`rounded-full px-2.5 py-1.5 text-xs font-medium transition sm:px-4 sm:text-sm ${
                  link.active ? segmentedSelected : segmentedIdle
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search fighters, events and fights"
            className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1.5 pl-3 pr-3.5 text-sm text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600"
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
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);

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
        <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Loading…</div>}>
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/events/:eventId" element={<EventsPage />} />
          <Route path="/fights/:fightId" element={<EventsPage />} />
          <Route path="/fighters/:fighterId" element={<FighterPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="*" element={<div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500"><p>This page couldn’t be found.</p><Link to="/" className="font-semibold text-zinc-900 underline">Back to events</Link></div>} />
        </Routes>
        </Suspense>
      </div>
      <CmdK open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

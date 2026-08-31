import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import CmdK from "./components/CmdK";
import EventsPage from "./pages/EventsPage";
import FighterPage from "./pages/FighterPage";
import RankingsPage from "./pages/RankingsPage";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./components/segmented";

function Header({ onSearch }: { onSearch: () => void }) {
  const { pathname } = useLocation();
  const isRankings = pathname.startsWith("/rankings");
  const links = [
    { href: "/", label: "Events", active: !isRankings },
    { href: "/rankings", label: "Rankings", active: isRankings },
  ];

  return (
    <header className="shrink-0 border-b border-zinc-200 bg-white">
      <div className="flex w-full items-center justify-between px-5 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-bold tracking-tight text-zinc-900">
            ufc<span className="text-zinc-400">.sh</span>
          </Link>
          <nav className={segmentedGroup}>
            {links.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  link.active ? segmentedSelected : segmentedIdle
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <button
          type="button"
          onClick={onSearch}
          className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1.5 pl-3 pr-3.5 text-sm text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 3.5 3.5" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">Search anything</span>
          <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100 text-zinc-900">
      <Header onSearch={() => setSearchOpen(true)} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/events/:eventId" element={<EventsPage />} />
          <Route path="/fights/:fightId" element={<EventsPage />} />
          <Route path="/fighters/:fighterId" element={<FighterPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
        </Routes>
      </div>
      <CmdK open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

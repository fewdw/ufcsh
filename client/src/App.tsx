import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import CmdK from "./components/CmdK";
import EventsPage from "./pages/EventsPage";
import FighterPage from "./pages/FighterPage";
import RankingsPage from "./pages/RankingsPage";
import StatsPage from "./pages/StatsPage";
import LabsPage from "./pages/LabsPage";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./components/segmented";
import { Settings as SettingsIcon, X } from "lucide-react";
import { useSettings, type AppSettings } from "./settings";

function Header({ onSearch, onSettings }: { onSearch: () => void; onSettings: () => void }) {
  const { pathname } = useLocation();
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
    <header className="shrink-0 border-b border-zinc-200 bg-white">
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
            className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white py-1.5 pl-3 pr-3.5 text-sm text-zinc-400 transition-colors hover:border-zinc-300 hover:text-zinc-600"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="9" r="6" />
              <path d="m14 14 3.5 3.5" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Search anything</span>
            <kbd className="hidden rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 md:inline">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={onSettings}
            aria-label="Open settings"
            title="Settings"
            className="grid h-9 w-9 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
          >
            <SettingsIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

const settingRows: { key: keyof AppSettings; label: string; help: string; options: { value: string; label: string }[] }[] = [
  { key: "theme", label: "Appearance", help: "Applied across every page and chart.", options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }] },
  { key: "rankingSource", label: "Rankings", help: "Used for every rank badge in the app.", options: [{ value: "meta", label: "Meta" }, { value: "media", label: "Media" }] },
  { key: "dateMode", label: "Fight dates", help: "Used consistently for past and future activity.", options: [{ value: "relative", label: "Relative days" }, { value: "date", label: "Calendar date" }] },
];

function SettingsMenu({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <>
      <button className="fixed inset-0 z-40 cursor-default bg-zinc-950/30" aria-label="Close settings" onClick={onClose} />
      <aside className="fixed right-3 top-16 z-50 w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl" aria-label="Settings">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-zinc-950">Settings</div>
            <div className="text-[10px] text-zinc-400">Saved automatically on this device.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings" className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="divide-y divide-zinc-100">
          {settingRows.map((row) => (
            <label key={row.key} className="flex items-center gap-4 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-zinc-800">{row.label}</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-zinc-400">{row.help}</span>
              </span>
              <select
                value={settings[row.key]}
                onChange={(event) => update(row.key, event.target.value as AppSettings[keyof AppSettings])}
                className="h-9 min-w-32 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-semibold text-zinc-700 outline-none focus:border-zinc-400"
              >
                {row.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      </aside>
    </>
  );
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      <Header onSearch={() => setSearchOpen(true)} onSettings={() => setSettingsOpen(true)} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/events/:eventId" element={<EventsPage />} />
          <Route path="/fights/:fightId" element={<EventsPage />} />
          <Route path="/fighters/:fighterId" element={<FighterPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/labs" element={<LabsPage />} />
        </Routes>
      </div>
      <CmdK open={searchOpen} onClose={() => setSearchOpen(false)} />
      {settingsOpen ? <SettingsMenu onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

/* oxlint-disable react/only-export-components -- provider, hook and the small
   settings helpers intentionally share one persistent source of truth. */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark";
export type RankingSource = "meta" | "media";
export type DateMode = "relative" | "date";
export type DivisionOrder = "light" | "heavy";
/** How a betting price displays: the American line or decimal payout. */
export type OddsFormat = "american" | "decimal";

export type AppSettings = {
  theme: ThemeMode;
  rankingSource: RankingSource;
  dateMode: DateMode;
  /** Which end of the scale the rankings start from. */
  divisionOrder: DivisionOrder;
  oddsFormat: OddsFormat;
  /** Whether a fighter profile's Statistics panel starts expanded. */
  topStatsOpen: boolean;
  /** How that panel orders its rows: by category, or best place first. */
  statsSort: StatsSort;
  /** Which end a card is read from: the main event down, or the opener up. */
  cardOrder: CardOrder;
};

export type CardOrder = "main" | "opener";

export type StatsSort = "grouped" | "best";

const DEFAULTS: AppSettings = {
  theme: "light",
  rankingSource: "media",
  dateMode: "relative",
  divisionOrder: "light",
  oddsFormat: "american",
  topStatsOpen: false,
  statsSort: "grouped",
  cardOrder: "main",
};
const STORAGE_KEY = "ufcsh:settings:v1";

function loadSettings(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      theme: saved?.theme === "dark" ? "dark" : "light",
      rankingSource: saved?.rankingSource === "meta" ? "meta" : "media",
      dateMode: saved?.dateMode === "date" ? "date" : "relative",
      divisionOrder: saved?.divisionOrder === "heavy" ? "heavy" : "light",
      oddsFormat: saved?.oddsFormat === "decimal" ? "decimal" : "american",
      topStatsOpen: saved?.topStatsOpen === true,
      statsSort: saved?.statsSort === "best" ? "best" : "grouped",
      cardOrder: saved?.cardOrder === "opener" ? "opener" : "main",
    };
  } catch {
    return DEFAULTS;
  }
}

const SettingsContext = createContext<{
  settings: AppSettings;
  update: (key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => void;
}>({ settings: DEFAULTS, update: () => undefined });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);
  // Apply the saved palette before the browser paints the application. This
  // avoids a light flash when a returning visitor has dark mode selected.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
    document.documentElement.style.colorScheme = settings.theme;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Settings still work for this visit when storage is unavailable.
    }
  }, [settings]);
  // A change saved from another tab lands here too, so every open tab stays
  // on the same preferences without a reload.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      setSettings(loadSettings());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const value = useMemo(() => ({
    settings,
    update: (key: keyof AppSettings, next: AppSettings[keyof AppSettings]) =>
      setSettings((current) => ({ ...current, [key]: next })),
  }), [settings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}

export function withRanking(path: string, source: RankingSource): string {
  return `${path}${path.includes("?") ? "&" : "?"}ranking=${source}`;
}

export function outsideFighterUrl(name: string, sherdogUrl: string | null): string {
  return sherdogUrl ?? `https://www.sherdog.com/search/fightfinder/?q=${encodeURIComponent(name)}`;
}

export function relativeDate(date: string, now = new Date()): string {
  const target = new Date(`${date}T12:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (Number.isNaN(target.getTime())) return date;
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  if (days === -1) return "1 day ago";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

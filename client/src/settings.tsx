/* oxlint-disable react/only-export-components -- provider, hook and the small
   settings helpers intentionally share one persistent source of truth. */
import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark";
export type RankingSource = "meta" | "media";
export type DateMode = "relative" | "date";

export type AppSettings = {
  theme: ThemeMode;
  rankingSource: RankingSource;
  dateMode: DateMode;
};

const DEFAULTS: AppSettings = {
  theme: "light",
  rankingSource: "meta",
  dateMode: "relative",
};
const STORAGE_KEY = "ufcsh:settings:v1";

function loadSettings(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      theme: saved?.theme === "dark" ? "dark" : "light",
      rankingSource: saved?.rankingSource === "media" ? "media" : "meta",
      dateMode: saved?.dateMode === "date" ? "date" : "relative",
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

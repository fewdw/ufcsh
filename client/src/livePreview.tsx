/* oxlint-disable react/only-export-components -- the flag, its hook and the
   panel are one small dev-only feature, like devStats. */
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { Radio, X } from "lucide-react";
import { isDevSite } from "./devStats";
import { useApi, type LiveCard, type LiveOddsAnswer } from "./api";
import { percent } from "./liveOdds";

/**
 * Dev sites only: makes the header's live pill show a bout on demand, so its
 * states can be seen in light and dark, on any screen, without a card running.
 * "Mock" is made-up prices (optionally moving like a fight); "Real" prices the
 * matchup open on the page from Polymarket, end to end, through the same
 * server code fight night uses.
 */
export type Scene = "next" | "live" | "none" | "final";
export type PreviewSettings = {
  on: boolean;
  scene: Scene;
  source: "mock" | "real";
  /** The first fighter's chance, 0–100. */
  chance: number;
  moving: boolean;
  winner: 1 | 2 | 0;
  method: string;
  /** The winner-to-be's chance before the walkout, 0–100. */
  prefight: number;
  fight: { id: string; f1: string; f2: string } | null;
};

const KEY = "ufcsh:live-preview";
const EVENT = "ufcsh:live-preview";
const DEFAULTS: PreviewSettings = {
  on: false, scene: "live", source: "mock", chance: 50, moving: false,
  winner: 2, method: "KO/TKO", prefight: 51, fight: null,
};
const MOCK_NAMES: [string, string] = ["Alexander Volkanovski", "Movsar Evloev"];

let cachedText: string | null = null;
let cached: PreviewSettings = DEFAULTS;
function read(): PreviewSettings {
  let text: string | null = null;
  try { text = localStorage.getItem(KEY); } catch { /* private mode: defaults */ }
  if (text !== cachedText) {
    cachedText = text;
    try { cached = { ...DEFAULTS, ...JSON.parse(text ?? "{}") }; } catch { cached = DEFAULTS; }
  }
  return cached;
}
export function updatePreview(change: Partial<PreviewSettings>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...change })); } catch { /* lasts this visit only */ }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange); };
}

export function usePreviewSettings(): PreviewSettings {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  return isDevSite ? settings : DEFAULTS;
}

/** What the pill shows in place of the real answers, or null when off. */
export function useLivePreview(): { card: LiveCard; answer: LiveOddsAnswer | null; oddsUrl: string | null } | null {
  const s = usePreviewSettings();
  if (!s.on) return null;
  const real = s.source === "real" && s.fight;
  const id = real ? s.fight!.id : "0000000000000000";
  const [f1, f2] = real ? [s.fight!.f1, s.fight!.f2] : MOCK_NAMES;
  const fighter = (name: string) => ({ id: "", name, profile_eligible: false, nickname: "", record: "", photo_url: null, ranking: null });
  const card = {
    event: { id: "", name: "Live preview", date: "", location: "", status: "current" },
    completed_fights: 11, total_fights: 12, fight_number: 12,
    live: s.scene !== "next",
    starts_at: s.scene === "next" ? Date.now() + 25 * 60_000 : null,
    fight: { id, ord: 0, segment: null, weight_class: "", title_fight: false, f1: fighter(f1), f2: fighter(f2) },
  } as unknown as LiveCard;
  if (real) return { card, answer: null, oddsUrl: `/api/live/odds?fight=${id}` };
  const chance = Math.min(1, Math.max(0, s.chance / 100));
  const odds = s.scene === "none" ? null : { f1: chance, f2: 1 - chance, url: "https://polymarket.com/sports/ufc", closed: false };
  const finished = s.scene !== "final" ? null : {
    id, f1_name: f1, f2_name: f2,
    f1_outcome: s.winner === 0 ? "draw" : s.winner === 1 ? "win" : "loss",
    f2_outcome: s.winner === 0 ? "draw" : s.winner === 2 ? "win" : "loss",
    winner: s.winner === 0 ? null : s.winner,
    method: s.winner === 0 ? "S-DEC" : s.method, round: s.method.includes("DEC") || s.winner === 0 ? "5" : "2", time: "3:12",
    prefight: s.winner === 2 ? [1 - s.prefight / 100, s.prefight / 100] as [number, number] : [s.prefight / 100, 1 - s.prefight / 100] as [number, number],
    url: null, remaining_ms: 5 * 60_000,
  };
  return { card, answer: { fight_id: id, odds, finished }, oddsUrl: null };
}

/** Moves the mock price like a fight: small drifts, now and then a swing. */
function useMovingPrice(s: PreviewSettings) {
  const active = s.on && s.moving && s.source === "mock" && (s.scene === "live" || s.scene === "next");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const { chance } = read();
      const swing = Math.random() < 0.15 ? (Math.random() - 0.5) * 30 : (Math.random() - 0.5) * 4;
      updatePreview({ chance: Math.round(Math.min(99.6, Math.max(0.4, chance + swing)) * 10) / 10 });
    }, 2_000);
    return () => clearInterval(timer);
  }, [active]);
}

const SCENES: [Scene, string][] = [["next", "Next"], ["live", "Live"], ["none", "No market"], ["final", "Result"]];
const METHODS = ["KO/TKO", "SUB", "U-DEC"];
const chip = (on: boolean) => `rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${on ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-100"}`;

/** The panel pinned bottom left while the preview is on. */
export function LivePreviewPanel() {
  const s = usePreviewSettings();
  const location = useLocation();
  const pageFight = /^\/fights\/([a-f0-9]{16})/i.exec(location.pathname)?.[1] ?? null;
  const { data: matchup } = useApi<{ f1: { name: string }; f2: { name: string } }>(s.on && pageFight ? `/api/fights/${pageFight}` : null);
  useMovingPrice(s);
  if (!s.on) return null;
  const names = s.source === "real" && s.fight ? [s.fight.f1, s.fight.f2] : MOCK_NAMES;
  const mock = s.source === "mock";
  return createPortal(
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] left-2 z-50 flex w-[17rem] flex-col gap-2 rounded-lg bg-zinc-900/95 p-2.5 font-mono text-[11px] leading-tight text-zinc-100 shadow-lg backdrop-blur sm:bottom-2">
      <div className="flex items-center gap-1.5 font-semibold">
        <Radio className="h-3 w-3" aria-hidden="true" />Live preview
        <button type="button" onClick={() => updatePreview({ on: false })} className="ml-auto rounded p-0.5 text-zinc-400 hover:text-zinc-100" aria-label="Close the live preview">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={chip(mock)} onClick={() => updatePreview({ source: "mock" })}>Mock</button>
        <button type="button" className={chip(!mock)} disabled={!(pageFight && matchup) && !s.fight}
          title={pageFight ? "Polymarket's real price for the matchup on this page" : "Open a matchup page first"}
          onClick={() => updatePreview({ source: "real", scene: "live", fight: pageFight && matchup ? { id: pageFight, f1: matchup.f1.name, f2: matchup.f2.name } : s.fight })}>
          Real {pageFight ? "(this fight)" : s.fight ? "" : "(open a fight)"}
        </button>
      </div>
      {mock ? (
        <>
          <div className="flex flex-wrap gap-1">
            {SCENES.map(([scene, label]) => (
              <button key={scene} type="button" className={chip(s.scene === scene)} onClick={() => updatePreview({ scene })}>{label}</button>
            ))}
          </div>
          {s.scene === "final" ? (
            <>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-zinc-400">Winner</span>
                {([[1, names[0]], [2, names[1]], [0, "Draw"]] as const).map(([winner, name]) => (
                  <button key={winner} type="button" className={chip(s.winner === winner)} onClick={() => updatePreview({ winner })}>{winner ? name.split(" ").at(-1) : name}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-zinc-400">By</span>
                {METHODS.map((method) => (
                  <button key={method} type="button" className={chip(s.method === method)} onClick={() => updatePreview({ method })}>{method}</button>
                ))}
              </div>
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-zinc-400">Winner pre-fight</span>
                <input type="range" min={1} max={99} value={s.prefight} onChange={(e) => updatePreview({ prefight: Number(e.target.value) })} className="min-w-0 flex-1" />
                <span className="w-8 text-right tabular-nums">{s.prefight}%</span>
              </label>
            </>
          ) : s.scene !== "none" ? (
            <>
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-zinc-400">{names[0].split(" ").at(-1)}</span>
                <input type="range" min={0} max={100} step={0.5} value={s.chance} onChange={(e) => updatePreview({ chance: Number(e.target.value) })} className="min-w-0 flex-1" />
                <span className="w-8 text-right tabular-nums">{percent(s.chance / 100)}</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={s.moving} onChange={(e) => updatePreview({ moving: e.target.checked })} />
                <span>Move like a fight (every 2s)</span>
              </label>
            </>
          ) : <p className="text-zinc-400">A bout Polymarket has no market for: the pill shows no prices.</p>}
        </>
      ) : (
        <p className="text-zinc-400">
          {s.fight ? `${s.fight.f1} vs ${s.fight.f2}: Polymarket's price, read through /api/live/odds every 3s. No market shows no prices.` : "Open a matchup page, then press Real."}
        </p>
      )}
    </div>,
    document.body,
  );
}

import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import type { PredictionMarket } from "../settings";

const MARKET_SOURCES: { id: PredictionMarket; label: string }[] = [
  { id: "polymarket", label: "Polymarket" },
  { id: "kalshi", label: "Kalshi" },
];

/** Which prediction market the matchup shows, kept for every matchup
 *  (the `predictionMarket` setting). */
export default function MarketSourceTabs({ source, onChange }: { source: PredictionMarket; onChange: (source: PredictionMarket) => void }) {
  return (
    <div className={segmentedGroup} role="group" aria-label="Prediction market">
      {MARKET_SOURCES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={source === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${source === option.id ? segmentedSelected : segmentedIdle}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

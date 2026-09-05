import { Star } from "lucide-react";
import type { CardQuality } from "../api";

/** Lucide stars, clipped to quarter-star steps; the exact 0–100 score is
 * available on hover/focus and to assistive technology, only at card titles. */
export default function CardStars({ quality, small = false }: { quality?: CardQuality; small?: boolean }) {
  // An announced card with only a couple of bouts on it carries no rating yet,
  // and no stars either: dim stars read as a verdict, and there isn't one.
  if (!quality || !quality.score) return null;
  const stars = Math.round(quality.score / 5) / 4;
  // A review says what the card delivered against what it promised; the
  // pre-fight number is kept, not overwritten, so the move is readable.
  const move = quality.expected == null ? null : quality.score - quality.expected;
  const label = `Card quality ${quality.basis === "preview" ? "estimate" : "review"}: ${quality.score}/100. ${quality.coverage}% input coverage. Editorial model v${quality.version}, not a guarantee of entertainment.`;
  const versus = move == null ? ""
    : `\nExpected ${quality.expected}/100 from the lineup; the fights ${move > 0 ? `added ${move}` : move < 0 ? `cost ${-move}` : "moved it 0"}.`;
  const details = quality.factors.map((factor) => `${factor.label}: ${factor.value}/100 (${factor.weight}% weight)`).join("\n");
  return <span role="img" aria-label={`${label}${versus}`} tabIndex={0} title={`${label}${versus}\n${details}`} className="inline-flex shrink-0 items-center gap-0.5 rounded-sm align-middle" style={{ color: "#d4a017" }}>
    {Array.from({ length: 5 }, (_, i) => { const fill = Math.max(0, Math.min(1, stars - i)); return <span key={i} className="relative inline-block" style={{ width: small ? 10 : 15, height: small ? 10 : 15 }} aria-hidden="true">
      <Star size={small ? 10 : 15} strokeWidth={1.5} fill="currentColor" className={`absolute inset-0 ${fill === 1 ? "" : "opacity-25"}`} />
      {fill > 0 && fill < 1 ? <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
        <Star size={small ? 10 : 15} strokeWidth={1.5} fill="currentColor" className="absolute left-0 top-0 max-w-none" />
      </span> : null}
    </span>; })}
  </span>;
}

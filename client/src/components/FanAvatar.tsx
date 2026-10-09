import { useState } from "react";
import ProgressiveImage from "./ProgressiveImage";

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-[11px]",
  lg: "h-12 w-12 text-base",
} as const;

/** A fan's picture, or the first letter of their name when they have none —
 *  the same fallback in discussions, scorecards, leaderboards and profiles. */
export default function FanAvatar({ src, name, size = "sm" }: { src: string | null; name: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false);
  const box = `${SIZES[size]} shrink-0 rounded-full bg-surface-strong ring-1 ring-line`;
  if (!src || failed) {
    const letter = name.trim().slice(0, 1).toUpperCase();
    return <span aria-hidden="true" className={`${box} grid place-items-center font-medium text-muted`}>{/^[A-Z0-9]$/.test(letter) ? letter : "?"}</span>;
  }
  return <ProgressiveImage src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${box} object-cover`} />;
}

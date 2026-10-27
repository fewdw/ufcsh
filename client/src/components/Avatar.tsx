import { useEffect, useState } from "react";
import ProgressiveImage from "./ProgressiveImage";
import placeholder from "../assets/fighter-placeholder.webp";

const SIZES = {
  tag: "h-4 w-4 text-[6px]",
  xs: "h-7 w-7 text-[9px]",
  sm: "h-9 w-9 text-[11px]",
  md: "h-12 w-12 text-xs",
  lg: "h-20 w-20 text-lg",
  xl: "h-28 w-28 text-xl",
  // A list row that tightens to one line on a wide screen.
  row: "h-9 w-9 text-[11px] xl:h-6 xl:w-6 xl:text-[8px]",
  matchup: "h-13 w-13 text-xs lg:h-15 lg:w-15 lg:text-sm",
  // A bout on an event card: one compact row per fight.
  bout: "h-10 w-10 text-[11px]",
  // As large as its container, which sets the size.
  fill: "h-full w-full text-lg",
} as const;

const UFC_EMPTY_AVATAR = placeholder;

export default function Avatar({
  src,
  name,
  size = "sm",
  winner = false,
  outcome,
  bare = false,
}: {
  src: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
  winner?: boolean;
  outcome?: "win" | "loss" | "draw" | "nc" | null;
  /** Unframed: no circle or ring, the photo faded out at its crop like a
   *  full-body cut-out. */
  bare?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    setAttempt(0);
  }, [src]);
  useEffect(() => {
    if (!failed || !src) return;
    const timer = window.setTimeout(() => {
      setAttempt((value) => value + 1);
      setFailed(false);
    }, Math.min(30_000 * 2 ** Math.min(attempt, 4), 300_000));
    return () => window.clearTimeout(timer);
  }, [failed, src, attempt]);
  const usable = src && !src.includes("silhouette.svg") && !src.includes("no-profile-image");
  const imageSrc = usable && !failed
    ? attempt ? `${src}${src.includes("?") ? "&" : "?"}photo_retry=${attempt}` : src
    : UFC_EMPTY_AVATAR;
  const outline =
    outcome === "win" || winner
      ? "ring-2 ring-emerald-500"
      : outcome === "loss"
        ? "ring-2 ring-rose-500"
        : outcome === "draw"
          ? "ring-2 ring-amber-500"
          : outcome === "nc"
            ? "ring-2 ring-zinc-700"
            : "ring-1 ring-zinc-200";
  const prominent = size === "xl" || size === "lg" || size === "matchup" || size === "bout";
  return (
    <ProgressiveImage
      key={`${src}:${attempt}`}
      src={imageSrc}
      alt={name}
      loading={prominent ? "eager" : "lazy"}
      fetchPriority={prominent ? "high" : "auto"}
      decoding="async"
      onError={() => {
        if (imageSrc !== UFC_EMPTY_AVATAR) setFailed(true);
      }}
      className={`${SIZES[size]} shrink-0 object-cover object-top ${bare ? "portrait-fade" : `${outline} rounded-full bg-zinc-100`}`}
    />
  );
}

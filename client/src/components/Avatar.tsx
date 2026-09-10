import { useEffect, useState } from "react";

const SIZES = {
  xs: "h-7 w-7 text-[9px]",
  sm: "h-9 w-9 text-[11px]",
  md: "h-12 w-12 text-xs",
  lg: "h-20 w-20 text-lg",
  xl: "h-28 w-28 text-xl",
  matchup: "h-13 w-13 text-xs lg:h-15 lg:w-15 lg:text-sm",
} as const;

const UFC_EMPTY_AVATAR = "/fighter-placeholder.png";

export default function Avatar({
  src,
  name,
  size = "sm",
  winner = false,
  outcome,
}: {
  src: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
  winner?: boolean;
  outcome?: "win" | "loss" | "draw" | "nc" | null;
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
  const prominent = size === "xl" || size === "lg" || size === "matchup";
  return (
    <img
      key={`${src}:${attempt}`}
      src={imageSrc}
      alt={name}
      loading={prominent ? "eager" : "lazy"}
      fetchPriority={prominent ? "high" : "auto"}
      decoding="async"
      onError={() => {
        if (imageSrc !== UFC_EMPTY_AVATAR) setFailed(true);
      }}
      className={`${SIZES[size]} ${outline} shrink-0 rounded-full bg-zinc-100 object-cover object-top`}
    />
  );
}

const SIZES = {
  xs: "h-7 w-7 text-[9px]",
  sm: "h-9 w-9 text-[11px]",
  md: "h-12 w-12 text-xs",
  lg: "h-20 w-20 text-lg",
  xl: "h-28 w-28 text-xl",
  matchup: "h-14 w-14 text-xs lg:h-16 lg:w-16 lg:text-sm",
} as const;

const UFC_EMPTY_AVATAR = "/silhouette.svg";

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
      src={src || UFC_EMPTY_AVATAR}
      alt={name}
      loading={prominent ? "eager" : "lazy"}
      fetchPriority={prominent ? "high" : "auto"}
      decoding="async"
      onError={(event) => {
        const image = event.currentTarget;
        if (image.dataset.fallbackApplied) return;
        image.dataset.fallbackApplied = "true";
        image.src = UFC_EMPTY_AVATAR;
      }}
      className={`${SIZES[size]} ${outline} shrink-0 rounded-full bg-zinc-100 object-cover object-top`}
    />
  );
}

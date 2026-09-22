import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import ProgressiveImage from "./ProgressiveImage";

/** ufc.com cuts every full body to 460×700, so these boxes carry that exact
 *  ratio: the picture fills them edge to edge with nothing letterboxed and
 *  nothing cropped, and both corners are drawn to one scale. */
const FRAME = {
  hero: "h-40 w-[6.6rem] lg:h-52 lg:w-[8.6rem]",
  profile: "h-48 w-[7.9rem] sm:h-56 sm:w-[9.2rem]",
} as const;

/** A wash in the fighter's own corner colour, the same blue and red every
 *  panel and chart on the page uses. */
const HALO: Record<string, string> = {
  f1: "bg-f1/10",
  f2: "bg-f2/10",
  none: "bg-zinc-500/10",
};

/** The round avatar carries the result in its ring. A cut-out has no edge to
 *  ring, so the result tints the ground it stands on instead. */
const BASE: Record<string, string> = {
  win: "bg-emerald-500/40",
  loss: "bg-rose-500/35",
  draw: "bg-amber-500/35",
  nc: "bg-zinc-500/35",
};

const AVATAR_SIZE = { hero: "lg", profile: "xl" } as const;

/** The ufc.com full-body cut-out, unframed on the floor line with its crop
 * faded out. Any failure falls back to the round headshot. */
export default function FighterPortrait({
  src,
  headshot,
  name,
  size = "hero",
  corner = "none",
  glow = true,
  onUnavailable,
  outcome,
}: {
  src: string | null | undefined;
  headshot: string | null | undefined;
  name: string;
  size?: keyof typeof FRAME;
  corner?: "f1" | "f2" | "none";
  glow?: boolean;
  onUnavailable?: () => void;
  outcome?: "win" | "loss" | "draw" | "nc" | null;
}) {
  const [failed, setFailed] = useState(false);
  // A different fighter (or a switch back to full body) deserves its own
  // attempt; without this the first broken picture would sink every later one.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return <Avatar src={headshot} name={name} size={AVATAR_SIZE[size]} outcome={outcome} />;

  return (
    <span data-fighter-portrait="full" className={`relative flex ${FRAME[size]} shrink-0 items-end justify-center`}>
      {/* Sits behind the torso and head, not the feet: a wash pooling at the
          bottom would read as spilt colour rather than as depth. */}
      {glow ? <span aria-hidden="true" className={`absolute inset-x-2 bottom-12 top-3 rounded-[50%] blur-2xl ${HALO[corner]}`} /> : null}
      {glow ? <span
        aria-hidden="true"
        className={`absolute bottom-1 h-1.5 w-3/5 rounded-[50%] blur-[3px] ${outcome ? BASE[outcome] : "bg-zinc-500/25"}`}
      /> : null}
      <ProgressiveImage
        key={src}
        src={src}
        alt={name}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        onError={() => { setFailed(true); onUnavailable?.(); }}
        className="portrait-fade relative h-full w-full object-contain object-bottom"
      />
    </span>
  );
}

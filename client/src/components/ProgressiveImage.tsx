import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string };
/** `covers` is the tallest rendering, in device pixels, a level is sharp enough for. */
type Level = { url: string; covers: number };

/** Mirrors VARIANT_HEIGHT on the server. */
const SMALL_HEIGHT = { head: 160, full: 320 };
const CLERK_SMALL = 128;

/** Fighter photos: a placeholder, a small copy and the original. Fan portraits
 *  get the same ladder from Clerk's image CDN. Anything else loads as is. */
function imageLevels(src: string): Level[] {
  const fighter = /^\/api\/images\/[a-f0-9]{16}(\/full)?(?:\?|$)/i.exec(src);
  if (fighter) {
    const join = src.includes("?") ? "&" : "?";
    return [
      { url: `${src}${join}size=tiny`, covers: 0 },
      { url: `${src}${join}size=small`, covers: SMALL_HEIGHT[fighter[1] ? "full" : "head"] },
      { url: src, covers: Infinity },
    ];
  }
  try {
    const url = new URL(src);
    if (url.hostname === "img.clerk.com" || url.hostname === "images.clerk.dev") {
      const sized = (size: number, quality: number) => {
        const copy = new URL(url);
        copy.searchParams.set("width", String(size));
        copy.searchParams.set("height", String(size));
        copy.searchParams.set("quality", String(quality));
        copy.searchParams.set("fit", "crop");
        return copy.toString();
      };
      return [{ url: sized(32, 40), covers: 0 }, { url: sized(CLERK_SMALL, 72), covers: CLERK_SMALL }, { url: src, covers: Infinity }];
    }
  } catch { /* A relative static asset loads as it is. */ }
  return [{ url: src, covers: Infinity }];
}

/** Every copy already decoded here. Remembering them, rather than probing
 *  with `new Image()`, matters: a probe is a real request, so probing each
 *  level would download the original of every avatar on the page. They are
 *  kept across reloads too: photo URLs are versioned and cached for a year, so
 *  a reload paints the sharp copy straight from the browser's cache instead of
 *  climbing up from the placeholder again. */
const DECODED_KEY = "ufcsh:decoded-images:v1";
const decoded = new Set<string>((() => {
  try { return JSON.parse(localStorage.getItem(DECODED_KEY) ?? "[]") as string[]; } catch { return []; }
})());
let saving = 0;
function markDecoded(url: string) {
  if (decoded.has(url)) return;
  decoded.add(url);
  if (saving) return;
  saving = window.setTimeout(() => {
    saving = 0;
    try { localStorage.setItem(DECODED_KEY, JSON.stringify([...decoded].slice(-4000))); } catch { /* storage full or off */ }
  }, 1000);
}

/** A copy already decoded on this page can be shown straight away. */
function firstLevel(levels: Level[]): number {
  for (let index = levels.length - 1; index > 0; index--) if (decoded.has(levels[index].url)) return index;
  return 0;
}

/** Paints the placeholder at once, then swaps in each sharper copy only after
 *  it has decoded, stopping at the first one sharp enough for the rendered size. */
function ImageForSource({ src, onLoad, onError, loading, decoding, ...props }: Props) {
  const levels = useMemo(() => imageLevels(src), [src]);
  const [level, setLevel] = useState(() => firstLevel(levels));
  // A copy the browser already holds is drawn with the page, not after it.
  const [cached] = useState(() => decoded.has(levels[level].url));
  const [needed, setNeeded] = useState<number | null>(null);

  useEffect(() => {
    if (needed === null || level >= levels.length - 1 || levels[level].covers >= needed) return;
    let cancelled = false;
    const next = level + 1;
    const image = new Image();
    image.src = levels[next].url;
    image.decode().then(
      () => { markDecoded(levels[next].url); if (!cancelled) setLevel(next); },
      () => { if (!cancelled && next < levels.length - 1) setLevel(next); },
    );
    return () => { cancelled = true; };
  }, [level, levels, needed]);

  return <img
    {...props}
    loading={cached ? "eager" : loading}
    decoding={cached ? "sync" : decoding}
    src={levels[level].url}
    onLoad={event => {
      markDecoded(levels[level].url);
      const box = event.currentTarget;
      setNeeded(Math.ceil(Math.max(box.clientHeight, box.clientWidth * 0.625) * (window.devicePixelRatio || 1)));
      onLoad?.(event);
    }}
    onError={event => {
      if (level < levels.length - 1) setLevel(level + 1);
      else onError?.(event);
    }}
  />;
}

export default function ProgressiveImage(props: Props) {
  return <ImageForSource key={props.src} {...props} />;
}

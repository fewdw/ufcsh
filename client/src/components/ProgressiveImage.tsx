import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ImgHTMLAttributes } from "react";
import { decoded, decodedHere, firstLevel, imageLevels, levelFor, markDecoded, neededFor } from "../imageLevels";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string };

/** Paints the placeholder at once, then swaps in each sharper copy only after
 *  it has decoded, stopping at the first one sharp enough for the rendered size. */
function ImageForSource({ src, onLoad, onError, loading, decoding, ...props }: Props) {
  const levels = useMemo(() => imageLevels(src), [src]);
  const [level, setLevel] = useState(() => firstLevel(levels));
  // A copy the browser already holds is drawn with the page, not after it.
  const [cached] = useState(() => decoded.has(levels[level].url));
  // A sharp copy remembered from an earlier visit may have left the browser's
  // cache since. It stays hidden until fully loaded, so it never paints top to
  // bottom while downloading; if it is slow, the placeholder takes its place.
  const [visible, setVisible] = useState(() => level === 0 || decodedHere.has(levels[level].url));
  useEffect(() => {
    if (visible) return;
    const timer = window.setTimeout(() => { setLevel(0); setVisible(true); }, 150);
    return () => window.clearTimeout(timer);
  }, [visible]);
  const [needed, setNeeded] = useState<number | null>(null);
  // An eager picture's box is sized by its CSS before anything loads, so the
  // copy it needs is fetched alongside the placeholder rather than after it.
  // A lazy one waits for its placeholder: fetching here would load every
  // avatar in a long list at once.
  const element = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (loading === "lazy" || !element.current) return;
    const size = neededFor(element.current);
    if (size > 0) setNeeded(size);
  }, [loading]);

  // Straight to the copy the box needs, not up through each one in turn.
  useEffect(() => {
    if (needed === null) return;
    const target = levelFor(levels, needed);
    if (target <= level) return;
    let cancelled = false;
    const image = new Image();
    image.src = levels[target].url;
    image.decode().then(
      () => { markDecoded(levels[target].url); if (!cancelled) setLevel(target); },
      () => {
        if (cancelled) return;
        // The img tries it and steps on from its own error; a failed largest
        // copy settles for the one below it.
        if (target < levels.length - 1) setLevel(target);
        else if (target - 1 > level) setLevel(target - 1);
      },
    );
    return () => { cancelled = true; };
  }, [level, levels, needed]);

  return <img
    {...props}
    ref={element}
    loading={cached ? "eager" : loading}
    decoding={cached ? "sync" : decoding}
    src={levels[level].url}
    style={visible ? props.style : { ...props.style, opacity: 0 }}
    onLoad={event => {
      markDecoded(levels[level].url);
      setVisible(true);
      setNeeded(neededFor(event.currentTarget));
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

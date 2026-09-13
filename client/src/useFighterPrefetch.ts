import { useEffect } from "react";
import { prefetch } from "./api";
import { withRanking } from "./settings";

/** One delegated listener covers fighter links in cards, search and rankings. */
export function useFighterPrefetch(rankingSource: Parameters<typeof withRanking>[1]) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLAnchorElement | null = null;
    const cancel = () => { clearTimeout(timer); timer = undefined; target = null; };
    const warm = (anchor: HTMLAnchorElement) => {
      const url = new URL(anchor.href, window.location.href);
      const match = /^\/fighters\/([a-f0-9]+)\/?$/.exec(url.pathname);
      if (url.origin !== window.location.origin || !match) return;
      prefetch(withRanking(`/api/fighters/${match[1]}`, rankingSource));
      void import("./pages/FighterPage").catch(() => {});
    };
    const enter = (event: Event) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href*="/fighters/"]') : null;
      if (!anchor) return;
      if (event.type !== "pointerover") { cancel(); warm(anchor); return; }
      if (target === anchor) return;
      cancel();
      target = anchor;
      timer = setTimeout(() => warm(anchor), 120);
    };
    const leave = (event: PointerEvent) => {
      if (target && (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget))) cancel();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("pointerdown", enter);
    return () => {
      cancel();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("pointerdown", enter);
    };
  }, [rankingSource]);
}

import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, following it as the window changes. */
export default function useMediaQuery(media: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(media);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(media).matches,
    () => false,
  );
}

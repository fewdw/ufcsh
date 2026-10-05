import { useLayoutEffect, useRef, type ReactNode } from "react";
import useSheetDrag from "../useSheetDrag";

/** Shared career-evidence modal on desktop and draggable bottom sheet on phones. */
export default function EvidenceDialog({ id, close, wide, children }: { id: string; close: () => void; wide?: boolean; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useSheetDrag(dialog, close);
  useLayoutEffect(() => {
    const node = dialog.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal();
    node.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    // Release native modal inertness before React Router changes history.
    // Bubble after the drag helper has rejected accidental taps after a swipe.
    const releaseForLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link && link.getAttribute("target") !== "_blank" && !event.defaultPrevented
        && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) node.close();
    };
    node.addEventListener("click", releaseForLink);
    return () => {
      node.removeEventListener("click", releaseForLink);
      node.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}
    className={`search-dialog fixed inset-x-0 bottom-0 top-auto m-0 h-[80dvh] w-full max-h-none max-w-none overflow-hidden rounded-t-2xl border border-b-0 border-zinc-200 bg-white p-0 pb-[env(safe-area-inset-bottom)] text-zinc-900 shadow-2xl transition-transform duration-200 motion-reduce:transition-none sm:inset-0 sm:m-auto sm:h-[min(34rem,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] sm:rounded-2xl sm:border-b sm:pb-0 ${wide ? "sm:max-w-5xl" : "sm:max-w-2xl"}`}>
    <div className="flex h-full flex-col">
      <div aria-hidden="true" className="flex h-6 shrink-0 items-center justify-center sm:hidden"><span className="h-1 w-9 rounded-full bg-zinc-300" /></div>
      {children}
    </div>
  </dialog>;
}

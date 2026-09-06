import { useEffect, useId, useRef, useState } from "react";

/** Keep keyboard focus in the input while the active option stays in view. */
export function useSearchSelection(keys: string[], open: boolean) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ signature: string; index: number } | null>(null);
  const signature = JSON.stringify(keys);
  const active = selection?.signature === signature ? Math.max(0, Math.min(selection.index, keys.length - 1)) : 0;
  const setActive = (index: number) => setSelection({ signature, index });
  const optionId = (index: number) => `${listId}-${index}`;
  const activeId = open && keys.length ? optionId(active) : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, signature]);

  const move = (key: string) => {
    if (key === "ArrowDown") setActive(Math.min(active + 1, keys.length - 1));
    else if (key === "ArrowUp") setActive(Math.max(active - 1, 0));
  };
  return { listId, listRef, active, activeId, setActive, optionId, move };
}

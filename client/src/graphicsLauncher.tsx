/* oxlint-disable react/only-export-components -- provider and hook are one feature. */
import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Kind } from "./graphics/build";

const GraphicsBuilder = lazy(() => import("./components/GraphicsBuilder"));

export type GraphicSubject = { kind: Kind; id: string } | null;

const GraphicsContext = createContext<(subject?: GraphicSubject) => void>(() => {});

/** One builder for the whole app, opened from wherever the reader is, with
 *  what they are looking at already chosen. Its code loads on first use. */
export function GraphicsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ subject: GraphicSubject } | null>(null);
  const launch = useCallback((subject: GraphicSubject = null) => setOpen({ subject }), []);
  const value = useMemo(() => launch, [launch]);
  return (
    <GraphicsContext.Provider value={value}>
      {children}
      {open ? (
        <Suspense fallback={null}>
          <GraphicsBuilder initial={open.subject} onClose={() => setOpen(null)} />
        </Suspense>
      ) : null}
    </GraphicsContext.Provider>
  );
}

export function useGraphics() {
  return useContext(GraphicsContext);
}

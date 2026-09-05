import { useEffect, useState } from "react";

/**
 * A clock that only ticks while something is counting down to it. Every start
 * time the API sends is an absolute instant, so a countdown is local
 * arithmetic — this is the re-render that keeps it honest, and it stops the
 * moment nothing is waiting on it.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

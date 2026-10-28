import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { evaluateMarketWatch } from "../market-watch";
import { updateMarketWatches, useMarketWatches } from "../marketWatchStore";
import { useMarketData } from "../useMarketData";
import type { MarketSummary } from "../polymarket-types";

export default function MarketMonitor() {
  const state = useMarketWatches();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const fights = state.watches
    .filter((w) => w.kind === "fight")
    .map((w) => w.id)
    .sort()
    .join(",");
  const fighters = state.watches
    .filter((w) => w.kind === "fighter")
    .map((w) => w.id)
    .sort()
    .join(",");
  const watched = useMarketData<{ fights: MarketSummary[] }>(
    fights ? `/api/polymarket/board?ids=${fights}` : null,
    15_000,
  );
  const followed = useMarketData<{ fights: MarketSummary[] }>(
    fighters ? `/api/polymarket/board?fighters=${fighters}` : null,
    15_000,
  );
  useEffect(() => {
    if (!watched.data && !followed.data) return;
    updateMarketWatches((current) => {
      const cursors = { ...current.cursors };
      const alerts = [...current.alerts];
      const rows = new Map(
        [...(watched.data?.fights ?? []), ...(followed.data?.fights ?? [])].map(
          (r) => [r.fight.id, r],
        ),
      );
      for (const row of rows.values()) {
        const watches = current.watches.filter((w) =>
          w.kind === "fight"
            ? w.id === row.fight.id
            : w.id === row.fight.f1.id || w.id === row.fight.f2.id,
        );
        // One alert per fight observation even when both fighter and fight are followed.
        const watch = watches.sort((a, b) => a.threshold - b.threshold)[0];
        if (!watch) continue;
        const evaluated = evaluateMarketWatch(
          { ...watch, favourite: watches.some((w) => w.favourite) },
          row,
          cursors[row.fight.id],
          Date.now(),
        );
        if (evaluated.cursor) cursors[row.fight.id] = evaluated.cursor;
        if (
          evaluated.alert &&
          !alerts.some((a) => a.id === evaluated.alert!.id)
        )
          alerts.unshift(evaluated.alert);
      }
      return { ...current, cursors, alerts: alerts.slice(0, 100) };
    });
  }, [watched.data, followed.data]);
  const latest = state.alerts.find(
    (a) => !a.read && Date.now() - a.at < 60_000 && a.id !== dismissed,
  );
  return latest ? (
    <div
      role="status"
      className="fixed bottom-20 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900 sm:bottom-4"
    >
      <Link to="/markets?view=watchlist" className="max-w-72">
        <span className="block font-semibold">{latest.label}</span>
        <span className="mt-1 block text-zinc-500">{latest.message}</span>
      </Link>
      <button
        type="button"
        aria-label="Dismiss market alert"
        onClick={() => setDismissed(latest.id)}
      >
        ×
      </button>
    </div>
  ) : null;
}

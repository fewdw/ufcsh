import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSeo } from "../seo";
import { isDevSite } from "../devStats";
import { useMarketData } from "../useMarketData";
import { useNow } from "../useNow";
import { evaluateMarketWatch } from "../market-watch";
import { updateMarketWatches, useMarketWatches } from "../marketWatchStore";
import {
  MARKET_SCENES,
  marketDemo,
  marketDemoAnalytics,
  type MarketScene,
} from "../market-demo";
import type {
  ExtraMarket,
  MarketAnalytics,
  MarketSummary,
} from "../polymarket-types";
import {
  ExtraMarkets,
  MarketBoard,
  PolymarketView,
  MARKET_BUTTON,
  MARKET_SHELL,
  marketPct,
} from "../components/PolymarketPanel";

const VIEWS = [
  ["board", "Fight board"],
  ["watchlist", "Watchlist & alerts"],
  ["accuracy", "Market accuracy"],
  ["explore", "More markets"],
] as const;

function Accuracy({ demo = false }: { demo?: boolean }) {
  const {
    data: real,
    error,
    retry,
  } = useMarketData<MarketAnalytics>(
    demo ? null : "/api/polymarket/analytics",
    60_000,
  );
  const data = demo ? marketDemoAnalytics() : real;
  return (
    <section className={`${MARKET_SHELL} p-4 sm:p-5`}>
      <h2 className="text-sm font-semibold">Who predicted it better?</h2>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
        Compare Polymarket, sportsbook probabilities with the margin removed,
        and community pick shares against confirmed winners.
      </p>
      {!data ? (
        <p role="status" className="mt-4 text-xs text-zinc-500">
          {error ? (
            <>
              Accuracy data unavailable.{" "}
              <button className="underline" onClick={retry}>
                Retry
              </button>
            </>
          ) : (
            "Loading accuracy…"
          )}
        </p>
      ) : (
        <>
          <div className="my-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <strong className="block text-2xl tabular-nums">
                {data.fights}
              </strong>
              <span className="text-[11px] text-zinc-500">
                Completed fights with captured pre-fight prices
              </span>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <strong className="block text-2xl tabular-nums">
                {data.common}
              </strong>
              <span className="text-[11px] text-zinc-500">
                Same fights with all three sources
              </span>
            </div>
          </div>
          {!data.common ? (
            <p className="mb-4 text-xs leading-relaxed text-zinc-500">
              A fair comparison needs all three sources captured before the card
              starts, including at least 10 community picks. Results will
              accumulate as tracked events finish.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-zinc-500">
                <tr>
                  <th className="pb-3 font-medium">Source</th>
                  <th className="pb-3 text-right font-medium">Fights</th>
                  <th className="pb-3 text-right font-medium">Brier ↓</th>
                  <th className="pb-3 text-right font-medium">
                    Winner accuracy
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr
                    key={s.name}
                    className="border-t border-zinc-200 dark:border-zinc-700"
                  >
                    <th scope="row" className="py-3 font-medium">
                      {s.name}
                    </th>
                    <td className="text-right tabular-nums">{s.n}</td>
                    <td className="text-right tabular-nums">
                      {s.brier?.toFixed(3) ?? "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {marketPct(s.accuracy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Lower Brier scores mean probabilities were closer to outcomes; 0 is
            perfect and a constant 50% scores 0.25. Winner accuracy omits exact
            50/50 calls.
          </p>
          {data.common ? (
            <div className="mt-6">
              <h3 className="mb-3 text-xs font-semibold">
                Calibration · expected vs actual wins
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                {data.sources.map((s) => (
                  <div key={s.name}>
                    <h4 className="mb-2 text-xs font-medium">{s.name}</h4>
                    {s.bins
                      .filter((b) => b.n)
                      .map((b) => (
                        <div key={b.from} className="mb-3">
                          <div className="mb-1 flex justify-between gap-2 text-[10px] text-zinc-500">
                            <span>
                              {Math.round(b.from * 100)}–
                              {Math.round(b.to * 100)}% · {b.n} fights
                            </span>
                            <span>
                              {marketPct(b.predicted)} / {marketPct(b.actual)}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className="h-1.5 rounded-full bg-blue-500"
                              style={{ width: `${b.predicted * 100}%` }}
                            />
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className="h-1.5 rounded-full bg-emerald-500"
                              style={{ width: `${b.actual * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-zinc-500">
                Blue: mean predicted probability. Green: actual win rate for the
                first-listed fighter. Small samples are noisy.
              </p>
            </div>
          ) : null}
          <details className="mt-5 text-xs text-zinc-500">
            <summary className="cursor-pointer font-medium">
              How the comparison is calculated
            </summary>
            <p className="mt-2 leading-relaxed">
              Each fight uses its latest observed snapshot within 24 hours
              before the earliest announced card start, or midnight UTC if no
              start is known. All three sources use that same snapshot.
              Sportsbook odds must have been fetched within six hours; the
              community needs 10 picks. Imported history and post-start
              snapshots never enter these scores. Draws, no contests and changed
              matchups are excluded. Probabilities always refer to the
              first-listed fighter.
            </p>
          </details>
          {data.recent.length ? (
            <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <h3 className="mb-2 text-xs font-semibold">
                Recent captured fights
              </h3>
              {data.recent.map((r) => (
                <Link
                  key={r.id}
                  to={`/fights/${r.id}?tab=odds`}
                  className="flex items-center justify-between gap-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate">
                    {r.label}
                    <span className="ml-2 text-zinc-500">{r.date}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {marketPct(r.p)} ·{" "}
                    {r.won ? "first fighter won" : "second fighter won"}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Watchlist() {
  const { watches, alerts } = useMarketWatches();
  const fights = watches
    .filter((w) => w.kind === "fight")
    .map((w) => w.id)
    .join(",");
  const fighters = watches
    .filter((w) => w.kind === "fighter")
    .map((w) => w.id)
    .join(",");
  const watched = useMarketData<{ fights: MarketSummary[] }>(
    fights ? `/api/polymarket/board?ids=${fights}` : null,
    15_000,
  );
  const followed = useMarketData<{ fights: MarketSummary[] }>(
    fighters ? `/api/polymarket/board?fighters=${fighters}` : null,
    15_000,
  );
  const rows = [
    ...new Map(
      [...(watched.data?.fights ?? []), ...(followed.data?.fights ?? [])].map(
        (r) => [r.fight.id, r],
      ),
    ).values(),
  ];
  return (
    <div className="space-y-3">
      <section className={`${MARKET_SHELL} p-4 sm:p-5`}>
        <h2 className="text-sm font-semibold">Your watchlist</h2>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          Saved in this browser. In-app alerts run while UFC.sh is open and
          visible. Follow a fight or either fighter from a matchup’s Odds tab.
        </p>
        {!watches.length ? (
          <p className="mt-5 text-xs text-zinc-500">
            No follows yet.{" "}
            <Link
              className="text-blue-700 underline dark:text-blue-400"
              to="/markets"
            >
              Find a fight →
            </Link>
          </p>
        ) : (
          <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-700">
            {watches.map((w) => (
              <div
                key={`${w.kind}:${w.id}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <Link
                    to={
                      w.kind === "fight"
                        ? `/fights/${w.id}?tab=odds`
                        : `/fighters/${w.id}`
                    }
                    className="text-xs font-medium"
                  >
                    {w.name}
                  </Link>
                  <span className="mt-0.5 block text-[10px] text-zinc-500">
                    {w.kind === "fighter"
                      ? "All upcoming matchups"
                      : "This fight"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    Move{" "}
                    <select
                      aria-label={`Movement threshold for ${w.name}`}
                      value={w.threshold}
                      onChange={(e) =>
                        updateMarketWatches((s) => ({
                          ...s,
                          cursors: {},
                          watches: s.watches.map((item) =>
                            item.id === w.id && item.kind === w.kind
                              ? { ...item, threshold: Number(e.target.value) }
                              : item,
                          ),
                        }))
                      }
                      className="rounded border border-zinc-200 bg-white px-1 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {[3, 5, 10].map((n) => (
                        <option key={n} value={n}>
                          {n} pts
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={w.favourite}
                      onChange={(e) =>
                        updateMarketWatches((s) => ({
                          ...s,
                          cursors: {},
                          watches: s.watches.map((item) =>
                            item.id === w.id && item.kind === w.kind
                              ? { ...item, favourite: e.target.checked }
                              : item,
                          ),
                        }))
                      }
                    />
                    Favourite changes
                  </label>
                  <button
                    type="button"
                    className="text-zinc-500 underline"
                    onClick={() =>
                      updateMarketWatches((s) => ({
                        ...s,
                        cursors: {},
                        watches: s.watches.filter((item) => item !== w),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-[10px] leading-relaxed text-zinc-500">
          Alerts require two fresh observations at least five seconds apart, a
          spread of at most six points, and at least $100 of ask depth within
          2¢. Following starts a new baseline; stale or thin quotes do not
          trigger alerts.
        </p>
      </section>
      {watches.length ? <MarketBoard rows={rows} /> : null}
      <section className={`${MARKET_SHELL} p-4 sm:p-5`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Recent alerts{" "}
            <span className="text-zinc-500">
              ({alerts.filter((a) => !a.read).length} unread)
            </span>
          </h2>
          {alerts.length ? (
            <button
              type="button"
              className={MARKET_BUTTON}
              onClick={() =>
                updateMarketWatches((s) => ({
                  ...s,
                  alerts: s.alerts.map((a) => ({ ...a, read: true })),
                }))
              }
            >
              Mark all read
            </button>
          ) : null}
        </div>
        {!alerts.length ? (
          <p className="mt-4 text-xs text-zinc-500">
            No alerts yet. New qualifying moves will appear here.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-700">
            {alerts.map((a) => (
              <Link
                key={a.id}
                to={`/fights/${a.fightId}?tab=odds`}
                onClick={() =>
                  updateMarketWatches((s) => ({
                    ...s,
                    alerts: s.alerts.map((item) =>
                      item.id === a.id ? { ...item, read: true } : item,
                    ),
                  }))
                }
                className="block py-3 text-xs"
              >
                <span
                  className={`${a.read ? "text-zinc-500" : "font-semibold"}`}
                >
                  {a.label}
                </span>
                <span className="mt-1 block text-zinc-500">{a.message}</span>
                <span className="mt-1 block text-[10px] text-zinc-400">
                  {new Date(a.at).toLocaleString()}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Explore() {
  const { data, error, retry } = useMarketData<{
    markets: ExtraMarket[];
    error: string | null;
    at: number | null;
  }>("/api/polymarket/explore", 15_000);
  return (
    <section className={`${MARKET_SHELL} p-4 sm:p-5`}>
      <h2 className="text-sm font-semibold">More UFC markets</h2>
      <p className="mb-4 mt-2 text-xs leading-relaxed text-zinc-500">
        Explore currently listed UFC outcomes, including props and longer-term
        questions when available. A speculative market does not confirm a fight
        booking.
      </p>
      {error || data?.error ? (
        <p
          role="status"
          className="mb-3 text-xs text-amber-700 dark:text-amber-400"
        >
          {data?.error ?? "Couldn’t load market discovery."}{" "}
          <button type="button" className="underline" onClick={retry}>
            Retry
          </button>
        </p>
      ) : null}
      {data?.at ? (
        <ExtraMarkets markets={data.markets} checkedAt={data.at} />
      ) : (
        <p className="text-xs text-zinc-500">Discovering markets…</p>
      )}
    </section>
  );
}

function ReviewDemo({ scene }: { scene: MarketScene }) {
  const now = useNow(true, 3000);
  const data = marketDemo(scene, now);
  const [alert, setAlert] = useState<string | null>(null);
  const testAlert = () => {
    const base = marketDemo(scene, now);
    if (!base.quote) {
      setAlert("No alert: this scenario has no current quote.");
      return;
    }
    const watch = {
      kind: "fight" as const,
      id: base.fight.id,
      name: "Review fight",
      threshold: 5,
      favourite: true,
    };
    const baseline = evaluateMarketWatch(watch, base, undefined, now).cursor;
    const moved = {
      ...base,
      quote: { ...base.quote, p: base.quote.p + 0.06, at: now + 10_000 },
    };
    const candidate = evaluateMarketWatch(
      watch,
      moved,
      baseline,
      now + 10_000,
    ).cursor;
    const confirmed = { ...moved, quote: { ...moved.quote, at: now + 20_000 } };
    const result = evaluateMarketWatch(
      watch,
      confirmed,
      candidate,
      now + 20_000,
    );
    setAlert(
      result.alert?.message ??
        "No alert: this scenario’s quote does not pass the spread and depth checks.",
    );
  };
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-xs dark:border-sky-800 dark:bg-sky-950/40">
        <strong>Review demo · fictional fighters and simulated data</strong>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          These scenarios work between events. Follows here are temporary; demo
          alerts do not enter your watchlist.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {MARKET_SCENES.map((s) => (
            <Link
              key={s}
              to={`/markets?demo=${s}`}
              aria-current={s === scene ? "page" : undefined}
              className={`${MARKET_BUTTON} ${s === scene ? "bg-white dark:bg-zinc-800" : ""}`}
            >
              {
                {
                  prefight: "Pre-fight",
                  live: "Live fight",
                  replay: "Comeback replay",
                  thin: "Thin market",
                  missing: "No market",
                  offline: "Source offline",
                }[s]
              }
            </Link>
          ))}
        </div>
        <p className="mt-3 leading-relaxed">
          Review the two fighter colours, first-price movement, source
          comparison, chart ranges and timeline slider. Try keyboard arrows on
          the slider, follow/unfollow, and a narrow screen in both themes.
        </p>
        <button
          type="button"
          onClick={testAlert}
          className={`${MARKET_BUTTON} mt-3`}
        >
          Test a confirmed 6-point alert
        </button>
        {alert ? (
          <p role="status" className="mt-2 font-medium">
            Demo alert: {alert}
          </p>
        ) : null}
      </div>
      <PolymarketView key={scene} data={data} demo />
      <Accuracy demo />
    </div>
  );
}

export default function MarketsPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some(([key]) => key === params.get("view"))
    ? params.get("view")!
    : "board";
  const scene =
    isDevSite && MARKET_SCENES.includes(params.get("demo") as MarketScene)
      ? (params.get("demo") as MarketScene)
      : null;
  const { alerts } = useMarketWatches();
  useSeo({
    title: "UFC Markets",
    description:
      "UFC Polymarket prices, history, sportsbook comparisons, movement alerts and prediction accuracy.",
    path: "/markets",
  });
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-3 pb-24 pt-4 sm:px-6 sm:pt-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Markets</h1>
            <p className="mt-1 text-xs text-zinc-500">
              Follow the market before, during and after the fight.
            </p>
          </div>
          {isDevSite ? (
            <Link
              to={scene ? "/markets" : "/markets?demo=prefight"}
              className={MARKET_BUTTON}
            >
              {scene ? "Exit review demo" : "Review demo"}
            </Link>
          ) : null}
        </header>
        {!scene ? (
          <nav aria-label="Market sections" className="flex flex-wrap gap-2">
            {VIEWS.map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-current={view === key ? "page" : undefined}
                className={`${MARKET_BUTTON} ${view === key ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white" : "bg-white dark:bg-zinc-900"}`}
                onClick={() => setParams(key === "board" ? {} : { view: key })}
              >
                {label}
                {key === "watchlist" && alerts.some((a) => !a.read)
                  ? ` (${alerts.filter((a) => !a.read).length})`
                  : ""}
              </button>
            ))}
          </nav>
        ) : null}
        {scene ? (
          <ReviewDemo key={scene} scene={scene} />
        ) : view === "watchlist" ? (
          <Watchlist />
        ) : view === "accuracy" ? (
          <Accuracy />
        ) : view === "explore" ? (
          <Explore />
        ) : (
          <>
            <MarketBoard />
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                to="/markets?view=accuracy"
                className={`${MARKET_SHELL} p-4`}
              >
                <h2 className="text-sm font-semibold">
                  Who predicted it better? →
                </h2>
                <p className="mt-2 text-xs text-zinc-500">
                  Track how market probabilities, sportsbooks and community
                  picks compare with results.
                </p>
              </Link>
              <Link
                to="/markets?view=watchlist"
                className={`${MARKET_SHELL} p-4`}
              >
                <h2 className="text-sm font-semibold">
                  Follow fights and fighters →
                </h2>
                <p className="mt-2 text-xs text-zinc-500">
                  Choose movement thresholds and keep your alerts in one place.
                </p>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

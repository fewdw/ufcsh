import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import PolymarketChart from "./PolymarketChart";
import { marketPct } from "../market-chart";
import { marketTables, marketLabel } from "../market-groups";
import PolymarketLogo from "./PolymarketLogo";
import type {
  ExtraMarket,
  MarketDetail,
  MarketSummary,
} from "../polymarket-types";
import { useMarketData } from "../useMarketData";
import { useNow } from "../useNow";

const MARKET_SHELL =
  "rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900";
function freshMarketQuote(row: MarketSummary, now: number) {
  const age = row.fight.state === "live" ? 15_000 : 90_000;
  return row.status === "open" && row.quote && now - row.quote.at < age
    ? row.quote
    : null;
}

function ExtraMarkets({ markets }: { markets: ExtraMarket[] }) {
  if (!markets.length)
    return (
      <p className="text-xs text-zinc-500">
        No additional markets are listed for this matchup.
      </p>
    );
  return (
    <div className="columns-1 gap-3 @[48rem]:columns-2">
      {marketTables(markets).map((group) => (
        <section
          key={group.key}
          className="mb-3 break-inside-avoid overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
        >
          <div
            className="grid items-center bg-zinc-50 py-2 text-xs dark:bg-zinc-800/60"
            style={{
              gridTemplateColumns:
                group.columns.length > 0 && group.columns.length <= 2
                  ? `minmax(0, 1fr) repeat(${group.columns.length}, 4rem)`
                  : "minmax(0, 1fr)",
            }}
          >
            <h4 className="min-w-0 px-3 font-semibold">{group.label}</h4>
            {group.columns.length <= 2
              ? group.columns.map((column, i) => (
                  <span
                    key={i}
                    className="px-2 text-center text-[10px] font-medium text-zinc-500"
                  >
                    {column}
                  </span>
                ))
              : null}
          </div>
          <div className="overflow-x-auto">
            <table
              aria-label={group.label}
              className="w-full table-fixed text-xs"
              style={
                group.columns.length > 2
                  ? { minWidth: Math.max(448, group.columns.length * 80 + 160) }
                  : undefined
              }
            >
              <colgroup>
                <col />
                {group.columns.map((_, i) => (
                  <col key={i} className="w-16" />
                ))}
              </colgroup>
              <thead
                className={
                  group.columns.length <= 2
                    ? "sr-only"
                    : "bg-zinc-50 dark:bg-zinc-800/60"
                }
              >
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Market
                  </th>
                  {group.columns.map((column, i) => (
                    <th
                      key={i}
                      scope="col"
                      className="px-2 py-2 text-center font-medium"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map(({ market: m, outcomes }) => {
                  const prices = outcomes
                    .map((o) => o.p)
                    .filter((p): p is number => p != null);
                  const best =
                    prices.length >= 2 && prices.length === outcomes.length
                      ? Math.max(...prices)
                      : null;
                  return (
                    <tr
                      key={m.id}
                      className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                    >
                      <th
                        scope="row"
                        className="px-3 py-2 text-left align-middle font-normal"
                      >
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          title={m.question}
                          aria-label={m.question}
                          className="group/link block min-h-5 break-words rounded focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          <span>{marketLabel(m.question)}</span>
                          {m.closed ? (
                            <span className="ml-1 inline-block text-[10px] text-zinc-500">
                              Closed
                            </span>
                          ) : null}
                          <ExternalLink
                            className="ml-1 inline h-3 w-3 text-zinc-400 opacity-0 group-hover/link:opacity-100 group-focus-within/link:opacity-100"
                            aria-hidden="true"
                          />
                        </a>
                      </th>
                      {outcomes.map((o, i) => (
                        <td
                          key={i}
                          className={`px-2 py-2 text-center align-middle tabular-nums ${o.p != null && o.p === best && prices.filter((p) => p === best).length === 1 ? "bg-zinc-50 font-semibold text-zinc-950 dark:bg-zinc-800/50 dark:text-white" : "text-zinc-500 dark:text-zinc-400"}`}
                        >
                          {marketPct(o.p)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function Comparison({ data, now }: { data: MarketDetail; now: number }) {
  const q = freshMarketQuote(data, now);
  const rows = [
    {
      label: "Polymarket",
      p: q?.p ?? data.snapshot?.p ?? null,
      detail: q
        ? null
        : data.snapshot
          ? "Frozen pre-fight"
          : "Current price unavailable",
    },
    {
      label: "Sportsbooks",
      p: data.sports?.p ?? null,
      detail: data.sports ? null : "No two-sided odds available",
    },
    ...(data.community && data.community.n > 0
      ? [
          {
            label: "Community picks",
            p: data.community.p,
            detail: `${data.community.n.toLocaleString()} picks${data.snapshot ? " · pre-fight" : ""}`,
          },
        ]
      : []),
  ];
  return (
    <div className="mx-auto max-w-xl">
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table
          className="w-full table-fixed text-xs"
          aria-label="Probability comparison"
        >
          <colgroup>
            <col className="w-[44%]" />
            <col className="w-[28%]" />
            <col className="w-[28%]" />
          </colgroup>
          <thead className="bg-zinc-50 dark:bg-zinc-800/60">
            <tr>
              <th scope="col" aria-label="Source" />
              <th
                scope="col"
                className="break-words px-2 py-2 text-center font-medium text-blue-700 dark:text-blue-400"
              >
                {data.fight.f1.name}
              </th>
              <th
                scope="col"
                className="break-words px-2 py-2 text-center font-medium text-red-700 dark:text-red-400"
              >
                {data.fight.f2.name}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <th
                  scope="row"
                  className="px-3 py-2.5 text-left align-middle font-medium"
                >
                  {row.label}
                  {row.detail ? (
                    <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
                      {row.detail}
                    </span>
                  ) : null}
                </th>
                <td className="px-2 py-2.5 text-center align-middle text-sm font-semibold tabular-nums text-blue-700 dark:text-blue-400">
                  {marketPct(row.p)}
                </td>
                <td className="px-2 py-2.5 text-center align-middle text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                  {marketPct(row.p == null ? null : 1 - row.p)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PolymarketView({
  data,
  compact = false,
}: {
  data: MarketDetail;
  compact?: boolean;
}) {
  const now = useNow(true, 3000);
  const q = freshMarketQuote(data, now);
  const liveHistory = data.history.filter(
    (p) => p.phase === "live" && p.source === "observed",
  );
  const winnerLow =
    data.fight.winner && liveHistory.length >= 2
      ? Math.min(
          ...liveHistory.map((p) =>
            data.fight.winner === "f1" ? p.p : 1 - p.p,
          ),
        )
      : null;
  return (
    <section
      className={`${MARKET_SHELL} @container overflow-hidden`}
      aria-label="Polymarket analysis"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <PolymarketLogo />
          <h2 className="text-sm font-semibold">Polymarket</h2>
          {data.fight.state === "live" && q ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              {data.stream ? "Streaming" : "Live · polling"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        <PolymarketChart data={data} />
        {!compact ? <Comparison data={data} now={now} /> : null}
        {!q ? (
          <div
            role="status"
            className="rounded-lg bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-800"
          >
            {data.status === "closed"
              ? "This fight has finished or the market is closed."
              : data.status === "missing"
                ? "No unambiguous Polymarket moneyline was found for both fighters on this date. Other fight information is still available."
                : "Current Polymarket prices are unavailable. Retrying automatically; historical observations remain available."}
            {data.error ? (
              <span className="mt-1 block">{data.error}</span>
            ) : null}
          </div>
        ) : null}
        {winnerLow != null ? (
          <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
            {data.fight.winner === "f1"
              ? data.fight.f1.name
              : data.fight.f2.name}{" "}
            won after being priced as low as{" "}
            <strong>{marketPct(winnerLow)}</strong> in the captured live
            observations.
          </p>
        ) : null}
        {!compact ? (
          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
            <h3 className="mb-3 text-sm font-semibold">More markets</h3>
            <ExtraMarkets markets={data.extras} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function PolymarketPanel({
  fightId,
  compact = false,
  active = true,
  past = false,
}: {
  fightId: string;
  compact?: boolean;
  active?: boolean;
  /** A finished bout without a matched market shows nothing at all. */
  past?: boolean;
}) {
  // Live prices move by the second; before and after a fight, quotes last 90s.
  const [poll, setPoll] = useState(5000);
  const { data, error, retry } = useMarketData<MarketDetail>(
    `/api/polymarket/fights/${fightId}`,
    poll,
    active,
  );
  const state = data?.fight.state;
  useEffect(() => {
    if (state) setPoll(state === "live" ? 5000 : 15_000);
  }, [state]);
  if (
    past &&
    (data
      ? data.fight.state === "finished" && !data.url && !data.history.length
      : true)
  )
    return null;
  return data ? (
    <PolymarketView data={data} compact={compact} />
  ) : (
    <section
      className={`${MARKET_SHELL} p-5 text-xs text-zinc-500`}
      role="status"
    >
      {error ? (
        <>
          Couldn’t load Polymarket.{" "}
          <button type="button" className="underline" onClick={retry}>
            Retry
          </button>
        </>
      ) : (
        "Loading Polymarket…"
      )}
    </section>
  );
}

/** One request for the whole card, so stepping between its bouts shows each
 *  price at once instead of refetching and popping in. */
export function MarketTeaser({ fightId, eventId }: { fightId: string; eventId: string }) {
  const { data } = useMarketData<{ fights: MarketSummary[] }>(
    `/api/polymarket/board?event=${eventId}`,
    10_000,
  );
  const now = useNow(true, 5000);
  const row = data?.fights.find((r) => r.fight.id === fightId);
  const q = row ? freshMarketQuote(row, now) : null;
  if (!row || !q || row.fight.state === "finished") return null;
  return (
    <Link
      to={`/fights/${fightId}?tab=odds`}
      aria-label={`Polymarket: ${row.fight.f1.name} ${marketPct(q.p)}, ${row.fight.f2.name} ${marketPct(1 - q.p)}`}
      className="matchup-polymarket inline-flex w-fit max-w-full flex-nowrap items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-200 px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      <PolymarketLogo />
      <span className="font-semibold tabular-nums text-blue-700 dark:text-blue-400">
        {marketPct(q.p)}
      </span>
      <span aria-hidden="true">/</span>
      <span className="font-semibold tabular-nums text-red-700 dark:text-red-400">
        {marketPct(1 - q.p)}
      </span>
    </Link>
  );
}

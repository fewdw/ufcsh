/* oxlint-disable react/only-export-components -- small shared market views */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import PolymarketChart from "./PolymarketChart";
import { groupMarkets, marketLabel } from "../market-groups";
import PolymarketLogo from "./PolymarketLogo";
import type {
  ExtraMarket,
  MarketDetail,
  MarketSummary,
} from "../polymarket-types";
import { useMarketData } from "../useMarketData";
import { useNow } from "../useNow";

export const MARKET_SHELL =
  "rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900";
export const marketPct = (p: number | null | undefined) =>
  p == null ? "—" : `${(p * 100).toFixed(1).replace(/\.0$/, "")}%`;
const time = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export function freshMarketQuote(row: MarketSummary, now: number) {
  const age = row.fight.state === "live" ? 15_000 : 90_000;
  return row.status === "open" && row.quote && now - row.quote.at < age
    ? row.quote
    : null;
}

export function ExtraMarkets({ markets }: { markets: ExtraMarket[] }) {
  if (!markets.length)
    return (
      <p className="text-xs text-zinc-500">
        No additional markets are listed for this matchup.
      </p>
    );
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      {groupMarkets(markets).map((group) => (
        <details
          key={group.label}
          open
          className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-700"
        >
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
            {group.label}{" "}
            <span className="ml-1 font-normal text-zinc-500">
              {group.markets.length}
            </span>
          </summary>
          <div className="border-t border-zinc-200 dark:border-zinc-700">
            {group.markets.map((m) => (
              <a
                key={m.id}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={m.question}
                aria-label={m.question}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-100 px-3 py-2 text-xs last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {marketLabel(m.question)}
                  {m.closed ? (
                    <span className="text-[10px] text-zinc-500">Closed</span>
                  ) : null}
                  <ExternalLink
                    className="h-3 w-3 shrink-0 text-zinc-400"
                    aria-hidden="true"
                  />
                </span>
                <span className="flex shrink-0 gap-3 text-[11px] text-zinc-500">
                  {m.outcomes.map((o) => (
                    <span key={o.name}>
                      {o.name}{" "}
                      <strong className="tabular-nums text-zinc-900 dark:text-zinc-100">
                        {marketPct(o.p)}
                      </strong>
                    </span>
                  ))}
                </span>
              </a>
            ))}
          </div>
        </details>
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
        ? `${q.method} · ${time(q.at)}`
        : data.snapshot
          ? `Frozen pre-fight · ${time(data.snapshot.at)}`
          : "Current price unavailable",
    },
    {
      label: "Sportsbooks",
      p: data.sports?.p ?? null,
      detail: data.sports
        ? `Margin removed · ${time(data.sports.at)}`
        : "No two-sided odds available",
    },
    ...(data.community && data.community.n > 0
      ? [
          {
            label: "Community picks",
            p: data.community.p,
            detail: `${data.community.n.toLocaleString()} picks · ${data.snapshot ? "frozen pre-fight" : "current tally"}`,
          },
        ]
      : []),
  ];
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">How they compare</h3>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-3 text-xs">
        <span aria-hidden="true" />
        <span className="max-w-28 truncate text-right text-[10px] text-zinc-500">
          {data.fight.f1.name}
        </span>
        <span className="max-w-28 truncate text-right text-[10px] text-zinc-500">
          {data.fight.f2.name}
        </span>
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <div className="min-w-0">
              <div className="font-medium">{row.label}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500">
                {row.detail}
              </div>
            </div>
            <span className="text-right font-semibold tabular-nums">
              {marketPct(row.p)}
            </span>
            <span className="text-right font-semibold tabular-nums">
              {marketPct(row.p == null ? null : 1 - row.p)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PolymarketView({
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
        <div
          className={`grid items-start gap-5 ${compact ? "" : "@[56rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @[56rem]:gap-8"}`}
        >
          <PolymarketChart data={data} />
          {!compact ? <Comparison data={data} now={now} /> : null}
        </div>
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
}: {
  fightId: string;
  compact?: boolean;
  active?: boolean;
}) {
  const { data, error, retry } = useMarketData<MarketDetail>(
    `/api/polymarket/fights/${fightId}`,
    5000,
    active,
  );
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

function MarketBoard({ eventId }: { eventId: string }) {
  const { data, error, retry } = useMarketData<{ fights: MarketSummary[] }>(
    `/api/polymarket/board?event=${eventId}`,
    10_000,
  );
  const now = useNow(true, 5000);
  const rows = data?.fights;
  return (
    <section
      className={`${MARKET_SHELL} shrink-0 overflow-hidden`}
      aria-label="Polymarket fight board"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="text-sm font-semibold">Polymarket win probabilities</h2>
      </div>
      {!rows ? (
        <p role="status" className="p-4 text-xs text-zinc-500">
          {error ? (
            <>
              Market board unavailable.{" "}
              <button onClick={retry} className="underline">
                Retry
              </button>
            </>
          ) : (
            "Loading markets…"
          )}
        </p>
      ) : !rows.length ? (
        <p className="p-4 text-xs text-zinc-500">
          No scheduled matchups to show.
        </p>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {rows.map((row) => {
            const q = freshMarketQuote(row, now);
            return (
              <div
                key={row.fight.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <Link
                  to={`/fights/${row.fight.id}?tab=odds`}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-xs font-medium">
                    {row.fight.f1.name}{" "}
                    <span className="text-zinc-400">vs</span>{" "}
                    {row.fight.f2.name}
                  </span>
                  <span className="mt-1 block text-[10px] text-zinc-500">
                    {eventId ? "" : `${row.fight.event} · `}
                    {q
                      ? `${row.fight.state === "live" ? "Live · " : ""}${q.spread != null && q.spread > 0.06 + 1e-9 ? "Wide spread · " : ""}updated ${Math.max(0, Math.floor((now - q.at) / 1000))}s ago`
                      : row.status === "missing"
                        ? "No matched market"
                        : row.status === "closed"
                          ? "Closed · view history"
                          : "Price unavailable"}
                  </span>
                </Link>
                <Link
                  to={`/fights/${row.fight.id}?tab=odds`}
                  className="shrink-0 text-right text-xs font-semibold tabular-nums"
                >
                  <span className="text-blue-700 dark:text-blue-400">
                    {marketPct(q?.p)}
                  </span>
                  <span className="px-1 text-zinc-400">/</span>
                  <span className="text-red-700 dark:text-red-400">
                    {marketPct(q ? 1 - q.p : null)}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
      )}
      <p className="px-4 py-3 text-[10px] text-zinc-500">
        Blue is the first fighter; red is the second. Open a fight for history,
        and comparisons.
      </p>
    </section>
  );
}

export function MarketTeaser({ fightId }: { fightId: string }) {
  const { data } = useMarketData<{ fights: MarketSummary[] }>(
    `/api/polymarket/board?ids=${fightId}`,
    10_000,
  );
  const now = useNow(true, 5000);
  const row = data?.fights[0];
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

export function EventMarkets({
  eventId,
  initialOpen = false,
}: {
  eventId: string;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div className="shrink-0">
      <button
        type="button"
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        onClick={() => setOpen(!open)}
      >
        <span>Polymarket probabilities</span>
        <span>{open ? "Hide −" : "Show +"}</span>
      </button>
      {open ? <MarketBoard eventId={eventId} /> : null}
    </div>
  );
}

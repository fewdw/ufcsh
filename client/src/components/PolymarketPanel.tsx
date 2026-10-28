/* oxlint-disable react/only-export-components -- small shared market views */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
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
export const MARKET_BUTTON =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800";
export const marketPct = (p: number | null | undefined) =>
  p == null ? "—" : `${(p * 100).toFixed(1).replace(/\.0$/, "")}%`;
const money = (n: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
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

export function ExtraMarkets({
  markets,
  checkedAt,
}: {
  markets: ExtraMarket[];
  checkedAt?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? markets : markets.slice(0, 6);
  return (
    <div>
      {!markets.length ? (
        <p className="text-xs text-zinc-500">
          No additional markets are listed for this matchup.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((m) => (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <span className="flex items-start justify-between gap-2 text-xs font-medium">
                {m.question}
                <ExternalLink
                  className="h-3 w-3 shrink-0 text-zinc-400"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                {m.outcomes.map((o) => (
                  <span key={o.name}>
                    {o.name}{" "}
                    <strong className="tabular-nums">{marketPct(o.p)}</strong>
                  </span>
                ))}
              </span>
              <span className="mt-2 block text-[10px] text-zinc-500">
                {m.closed ? "Closed" : "Listed prices"} · Volume{" "}
                {money(m.volume)} · Liquidity {money(m.liquidity)}
              </span>
            </a>
          ))}
        </div>
      )}
      {markets.length > 6 ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`${MARKET_BUTTON} mt-3`}
        >
          {expanded ? "Show fewer" : `Show all ${markets.length} markets`}
        </button>
      ) : null}
      {markets.length ? (
        <p className="mt-2 text-[10px] text-zinc-500">
          Source-listed prices
          {checkedAt ? ` · discovered ${time(checkedAt)}` : ""}. Availability
          and settlement rules vary; open the market for details.
        </p>
      ) : null}
    </div>
  );
}

export function ProbabilityChart({ data }: { data: MarketDetail }) {
  const [mode, setMode] = useState<"all" | "prefight" | "live">(() =>
    data.fight.state === "live" ||
    (data.fight.state === "finished" &&
      data.history.some((p) => p.phase === "live"))
      ? "live"
      : "all",
  );
  const [cursor, setCursor] = useState<number | null>(null);
  const points = data.history.filter((p) => mode === "all" || p.phase === mode);
  const selected =
    cursor == null ? points.length - 1 : Math.min(cursor, points.length - 1);
  const point = points[selected];
  const first = points[0]?.at ?? 0,
    last = points.at(-1)?.at ?? first;
  const x = (at: number) =>
    42 + ((at - first) / Math.max(1, last - first)) * 650;
  const y = (p: number) => 18 + (1 - p) * 150;
  const roundMarkers = data.rounds
    .filter((r) => r.at >= first && r.at <= last)
    .filter((r, i, rounds) => i === 0 || x(r.at) - x(rounds[i - 1].at) > 22);
  const gaps = points
    .slice(1)
    .map((p, i) => p.at - points[i].at)
    .sort((a, b) => a - b);
  const maxGap = Math.max(
    mode === "live" ? 60_000 : 3_600_000,
    (gaps[Math.floor(gaps.length / 2)] ?? 0) * 3,
  );
  const path = (flip: boolean) =>
    points
      .map(
        (p, i) =>
          `${i === 0 || p.at - points[i - 1].at > maxGap ? "M" : "L"}${x(p.at).toFixed(1)},${y(flip ? 1 - p.p : p.p).toFixed(1)}`,
      )
      .join(" ");
  const switchMode = (next: typeof mode) => {
    setMode(next);
    setCursor(null);
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Probability history</h3>
        <div role="group" aria-label="History range" className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["prefight", "Pre-fight"],
              ["live", "Live"],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={mode === key}
              onClick={() => switchMode(key)}
              className={`${MARKET_BUTTON} ${mode === key ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {points.length ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
            <span>
              <span className="font-semibold text-blue-700 dark:text-blue-400">
                {data.fight.f1.name} {marketPct(point.p)}
              </span>{" "}
              <span className="text-zinc-400">/</span>{" "}
              <span className="font-semibold text-red-700 dark:text-red-400">
                {data.fight.f2.name} {marketPct(1 - point.p)}
              </span>
            </span>
            <span className="text-[11px] text-zinc-500">
              {time(point.at)} ·{" "}
              {point.source === "observed" ? "Captured" : "Source history"}
              {point.phase === "live" ? " · live" : ""}
            </span>
          </div>
          <svg
            viewBox="0 0 720 200"
            className="mt-1 w-full overflow-visible"
            role="img"
            aria-label={`Win probability history for ${data.fight.f1.name} and ${data.fight.f2.name}. Hover or focus the chart and use arrow keys to inspect observations.`}
            tabIndex={0}
            data-own-arrows
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowLeft"
                  ? selected - 1
                  : event.key === "ArrowRight"
                    ? selected + 1
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? points.length - 1
                        : null;
              if (next == null) return;
              event.preventDefault();
              setCursor(Math.max(0, Math.min(points.length - 1, next)));
            }}
            onPointerLeave={() => setCursor(null)}
            onPointerMove={(event) => {
              if (event.buttons !== 1 && event.pointerType !== "mouse") return;
              const rect = event.currentTarget.getBoundingClientRect();
              const at =
                first +
                ((((event.clientX - rect.left) / rect.width) * 720 - 42) /
                  650) *
                  (last - first);
              let nearest = 0;
              points.forEach((p, i) => {
                if (Math.abs(p.at - at) < Math.abs(points[nearest].at - at))
                  nearest = i;
              });
              setCursor(nearest);
            }}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <g key={p} className="text-zinc-300 dark:text-zinc-700">
                <line
                  x1="42"
                  x2="692"
                  y1={y(p)}
                  y2={y(p)}
                  stroke="currentColor"
                  strokeDasharray={p === 0.5 ? "4 4" : undefined}
                />
                <text
                  x="32"
                  y={y(p) + 3}
                  textAnchor="end"
                  fill="currentColor"
                  className="fill-zinc-500 text-[18px] @[30rem]:text-[10px]"
                >
                  {Math.round(p * 100)}%
                </text>
              </g>
            ))}
            {data.fight.cutoff >= first && data.fight.cutoff <= last ? (
              <g>
                <line
                  x1={x(data.fight.cutoff)}
                  x2={x(data.fight.cutoff)}
                  y1="18"
                  y2="168"
                  stroke="currentColor"
                  className="text-zinc-400"
                  strokeDasharray="3 4"
                />
                <text
                  x={Math.min(620, x(data.fight.cutoff) + 4)}
                  y="12"
                  className="fill-zinc-500 text-[9px]"
                >
                  Card start
                </text>
              </g>
            ) : null}
            {roundMarkers.map((r) => (
              <g key={r.round}>
                <line
                  x1={x(r.at)}
                  x2={x(r.at)}
                  y1="18"
                  y2="168"
                  stroke="currentColor"
                  className="text-zinc-400"
                  strokeDasharray="2 4"
                />
                <text
                  x={x(r.at)}
                  y="181"
                  textAnchor="middle"
                  className="fill-zinc-500 text-[18px] @[30rem]:text-[10px]"
                >
                  R{r.round}
                </text>
              </g>
            ))}
            <path
              d={path(false)}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d={path(true)}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <line
              x1={x(point.at)}
              x2={x(point.at)}
              y1="18"
              y2="168"
              stroke="currentColor"
              className="text-zinc-400"
            />
            <circle cx={x(point.at)} cy={y(point.p)} r="4" fill="#3b82f6" />
            <text
              x="42"
              y="197"
              className="fill-zinc-500 text-[18px] @[30rem]:text-[10px]"
            >
              {new Date(first).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </text>
            <text
              x="692"
              y="197"
              textAnchor="end"
              className="fill-zinc-500 text-[18px] @[30rem]:text-[10px]"
            >
              {time(last)}
            </text>
          </svg>
          <details className="mt-3 text-[11px] text-zinc-500">
            <summary className="cursor-pointer">View observations</summary>
            <div className="mt-2 max-h-48 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>{data.fight.f1.name}</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {points.slice(-100).map((p, i) => (
                    <tr key={`${p.at}:${p.source}:${i}`}>
                      <td>{time(p.at)}</td>
                      <td>{marketPct(p.p)}</td>
                      <td>
                        {p.source}
                        {p.phase === "live" ? " · live" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="rounded-lg bg-zinc-50 p-4 text-xs text-zinc-500 dark:bg-zinc-800">
          {mode === "live"
            ? "No live observations were captured. Historical prices without confirmed fight timing stay in All."
            : data.historyCheckedAt
              ? "No price history is available for this range yet."
              : "Fetching source history. New observations will appear here automatically."}
        </p>
      )}
      {data.historyError ? (
        <p
          role="status"
          className="mt-2 text-xs text-amber-700 dark:text-amber-400"
        >
          {data.historyError}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
        Round markers show when UFC.sh first observed each live round; they may
        lag the broadcast. Gaps stay unconnected. Market prices reflect trading,
        and are not a verified chance of winning.
      </p>
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
    {
      label: "Community picks",
      p: data.community?.p ?? null,
      detail: data.community
        ? `${data.community.n.toLocaleString()} picks · ${data.snapshot ? "frozen pre-fight" : "current tally"}`
        : "No picks yet",
    },
  ];
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">How they compare</h3>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-3 text-xs">
        <span className="text-[10px] text-zinc-500">Source</span>
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
      {q && data.sports ? (
        <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800">
          Polymarket is{" "}
          <strong>
            {Math.abs((q.p - data.sports.p) * 100).toFixed(1)} points{" "}
            {q.p >= data.sports.p ? "higher" : "lower"}
          </strong>{" "}
          on {data.fight.f1.name} than the sportsbook snapshot.
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
        Pick share measures community preference. Sources update at different
        times; a difference alone does not establish betting value.
      </p>
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
  const movement = q && data.opening ? (q.p - data.opening.p) * 100 : null;
  const thin =
    q &&
    (q.spread == null ||
      q.spread > 0.06 + 1e-9 ||
      q.depth == null ||
      q.depth < 100);
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
        {q ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="truncate text-xs text-zinc-500">
                  {data.fight.f1.name}
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-blue-700 dark:text-blue-400">
                  {marketPct(q.p)}
                </p>
              </div>
              <div className="text-right">
                <p className="truncate text-xs text-zinc-500">
                  {data.fight.f2.name}
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-red-700 dark:text-red-400">
                  {marketPct(1 - q.p)}
                </p>
              </div>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-red-500">
              <div className="bg-blue-500" style={{ width: `${q.p * 100}%` }} />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-[11px] text-zinc-500">
              <span>
                {movement == null
                  ? "First pre-fight observation pending"
                  : `${movement >= 0 ? "+" : ""}${movement.toFixed(1)} pts for ${data.fight.f1.name} since first pre-fight observation`}
              </span>
              <span>
                {q.method} · updated{" "}
                {Math.max(0, Math.floor((now - q.at) / 1000))}s ago
              </span>
            </div>
            {thin ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {q.spread != null && q.spread > 0.06 + 1e-9
                  ? "Wide spread"
                  : "Limited book depth"}{" "}
                · Displayed prices may differ from executable quotes.
              </p>
            ) : null}
            {!compact ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4">
                <div>
                  <span className="block text-zinc-500">
                    Bid / ask · {data.fight.f1.name}
                  </span>
                  <strong>
                    {marketPct(q.bid)} / {marketPct(q.ask)}
                  </strong>
                </div>
                <div>
                  <span className="block text-zinc-500">Spread</span>
                  <strong>
                    {q.spread == null
                      ? "—"
                      : `${(q.spread * 100).toFixed(1)} pts`}
                  </strong>
                </div>
                <div>
                  <span className="block text-zinc-500">Volume</span>
                  <strong>{money(data.volume)}</strong>
                </div>
                <div>
                  <span className="block text-zinc-500">
                    Ask depth within 2¢
                  </span>
                  <strong>{money(q.depth)}</strong>
                </div>
              </div>
            ) : null}
            <p className="text-[10px] text-zinc-500">
              Displayed probability uses the midpoint or last trade. An
              executable buy price is the ask and can differ; fees and order
              size also matter.
            </p>
          </>
        ) : (
          <div
            role="status"
            className="rounded-lg bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-800"
          >
            {data.status === "closed"
              ? "This fight has finished or the market is closed. Explore the recorded prices below."
              : data.status === "missing"
                ? "No unambiguous Polymarket moneyline was found for both fighters on this date. Other fight information is still available."
                : "Current Polymarket prices are unavailable. Retrying automatically; historical observations remain below."}
            {data.error ? (
              <span className="mt-1 block">{data.error}</span>
            ) : null}
          </div>
        )}
        {!compact ? <Comparison data={data} now={now} /> : null}
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
        <ProbabilityChart key={data.fight.id} data={data} />
        {!compact ? (
          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
            <h3 className="mb-3 text-sm font-semibold">More markets</h3>
            <ExtraMarkets
              markets={data.extras}
              checkedAt={data.marketCheckedAt}
            />
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

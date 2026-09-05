import { useState } from "react";
import type { LabsResponse } from "../api";
import { BarList, ChartCard, ColumnChart, Legend, LineChart, StatTile } from "./charts";
import { formatValue, SERIES } from "./chartTokens";

const GROUPS = [
  ["age", "Fighter age"], ["division", "Division"], ["layoff", "Time away"],
  ["experience", "UFC experience"], ["prev", "Previous result"], ["winStreak", "Win streak"],
  ["prob", "Closing probability"], ["stanceMatchup", "Stance matchup"], ["reachGap", "Reach advantage"],
] as const;
const count = (n: number | undefined) => n == null ? "—" : n.toLocaleString("en-US");
const percent = (n: number | null) => formatValue(n, "percent");
const selectClass = "max-w-40 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700";

export default function LabsInsights({ data, groupBy, onGroupBy }: {
  data: LabsResponse; groupBy: string; onGroupBy: (value: string) => void;
}) {
  const [roundMetric, setRoundMetric] = useState<"strikes" | "finishes">("strikes");
  const s = data.summary;
  const decided = s.wins + s.losses + s.draws;
  const rates = [
    { label: "Significant strikes / min", own: s.sig_per_min, taken: s.sig_absorbed_per_min, n: s.stat_bouts },
    { label: "Takedowns / 15 min", own: s.td_per_15, taken: s.td_taken_per_15, n: s.td_bouts },
    { label: "Knockdowns / 15 min", own: s.kd_per_15, taken: s.kd_taken_per_15, n: s.kd_bouts },
  ];
  // Preserve missing calendar years as gaps rather than joining across them.
  const byYear = new Map(data.trend.map((year) => [year.year, year]));
  const first = data.trend[0]?.year;
  const last = data.trend.at(-1)?.year;
  const years = first != null && last != null ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : [];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-6">
      <ChartCard title="Through the years" subtitle="Win rate by fight year · inspect a point or open the exact table." className="lg:col-span-3"
        table={{ columns: ["Year", "W–L–D", "NC", "Win rate", "Observations"], rows: data.trend.map((year) => [year.year, `${year.wins}–${year.losses}–${year.draws}`, year.ncs, percent(year.win_rate), year.n]) }}>
        <div className="flex items-baseline gap-2 px-4 pt-3">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-950">{percent(s.win_rate)}</span>
          <span className="text-[11px] text-zinc-500">{count(s.wins)} wins / {count(decided)} results</span>
        </div>
        {years.length ? <LineChart labels={years.map(String)} series={[{ key: "wins", name: "Win rate", color: SERIES[0], values: years.map((year) => byYear.get(year)?.win_rate ?? null) }]} format="percent" domain={[0, 100]} height={160} />
          : <p className="p-8 text-center text-xs text-zinc-400">No results for this study.</p>}
        <p className="px-4 pb-3 text-[10px] leading-4 text-zinc-500">A small yearly sample can swing sharply. These are historical outcomes, not a forecast.</p>
      </ChartCard>

      <ChartCard title="Where the results change" subtitle={`${data.group_label} · win rate with the number of official results.`} className="lg:col-span-3"
        actions={<select aria-label="Break down study by" className={selectClass} value={groupBy} onChange={(event) => onGroupBy(event.target.value)}>{GROUPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
        table={{ columns: [data.group_label, "W–L–D", "NC", "Win rate", "Observations"], rows: data.breakdown.map((bucket) => [bucket.label, `${bucket.wins}–${bucket.losses}–${bucket.draws}`, bucket.ncs, percent(bucket.win_rate), bucket.n]) }}>
        <BarList data={data.breakdown.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.win_rate, n: bucket.wins + bucket.losses + bucket.draws,
          tip: [{ label: "win rate", value: percent(bucket.win_rate) }, { label: "W–L–D", value: `${bucket.wins}–${bucket.losses}–${bucket.draws}` }, { label: "no contests (excluded from rate)", value: count(bucket.ncs) }] }))}
          format="percent" max={100} minSample={20} height={255} />
        <p className="px-4 pb-3 text-[10px] leading-4 text-zinc-500">Faded bars have fewer than 20 results.{data.coverage.unbucketed ? ` ${count(data.coverage.unbucketed)} observations lack this field and are not grouped.` : ""}</p>
      </ChartCard>

      <ChartCard title="Give & take" subtitle="Output and absorption from the same timed bouts." className="lg:col-span-2"
        legend={<Legend items={[{ label: "Given", color: SERIES[0] }, { label: "Taken", color: SERIES[1] }]} />}
        table={{ columns: ["Metric", "Given", "Taken", "Tracked observations"], rows: rates.map((rate) => [rate.label, formatValue(rate.own, "decimal"), formatValue(rate.taken, "decimal"), rate.n]) }}>
        <div className="space-y-4 px-4 py-4">
          {rates.map((rate) => {
            const max = Math.max(rate.own ?? 0, rate.taken ?? 0, 1);
            return <div key={rate.label}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]"><span className="font-medium text-zinc-700">{rate.label}</span><span className="text-[10px] text-zinc-400">n={count(rate.n)}</span></div>
              {[rate.own, rate.taken].map((value, i) => <div key={i} className="flex items-center gap-2 py-0.5" aria-label={`${i === 0 ? "Given" : "Taken"}: ${formatValue(value, "decimal")}`}>
                <span className="h-2 flex-1 overflow-hidden rounded-sm bg-zinc-100"><span className="block h-full rounded-sm" style={{ width: `${(value ?? 0) / max * 100}%`, background: SERIES[i] }} /></span>
                <span className="w-10 text-right text-xs font-semibold tabular-nums text-zinc-800">{formatValue(value, "decimal")}</span>
              </div>)}
            </div>;
          })}
          <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-3 text-[11px]"><span className="text-zinc-500">Control share · {count(s.control_bouts)} tracked</span><strong className="font-semibold tabular-nums text-zinc-900">{percent(s.control_share)}</strong></div>
        </div>
      </ChartCard>

      <ChartCard title="Round by round" subtitle={roundMetric === "strikes" ? "Landed per fighter-round with recorded stats." : "KO/TKO and submission wins by finishing round."} className="lg:col-span-2"
        actions={<select aria-label="Round metric" className={selectClass} value={roundMetric} onChange={(event) => setRoundMetric(event.target.value as typeof roundMetric)}><option value="strikes">Strike output</option><option value="finishes">Finish wins</option></select>}
        table={{ columns: ["Round", "Tracked fighter-rounds", "Strikes / fighter", "Accuracy", "KO wins", "SUB wins"], rows: data.rounds.map((round) => [round.round, round.reached, formatValue(round.sig_per_fighter, "decimal"), percent(round.sig_accuracy), round.ko, round.sub]) }}>
        <ColumnChart data={data.rounds.map((round) => ({ key: String(round.round), label: `R${round.round}`, value: roundMetric === "strikes" ? round.sig_per_fighter : round.ko + round.sub,
          tip: roundMetric === "strikes" ? [{ label: "strikes per fighter", value: formatValue(round.sig_per_fighter, "decimal") }, { label: "tracked fighter-rounds", value: count(round.reached) }]
            : [{ label: "KO/TKO wins", value: count(round.ko) }, { label: "submission wins", value: count(round.sub) }] }))} height={170} format={roundMetric === "strikes" ? "decimal" : "number"} />
        <p className="px-4 pb-3 text-[10px] leading-4 text-zinc-500">Later rounds contain survivors and longer scheduled bouts. Partial rounds count as one recorded round.</p>
      </ChartCard>

      <ChartCard title="The market's read" subtitle="Closing prices · both sides required · flat $100 stakes." className="lg:col-span-2"
        table={{ columns: ["Measure", "Value"], rows: [["Priced results (W/L/D)", s.bets], ["Observed win rate", percent(s.priced_win_rate)], ["Margin-free implied rate", percent(s.bet_avg_fair)], ["Return on stake", percent(s.roi)], ["Net profit", formatValue(s.profit, "currency")]] }}>
        <div className="grid grid-cols-2 divide-x divide-zinc-100 border-b border-zinc-100">
          <StatTile label="Return on stake" value={percent(s.roi)} note={`${count(s.bets)} priced results`} emphasis />
          <StatTile label="Net profit" value={formatValue(s.profit, "currency")} note="per $100 staked each time" />
        </div>
        <BarList data={[{ key: "observed", label: "Observed wins", value: s.priced_win_rate }, { key: "implied", label: "Market implied", value: s.bet_avg_fair }]} format="percent" max={100} />
        <p className="px-4 pb-3 text-[10px] leading-4 text-zinc-500">The implied rate removes the margin from each price pair. Both readings use the same {count(s.bets)} results. Draws return the stake; no contests are excluded. Historical returns do not predict future returns.</p>
      </ChartCard>
    </div>
  );
}

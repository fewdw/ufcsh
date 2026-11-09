import type { DivisionMedians } from "../api";
import { STRIKING_METRICS, GRAPPLING_METRICS, metricView, profileText, type CareerTotals, type ProfileMetric } from "../careerMetrics";
import { PanelHeading, PANEL_SHELL } from "./FightStats";
import CareerStatDetails from "./CareerStatDetails";
import { MedianLabel } from "./DivisionMedian";

const GROUPS = [{ label: "Striking", metrics: STRIKING_METRICS }, { label: "Grappling", metrics: GRAPPLING_METRICS }];

/** The fighter's figure against the division's middle. Percentages run to
 *  100; a rate puts the median halfway, so the bar reads as above or below
 *  it at a glance. */
function MedianBar({ metric, value, median }: { metric: ProfileMetric; value: number | null; median: number }) {
  // Centred on the division's middle: better grows right in green, worse
  // left in grey, by how many times the median (capped at double or half).
  const ratio = value == null ? 1
    : median <= 0 ? (value > 0 ? (metric.better === "low" ? 0 : 2) : 1)
      : metric.better === "low" ? (value <= 0 ? 2 : median / value) : value / median;
  const offset = Math.max(-1, Math.min(1, ratio >= 1 ? ratio - 1 : -(1 / Math.max(ratio, 0.5) - 1)));
  return (
    <span className="col-span-2 mt-1.5 flex items-center gap-2.5">
      <span className="relative block h-1.5 flex-1 rounded-full bg-plot-track">
        {offset ? <span className={`absolute inset-y-0 ${offset > 0 ? "left-1/2 rounded-r-full bg-[#1f9d74]" : "right-1/2 rounded-l-full bg-zinc-400"}`} style={{ width: `${Math.abs(offset) * 50}%` }} /> : null}
        {/* Off the scale (past double or half the median): an axis break near the end. */}
        {Math.abs(offset) >= 1 ? <span aria-hidden="true" title="Beyond the scale" className={`absolute -inset-y-px w-[2px] -skew-x-[20deg] bg-zinc-100 ${offset > 0 ? "right-[7px]" : "left-[7px]"}`} /> : null}
        <span aria-hidden="true" className="absolute -inset-y-[3px] left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-plot-median opacity-80" />
      </span>
      <span className="w-14 text-right text-[10px] leading-3 tabular-nums text-zinc-400" title="Weight class median">med. {profileText(median, metric.format)}</span>
    </span>
  );
}

export default function FighterCareerStats({ fighterId, name, totals, medians }: { fighterId: string; name: string; totals?: CareerTotals; medians?: DivisionMedians | null }) {
  if (!totals) return null;
  return <section className={`${PANEL_SHELL} @container overflow-hidden`}>
    <PanelHeading title="Career stats" subtitle={medians ? <><MedianLabel medians={medians} before={false} /> · <span className="whitespace-nowrap"><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[#1f9d74]" />Better · <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-zinc-400" />Worse</span> · Current</> : "UFC · Current"} />
    <div className="grid grid-cols-2 gap-x-2 px-2 py-2 @[36rem]:gap-x-4 @[36rem]:px-4">
      {GROUPS.map(group => <div key={group.label} className="min-w-0">
        <h3 className="px-2 pb-1 pt-1 text-[12px] font-semibold text-zinc-800">{group.label}</h3>
        {group.metrics.map(metric => {
          const value = metric.value(totals);
          const median = medians?.values[metric.key] ?? null;
          return <CareerStatDetails key={metric.key} fighters={[{ id: fighterId, name }]} available={[metric.sample(totals).total > 0]} view={metricView(metric)} className="grid min-h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-50">
            <span className="text-[12px] leading-4 text-zinc-600">{metric.short}{metric.better === "low" ? <span className="font-semibold text-zinc-700" title="Lower is better"> ↓</span> : null}</span>
            <span className="text-[15px] font-semibold tabular-nums text-zinc-900">{profileText(value, metric.format)}</span>
            {median != null ? <MedianBar metric={metric} value={value} median={median} /> : null}
          </CareerStatDetails>;
        })}
      </div>)}
    </div>
  </section>;
}

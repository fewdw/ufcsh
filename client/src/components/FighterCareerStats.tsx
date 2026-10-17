import type { DivisionMedians } from "../api";
import { STRIKING_METRICS, GRAPPLING_METRICS, metricView, profileText, type CareerTotals, type ProfileMetric } from "../careerMetrics";
import { PanelHeading, PANEL_SHELL, sectionLabel } from "./FightStats";
import CareerStatDetails from "./CareerStatDetails";
import { MedianLabel, MedianTick } from "./DivisionMedian";

const GROUPS = [{ label: "Striking", metrics: STRIKING_METRICS }, { label: "Grappling", metrics: GRAPPLING_METRICS }];

/** The fighter's figure against the division's middle. Percentages run to
 *  100; a rate puts the median halfway, so the bar reads as above or below
 *  it at a glance. */
function MedianBar({ metric, value, median }: { metric: ProfileMetric; value: number | null; median: number }) {
  const scale = metric.format === "rate" ? Math.max(median * 2, value ?? 0, 0.0001) : 100;
  return (
    <span className="col-span-2 mt-0.5 flex items-center gap-2">
      <span className="relative block h-1 flex-1 rounded-full bg-plot-track">
        <span className="block h-full rounded-full bg-zinc-400" style={{ width: `${Math.min(100, ((value ?? 0) / scale) * 100)}%` }} />
        <MedianTick at={(median / scale) * 100} />
      </span>
      <span className="text-[10px] leading-3 tabular-nums text-zinc-400" title="Weight class median">med. {profileText(median, metric.format)}</span>
    </span>
  );
}

export default function FighterCareerStats({ fighterId, name, totals, medians }: { fighterId: string; name: string; totals?: CareerTotals; medians?: DivisionMedians | null }) {
  if (!totals) return null;
  return <section className={`${PANEL_SHELL} @container overflow-hidden`}>
    <PanelHeading title="Career stats" subtitle={medians ? <><MedianLabel medians={medians} before={false} /> · Current</> : "UFC · Current"} />
    <div className="grid grid-cols-2 gap-x-2 px-2 py-2 @[36rem]:gap-x-4 @[36rem]:px-4">
      {GROUPS.map(group => <div key={group.label} className="min-w-0">
        <h3 className={`${sectionLabel} px-2 pb-1 pt-1`}>{group.label}</h3>
        {group.metrics.map(metric => {
          const value = metric.value(totals);
          const median = medians?.values[metric.key] ?? null;
          return <CareerStatDetails key={metric.key} fighters={[{ id: fighterId, name }]} available={[metric.sample(totals).total > 0]} view={metricView(metric)} className="grid min-h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1 text-left">
            <span className="text-[11px] leading-4 text-zinc-500">{metric.short}</span>
            <span className="text-sm font-semibold tabular-nums text-zinc-900">{profileText(value, metric.format)}</span>
            {median != null ? <MedianBar metric={metric} value={value} median={median} /> : null}
          </CareerStatDetails>;
        })}
      </div>)}
    </div>
  </section>;
}

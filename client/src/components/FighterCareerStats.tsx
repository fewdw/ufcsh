import { STRIKING_METRICS, GRAPPLING_METRICS, metricView, profileText, type CareerTotals } from "../careerMetrics";
import { PanelHeading, PANEL_SHELL, sectionLabel } from "./FightStats";
import CareerStatDetails from "./CareerStatDetails";

export default function FighterCareerStats({ fighterId, name, totals }: { fighterId: string; name: string; totals?: CareerTotals }) {
  if (!totals) return null;
  return <section className={`${PANEL_SHELL} @container overflow-hidden`}>
    <PanelHeading title="Career stats" subtitle="UFC · Current" />
    <div className="grid grid-cols-2 gap-x-2 px-2 py-2 @[36rem]:gap-x-4 @[36rem]:px-4">
      {[{ label: "Striking", metrics: STRIKING_METRICS }, { label: "Grappling", metrics: GRAPPLING_METRICS }].map(group => <div key={group.label} className="min-w-0">
        <h3 className={`${sectionLabel} px-2 pb-1 pt-1`}>{group.label}</h3>
        {group.metrics.map(metric => <CareerStatDetails key={metric.key} fighters={[{ id: fighterId, name }]} available={[metric.sample(totals).total > 0]} view={metricView(metric)} className="grid min-h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-1 text-left">
          <span className="text-[11px] leading-4 text-zinc-500">{metric.short}</span>
          <span className="text-sm font-semibold tabular-nums text-zinc-900">{profileText(metric.value(totals), metric.format)}</span>
        </CareerStatDetails>)}
      </div>)}
    </div>
  </section>;
}

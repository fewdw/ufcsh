import type { InsightGroup, LabsInsightsResponse } from "../api";
import { BarList, ChartCard, StatTile } from "./charts";
import { compact, formatValue } from "./chartTokens";

const percent = (value: number | null) => formatValue(value, "percent");

const bar = (group: InsightGroup) => ({
  key: group.key,
  label: group.label,
  value: group.win_rate,
  n: group.n,
  tip: [
    { label: "win rate", value: percent(group.win_rate) },
    { label: "W–L–D", value: `${group.wins}–${group.losses}–${group.draws}` },
    { label: "fighter-bouts", value: compact(group.n) },
  ],
});

/**
 * What the fighters in this study had already done when they arrived, and how
 * they have fared since. Two comparisons and three numbers: enough to see
 * whether experience or age travelled, without a control panel to learn first.
 */
export default function RoadToUFC({ data }: { data: LabsInsightsResponse }) {
  const road = data.road;
  if (!road.verified) {
    return <p className="px-4 py-8 text-center text-[11px] text-zinc-400" role="status">No fighter in this study has a verified professional history yet.</p>;
  }
  const table = (groups: InsightGroup[]) => ({
    columns: ["Group", "W–L–D", "Win rate", "Fighter-bouts"],
    rows: groups.map((group) => [group.label, `${group.wins}–${group.losses}–${group.draws}`, percent(group.win_rate), group.n]),
  });

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-6">
      <div className="lg:col-span-6">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100 sm:grid-cols-3">
          <div className="bg-white"><StatTile label="Typical experience on arrival" value={road.median_outside_bouts == null ? "—" : `${road.median_outside_bouts} bouts`} note="Median professional record before the first UFC walk" emphasis /></div>
          <div className="bg-white"><StatTile label="Typical age on debut" value={road.median_debut_age == null ? "—" : `${road.median_debut_age.toFixed(1)} y/o`} note="Median age at the first UFC bout" /></div>
          <div className="bg-white"><StatTile label="History verified" value={percent(road.coverage)} note={`${compact(road.verified)} of this study's fighter-bouts`} /></div>
        </div>
      </div>

      <ChartCard
        title="Did the experience travel?"
        subtitle="Win rate in this study by how many professional bouts they had before the UFC."
        className="lg:col-span-3"
        table={table(road.by_experience)}
      >
        <div className="px-4 py-3">
          <BarList format="percent" max={100} data={road.by_experience.map(bar)} minSample={20} />
        </div>
      </ChartCard>

      <ChartCard
        title="Did arriving young help?"
        subtitle="Win rate in this study by their age on the night of the UFC debut."
        className="lg:col-span-3"
        table={table(road.by_debut_age)}
      >
        <div className="px-4 py-3">
          <BarList format="percent" max={100} data={road.by_debut_age.map(bar)} minSample={20} />
        </div>
      </ChartCard>

      <p className="px-1 text-[10px] leading-4 text-zinc-500 lg:col-span-6">
        Counted only for fighters whose professional history is identity-verified, so a common name never borrows someone else's record. Draws stay in the win rate; no contests do not. These are descriptions of who was signed, not a measure of what caused what.
      </p>
    </div>
  );
}

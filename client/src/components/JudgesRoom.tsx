import type { LabsInsightsResponse } from "../api";
import { BarList, ChartCard, StatTile } from "./charts";
import { compact, formatValue } from "./chartTokens";

const rate = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
const percent = (value: number | null) => formatValue(value, "percent");

/**
 * How the decisions in this study were scored. Four numbers a reader can act
 * on, the scorelines the judges actually wrote, and the officials who wrote
 * most of them — nothing that needs a manual to read.
 */
export default function JudgesRoom({ data }: { data: LabsInsightsResponse }) {
  const j = data.judges;
  const divided = j.split + j.majority;
  const scored = j.scored_bouts;

  const verdicts = [
    { key: "unanimous", label: "Unanimous", value: j.unanimous },
    { key: "split", label: "Split", value: j.split },
    { key: "majority", label: "Majority", value: j.majority },
    { key: "draw", label: "Draw", value: j.drawn },
  ].filter((row) => row.value > 0);

  if (!scored) {
    return <p className="px-4 py-8 text-center text-[11px] text-zinc-400" role="status">No decision in this study has a recorded scorecard.</p>;
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-6">
      <div className="lg:col-span-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100 sm:grid-cols-4">
          <div className="bg-white"><StatTile label="Went to the judges" value={compact(j.decision_bouts)} note={`${compact(scored)} with the cards on record`} /></div>
          <div className="bg-white"><StatTile label="All three agreed" value={percent(rate(j.unanimous, scored))} note={`${compact(j.unanimous)} of ${compact(scored)} decisions`} emphasis /></div>
          <div className="bg-white"><StatTile label="Judges disagreed" value={percent(rate(divided, scored))} note={`${compact(j.split)} split · ${compact(j.majority)} majority`} /></div>
          <div className="bg-white"><StatTile label="Winner landed less" value={percent(rate(j.against_the_numbers, j.against_the_numbers_known))} note={`${compact(j.against_the_numbers)} of ${compact(j.against_the_numbers_known)} with both totals known`} /></div>
        </div>
      </div>

      <ChartCard
        title="How the decisions were called"
        subtitle="Every scored decision in this study, by what the panel agreed on."
        className="lg:col-span-3"
        table={{ columns: ["Verdict", "Decisions", "Share"], rows: verdicts.map((row) => [row.label, row.value, percent(rate(row.value, scored))]) }}
      >
        <div className="px-4 py-3">
          <BarList
            format="percent"
            data={verdicts.map((row) => ({
              key: row.key,
              label: row.label,
              value: rate(row.value, scored),
              n: row.value,
              tip: [{ label: "decisions", value: compact(row.value) }, { label: "share", value: percent(rate(row.value, scored)) }],
            }))}
          />
        </div>
      </ChartCard>

      <ChartCard
        title="The cards they wrote"
        subtitle="The most common final scores, higher total first."
        className="lg:col-span-3"
        table={{ columns: ["Scoreline", "Cards"], rows: j.scorelines.map((line) => [line.label, line.n]) }}
      >
        <div className="px-4 py-3">
          <BarList data={j.scorelines.map((line) => ({ key: line.key, label: line.label, value: line.n, n: line.n }))} />
        </div>
      </ChartCard>

      {j.officials.length ? (
        <ChartCard
          title="Who scored these fights"
          subtitle="The judges with the most cards here, and how often one of them read a fight differently from the other two."
          className="lg:col-span-6"
          table={{ columns: ["Judge", "Cards", "Alone on the card", "Rate"], rows: j.officials.map((judge) => [judge.label, judge.n, judge.dissents, percent(judge.dissent_rate)]) }}
        >
          <div className="px-4 py-3">
            <BarList
              format="percent"
              data={j.officials.map((judge) => ({
                key: judge.key,
                label: judge.label,
                value: judge.dissent_rate,
                n: judge.n,
                tip: [
                  { label: "cards", value: compact(judge.n) },
                  { label: "alone on the card", value: compact(judge.dissents) },
                ],
              }))}
            />
          </div>
          <p className="px-4 pb-3 text-[10px] leading-4 text-zinc-500">
            Being alone on a card is disagreement, not error: a judge sees a round from one seat. Who gets assigned which fights differs too.
          </p>
        </ChartCard>
      ) : null}
    </div>
  );
}

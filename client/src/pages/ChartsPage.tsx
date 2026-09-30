import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi, type ChartTally, type StatsCharts } from "../api";
import PageToolbar from "../components/PageToolbar";
import RequestNotice from "../components/RequestNotice";
import { StatsTabs } from "../components/SectionTabs";
import {
  CalibrationPlot, ChartCard, Legend, LinePlot, StackedArea, TipBody, Toggle, pct, rate, useChartTip,
} from "../components/StatCharts";
import { useRouteScrollRestoration } from "../navigationState";
import { useSeo } from "../seo";

const SELECT = "h-8 max-w-40 rounded-full border border-zinc-200 bg-white pl-3 pr-7 text-xs font-medium text-zinc-700 outline-none transition hover:border-zinc-300 hover:bg-zinc-50 focus:border-zinc-400";

/** Categorical, in a fixed order on every chart: KO/TKO, submission, then decisions. */
const KO = "var(--color-series-1)";
const SUB = "var(--color-series-2)";
const DECISION = "var(--color-series-3)";
const SPLIT = "var(--color-series-4)";
/** Above and below an even chance. */
const MORE = "var(--color-series-1)";
const LESS = "#a1a1aa";

const bouts = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "bout" : "bouts"}`;
const sum = <T,>(rows: T[], value: (row: T) => number) => rows.reduce((total, row) => total + value(row), 0);
const tallyOf = (rows: { wins: number; bouts: number }[]) => ({ wins: sum(rows, (row) => row.wins), bouts: sum(rows, (row) => row.bouts) });
const span = (years: number[]) => (years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`);
/** The first and last few entries of a series, for a then-and-now comparison. */
const ends = <T,>(rows: T[]) => {
  const size = Math.max(1, Math.min(5, Math.floor(rows.length / 2)));
  return [rows.slice(0, size), rows.slice(-size)] as const;
};

// -- 1. Edges ----------------------------------------------------------------------

/** How far each edge moves a fighter from an even chance, as an arrow from 50%. */
function Edges({ rows }: { rows: ChartTally[] }) {
  const tip = useChartTip();
  const sorted = [...rows].sort((a, b) => rate(b) - rate(a));
  const lo = 0.3;
  const hi = 0.8;
  const at = (value: number) => `${((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * 100}%`;
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  return (
    <ChartCard
      title="Edges that win fights"
      question="How often the fighter with each edge won, counting only bouts where one side had it."
      finding={top && bottom ? <>Biggest edge: <b>{top.label}</b>, {pct(rate(top))} wins. Weakest: <b>{bottom.label}</b>, {pct(rate(bottom))}.</> : null}
      note="Draws and no contests are left out."
    >
      <ul className="grid gap-1" aria-label="Win rate by edge">
        {sorted.map((row) => {
          const value = rate(row);
          const up = value >= 0.5;
          return (
            <li key={row.key} {...tip.mark(row.key, () => <TipBody title={row.label} rows={[["Won", pct(value, 1)], ["Bouts", row.bouts.toLocaleString("en-US")]]} />)}
              className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-md px-1 py-0.5 outline-offset-0 hover:bg-zinc-50 sm:grid-cols-[12rem_minmax(0,1fr)_2.75rem]">
              <span className="truncate text-xs text-zinc-700" title={row.label}>{row.label}</span>
              <span className="relative h-5">
                <span className="absolute inset-y-0 w-px bg-zinc-300" style={{ left: at(0.5) }} aria-hidden="true" />
                <span className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full" aria-hidden="true"
                  style={{ left: up ? at(0.5) : at(value), right: `calc(100% - ${up ? at(value) : at(0.5)})`, background: up ? MORE : LESS }} />
                <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" aria-hidden="true"
                  style={{ left: at(value), background: up ? MORE : LESS }} />
              </span>
              <span className="text-right text-xs font-semibold tabular-nums text-zinc-900">{pct(value)}</span>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.75rem] gap-2 px-1 text-[10px] text-zinc-400 sm:grid-cols-[12rem_minmax(0,1fr)_2.75rem]" aria-hidden="true">
        <span />
        <span className="relative h-3">
          {[0.3, 0.5, 0.8].map((tick) => (
            <span key={tick} className={`absolute ${tick === lo ? "" : tick === hi ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: at(tick) }}>{pct(tick)}</span>
          ))}
        </span>
      </div>
      {tip.element}
    </ChartCard>
  );
}

// -- 2. Odds -----------------------------------------------------------------------

function Odds({ bins }: { bins: StatsCharts["odds"] }) {
  const tip = useChartTip();
  const heavy = bins.filter((bin) => bin.predicted >= 0.7);
  const won = tallyOf(heavy);
  const priced = heavy.length ? sum(heavy, (bin) => bin.predicted * bin.bouts) / won.bouts : 0;
  const gap = won.bouts ? rate(won) - priced : 0;
  const verdict = Math.abs(gap) < 0.015 ? "about what the line said" : gap > 0 ? "more often than the line said" : "less often than the line said";
  return (
    <ChartCard
      title="Are the odds right?"
      question="Each fighter's chance from the closing line, vig removed, against how often fighters at that price won."
      finding={won.bouts ? <>Fighters priced at 70% or better won <b>{pct(rate(won))}</b> against an implied {pct(priced)}: {verdict}.</> : null}
      note="Across: chance implied by the closing line, in 5% steps. Up: how often they won. Bubble size: fighters at that price. On the dashed line, the odds were exactly right."
    >
      <CalibrationPlot tip={tip} label="Closing-line chance against actual win rate"
        points={bins.map((bin) => ({ x: bin.predicted, y: rate(bin), n: bin.bouts }))}
        content={(index) => {
          const bin = bins[index];
          return <TipBody title={`Priced at ${pct(bin.predicted)}`} rows={[["Won", pct(rate(bin), 1)], ["Fighters", bin.bouts.toLocaleString("en-US")]]} />;
        }} />
      {tip.element}
    </ChartCard>
  );
}

// -- 3. How fights end -------------------------------------------------------------

function Endings({ years }: { years: StatsCharts["endings"] }) {
  const tip = useChartTip();
  const series = [
    { key: "ko", label: "KO/TKO", color: KO, values: years.map((year) => year.ko) },
    { key: "sub", label: "Submission", color: SUB, values: years.map((year) => year.sub) },
    { key: "unanimous", label: "Unanimous decision", color: DECISION, values: years.map((year) => year.unanimous) },
    { key: "split", label: "Split or majority decision", color: SPLIT, values: years.map((year) => year.split) },
  ];
  const total = (year: StatsCharts["endings"][number]) => year.ko + year.sub + year.unanimous + year.split;
  const decisions = (rows: StatsCharts["endings"]) => sum(rows, (year) => year.unanimous + year.split) / Math.max(1, sum(rows, total));
  const [then, now] = ends(years);
  return (
    <ChartCard
      title="How fights end"
      question="Each year's results by method."
      finding={years.length > 1 ? <>Decisions: <b>{pct(decisions(then))}</b> of results in {span(then.map((year) => year.year))}, <b>{pct(decisions(now))}</b> in {span(now.map((year) => year.year))}.</> : null}
    >
      <Legend items={series} />
      {years.length > 1 ? (
        <StackedArea name="endings" tip={tip} label="Share of results by method, by year" xs={years.map((year) => year.year)} xLabel={String}
          series={series}
          content={(index) => {
            const year = years[index];
            return <TipBody title={String(year.year)} note={bouts(total(year))}
              rows={series.slice().reverse().map((band) => [band.label, pct(band.values[index] / total(year)), band.color] as const)} />;
          }} />
      ) : <Empty />}
      {tip.element}
    </ChartCard>
  );
}

// -- 4. When the finish comes ------------------------------------------------------

type Method = "all" | "ko" | "sub";

function FinishClock({ cells }: { cells: StatsCharts["finishClock"] }) {
  const tip = useChartTip();
  const [method, setMethod] = useState<Method>("all");
  const finishes = (cell: StatsCharts["finishClock"][number]) => (method === "ko" ? cell.ko : method === "sub" ? cell.sub : cell.ko + cell.sub);
  const shown = cells.filter((cell) => cell.reached >= 50);
  const hazard = (cell: StatsCharts["finishClock"][number]) => finishes(cell) / cell.reached;
  const most = Math.max(0.0001, ...shown.map(hazard));
  const peak = shown.filter((cell) => cell.round <= 3).sort((a, b) => hazard(b) - hazard(a))[0];
  const first = shown[0];
  const name = (cell: StatsCharts["finishClock"][number]) => `round ${cell.round}, minute ${cell.minute}`;
  const word = method === "ko" ? "knocked out" : method === "sub" ? "submitted" : "finished";
  return (
    <ChartCard
      title="When the finish comes"
      question="Of bouts still going at each minute, the share finished in it."
      controls={<Toggle label="Method" value={method} onChange={setMethod} options={[["all", "All"], ["ko", "KO/TKO"], ["sub", "Sub"]]} />}
      finding={peak && first ? <>Most dangerous minute: <b>{name(peak)}</b>, {pct(hazard(peak), 1)} {word}. The first minute: {pct(hazard(first), 1)}.</> : null}
      note="Five-minute rounds since November 2000. Rounds 4 and 5 are five-round bouts only."
    >
      <div className="grid grid-cols-[3.25rem_repeat(5,minmax(0,1fr))] gap-0.5 text-[10px] text-zinc-400" role="table" aria-label="Finish rate by round and minute">
        <span role="columnheader" />
        {[1, 2, 3, 4, 5].map((minute) => <span key={minute} role="columnheader" className="pb-0.5 text-center">Min {minute}</span>)}
        {[1, 2, 3, 4, 5].map((round) => (
          <div key={round} role="row" className="contents">
            <span role="rowheader" className="flex items-center">Round {round}</span>
            {cells.filter((cell) => cell.round === round).map((cell) => {
              if (cell.reached < 50) return <span key={cell.minute} role="cell" className="h-10 rounded bg-zinc-50" />;
              const share = hazard(cell) / most;
              const key = `${round}-${cell.minute}`;
              return (
                <span key={cell.minute} role="cell"
                  {...tip.mark(key, () => <TipBody title={`Round ${round}, minute ${cell.minute}`} rows={[
                    ["Finished here", pct(hazard(cell), 1)],
                    ["KO/TKO", cell.ko.toLocaleString("en-US")],
                    ["Submission", cell.sub.toLocaleString("en-US")],
                    ["Bouts reaching it", cell.reached.toLocaleString("en-US")],
                  ]} />)}
                  className={`grid h-10 place-items-center rounded text-[11px] font-semibold tabular-nums outline-offset-1 ${share > 0.55 ? "text-white dark:text-black" : "text-zinc-700"}`}
                  style={{ background: `color-mix(in oklab, var(--color-series-1) ${Math.round(8 + share * 92)}%, var(--color-plot-track))` }}>
                  {pct(hazard(cell), 1)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {tip.element}
    </ChartCard>
  );
}

// -- 5. Age ------------------------------------------------------------------------

function AgeCurve({ ages }: { ages: StatsCharts["age"] }) {
  const tip = useChartTip();
  const young = ages.filter((row) => row.age <= 25);
  const old = ages.filter((row) => row.age >= 35);
  const knocked = (rows: StatsCharts["age"]) => sum(rows, (row) => row.knockedOut) / Math.max(1, sum(rows, (row) => row.bouts));
  const label = (age: number) => (age <= 21 ? "≤21" : age >= 40 ? "40+" : String(age));
  const series = [
    { key: "win", label: "Won", color: MORE, values: ages.map(rate) },
    { key: "ko", label: "KO'd", color: SUB, values: ages.map((row) => row.knockedOut / row.bouts) },
  ];
  return (
    <ChartCard
      title="The age curve"
      question="Win rate, and how often fighters were knocked out, by age on fight night."
      finding={young.length && old.length ? <>25 and under: won <b>{pct(rate(tallyOf(young)))}</b>, KO'd {pct(knocked(young))}. 35 and over: won <b>{pct(rate(tallyOf(old)))}</b>, KO'd {pct(knocked(old))}.</> : null}
    >
      <Legend items={series} />
      {ages.length > 1 ? (
        <LinePlot name="age" tip={tip} label="Win and knocked-out rates by age" xs={ages.map((row) => row.age)} xLabel={label}
          series={series} domain={[0, 0.7]} ticks={[0, 0.2, 0.4, 0.6]} format={(value) => pct(value)} reference={0}
          content={(index) => {
            const row = ages[index];
            return <TipBody title={`Age ${label(row.age)}`} note={bouts(row.bouts)}
              rows={[["Won", pct(rate(row), 1), MORE], ["KO'd", pct(row.knockedOut / row.bouts, 1), SUB]]} />;
          }} />
      ) : <Empty />}
      {tip.element}
    </ChartCard>
  );
}

// -- 6. Size of the edge -----------------------------------------------------------

const GAP_AXIS: Record<string, string> = { age: "years", reach: "inches", height: "inches", experience: "UFC bouts" };

function Gaps({ gaps }: { gaps: StatsCharts["gaps"] }) {
  const tip = useChartTip();
  const ends = gaps.filter((gap) => gap.steps.length).map((gap) => ({ gap, step: gap.steps[gap.steps.length - 1] }));
  const best = [...ends].sort((a, b) => rate(b.step) - rate(a.step))[0];
  const worst = [...ends].sort((a, b) => rate(a.step) - rate(b.step))[0];
  return (
    <ChartCard
      title="How big an edge?"
      question="Win rate of the fighter with the advantage, by how large it was."
      finding={best && worst && best !== worst ? <><b>{best.step.label} {best.gap.unit}</b>: {pct(rate(best.step))} wins. <b>{worst.step.label} {worst.gap.unit}</b>: {pct(rate(worst.step))}.</> : null}
    >
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {gaps.map((gap) => (
          <figure key={gap.key} className="min-w-0">
            <figcaption className="text-xs font-medium text-zinc-700">{gap.label} <span className="font-normal text-zinc-400">({GAP_AXIS[gap.key] ?? gap.unit})</span></figcaption>
            {gap.steps.length > 1 ? (
              <LinePlot name={`gap-${gap.key}`} tip={tip} label={`Win rate by ${gap.unit}`} height={150} xs={gap.steps.map((_, index) => index)} xLabel={(index) => gap.steps[index]?.label ?? ""}
                series={[{ key: gap.key, label: gap.label, color: MORE, values: gap.steps.map(rate) }]}
                domain={[0.35, 0.75]} ticks={[0.4, 0.5, 0.6, 0.7]} format={(value) => pct(value)} reference={0.5}
                content={(index) => {
                  const step = gap.steps[index];
                  return <TipBody title={`${step.label} ${gap.unit}`} rows={[["Won", pct(rate(step), 1)], ["Bouts", step.bouts.toLocaleString("en-US")]]} />;
                }} />
            ) : <Empty />}
          </figure>
        ))}
      </div>
      {tip.element}
    </ChartCard>
  );
}

// -- 7. Momentum and ring rust -----------------------------------------------------

/** Columns rising above or falling below an even chance. */
function Columns({ title, rows, tip }: { title: string; rows: ChartTally[]; tip: ReturnType<typeof useChartTip> }) {
  const lo = 0.3;
  const hi = 0.7;
  const y = (value: number) => ((Math.min(hi, Math.max(lo, value)) - lo) / (hi - lo)) * 100;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs font-medium text-zinc-700">{title}</figcaption>
      <div className="relative flex h-36 items-stretch gap-1">
        <span className="pointer-events-none absolute inset-x-0 border-t border-zinc-300" style={{ bottom: `${y(0.5)}%` }} aria-hidden="true" />
        {rows.map((row) => {
          const value = rate(row);
          const up = value >= 0.5;
          const [from, to] = up ? [y(0.5), y(value)] : [y(value), y(0.5)];
          return (
            <div key={row.key} {...tip.mark(`${title}-${row.key}`, () => <TipBody title={`${title}: ${row.label}`} rows={[["Won", pct(value, 1)], ["Bouts", row.bouts.toLocaleString("en-US")]]} />)}
              className="relative min-w-0 flex-1 rounded outline-offset-1 hover:bg-zinc-50">
              <span className={`absolute inset-x-[15%] ${up ? "rounded-t" : "rounded-b"}`} style={{ bottom: `${from}%`, height: `${Math.max(1, to - from)}%`, background: up ? MORE : LESS }} />
              <span className="absolute inset-x-0 text-center text-[10px] font-semibold tabular-nums text-zinc-700" style={up ? { bottom: `calc(${to}% + 2px)` } : { top: `calc(${100 - from}% + 2px)` }}>
                {pct(value)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-center text-[10px] leading-3 text-zinc-400" aria-hidden="true">
        {rows.map((row) => <span key={row.key} className="min-w-0 flex-1">{row.label}</span>)}
      </div>
    </figure>
  );
}

function Momentum({ streaks, layoffs }: { streaks: ChartTally[]; layoffs: ChartTally[] }) {
  const tip = useChartTip();
  const hot = [...streaks].sort((a, b) => rate(b) - rate(a))[0];
  const rust = [...layoffs].sort((a, b) => rate(a) - rate(b))[0];
  const short = (label: string) => label.replace("Won ", "W").replace("Lost ", "L");
  return (
    <ChartCard
      title="Momentum and ring rust"
      question="Win rate by the streak a fighter brought in, and by time since their last UFC bout."
      finding={hot && rust ? <>{hot.label === "Debut" ? "Debuting" : <>Coming in on <b>{hot.label.toLowerCase()}</b></>}: {pct(rate(hot))} wins. After <b>{rust.label.toLowerCase()}</b> out: {pct(rate(rust))}.</> : null}
    >
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-[3fr_2fr]">
        <Columns title="Streak" rows={streaks.map((row) => ({ ...row, label: short(row.label) }))} tip={tip} />
        <Columns title="Time off" rows={layoffs.map((row) => ({ ...row, label: row.label.replace("Under 3 months", "<3 mo").replace(" months", " mo").replace(" years", " yr") }))} tip={tip} />
      </div>
      {tip.element}
    </ChartCard>
  );
}

// -- 8. Decisions ------------------------------------------------------------------

function Decisions({ decisions }: { decisions: StatsCharts["decisions"] }) {
  const tip = useChartTip();
  const [kind, setKind] = useState<"all" | "split">("all");
  // One order for both views, so a toggle shows each category move.
  const order = new Map([...decisions.all].sort((a, b) => rate(b) - rate(a)).map((row, index) => [row.key, index]));
  const rows = [...decisions[kind]].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  const strikes = (set: ChartTally[]) => set.find((row) => row.key === "significantStrikes");
  const all = strikes(decisions.all);
  const split = strikes(decisions.split);
  return (
    <ChartCard
      title="What wins a decision"
      question="How often the fighter who led each category won the decision."
      controls={<Toggle label="Decisions" value={kind} onChange={setKind} options={[["all", "All"], ["split", "Split"]]} />}
      finding={all && split ? <>Out-landing on significant strikes won <b>{pct(rate(all))}</b> of decisions, but only <b>{pct(rate(split))}</b> of split decisions.</> : null}
      note="Split includes majority decisions. Ties in a category are left out."
    >
      <ul className="grid gap-1" aria-label="Decision win rate by category led">
        {rows.map((row) => (
          <li key={row.key} {...tip.mark(row.key, () => <TipBody title={`Led on ${row.label.toLowerCase()}`} rows={[["Won the decision", pct(rate(row), 1)], ["Decisions", row.bouts.toLocaleString("en-US")]]} />)}
            className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-md px-1 py-0.5 outline-offset-0 hover:bg-zinc-50">
            <span className="truncate text-xs text-zinc-700">{row.label}</span>
            <span className="relative h-3.5 rounded-sm bg-zinc-100/50">
              <span className="absolute inset-y-0 left-0 rounded-r" style={{ width: pct(rate(row), 1), background: rate(row) >= 0.5 ? MORE : LESS }} />
              <span className="absolute -inset-y-0.5 left-1/2 w-px bg-zinc-400" aria-hidden="true" />
            </span>
            <span className="text-right text-xs font-semibold tabular-nums text-zinc-900">{pct(rate(row))}</span>
          </li>
        ))}
      </ul>
      {tip.element}
    </ChartCard>
  );
}

// -- 9. Divisions ------------------------------------------------------------------

function Divisions({ rows, selected }: { rows: StatsCharts["divisionEndings"]; selected: string }) {
  const tip = useChartTip();
  const total = (row: StatsCharts["divisionEndings"][number]) => row.ko + row.sub + row.decision;
  const finish = (row: StatsCharts["divisionEndings"][number]) => (row.ko + row.sub) / total(row);
  const parts = [
    { key: "ko", label: "KO/TKO", color: KO },
    { key: "sub", label: "Submission", color: SUB },
    { key: "decision", label: "Decision", color: DECISION },
  ] as const;
  const chosen = rows.find((row) => row.division === selected);
  const first = rows[0];
  const last = rows[rows.length - 1];
  return (
    <ChartCard
      title="Finishes by division"
      question="How bouts end in each division, most finishes first."
      finding={chosen ? <>{chosen.division}: <b>{pct(finish(chosen))}</b> finished, {ordinal(rows.indexOf(chosen) + 1)} of {rows.length} divisions.</>
        : first && last && first !== last ? <>{first.division}: <b>{pct(finish(first))}</b> finished. {last.division}: <b>{pct(finish(last))}</b>.</> : null}
    >
      <Legend items={[...parts]} />
      <ul className="grid gap-1.5" aria-label="Results by division">
        {rows.map((row) => (
          <li key={row.division} {...tip.mark(row.division, () => <TipBody title={row.division} note={bouts(total(row))}
            rows={parts.map((part) => [part.label, pct(row[part.key] / total(row), 1), part.color] as const)} />)}
            className={`grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-md px-1 py-0.5 outline-offset-0 transition-opacity hover:bg-zinc-50 ${chosen && chosen !== row ? "opacity-45" : ""}`}>
            <span className={`truncate text-xs ${chosen === row ? "font-semibold text-zinc-900" : "text-zinc-700"}`}>{row.division.replace("Women's ", "W. ")}</span>
            <span className="flex h-3.5 gap-0.5 overflow-hidden rounded">
              {parts.map((part) => <span key={part.key} style={{ width: pct(row[part.key] / total(row), 2), background: part.color }} />)}
            </span>
            <span className="text-right text-xs font-semibold tabular-nums text-zinc-900">{pct(finish(row))}</span>
          </li>
        ))}
      </ul>
      {tip.element}
    </ChartCard>
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

// -- 10. Pace ----------------------------------------------------------------------

const PACE = [
  { key: "sigPerMinute", label: "Significant strikes landed per minute", format: (value: number) => value.toFixed(1), unit: "" },
  { key: "accuracy", label: "Significant strike accuracy", format: (value: number) => `${Math.round(value)}%`, unit: "%" },
  { key: "takedownsPer15", label: "Takedowns per 15 minutes", format: (value: number) => value.toFixed(1), unit: "" },
  { key: "control", label: "Time spent in control", format: (value: number) => `${Math.round(value)}%`, unit: "%" },
] as const;

/** Round, readable grid lines covering a series. */
function niceTicks(values: number[]): { domain: [number, number]; ticks: number[] } {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const raw = (hi - lo) / 3 || 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= end + step / 2; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return { domain: [start, end], ticks };
}

function Pace({ years }: { years: StatsCharts["pace"] }) {
  const tip = useChartTip();
  const [then, now] = ends(years);
  const mean = (rows: StatsCharts["pace"], key: "sigPerMinute" | "control") => {
    const known = rows.filter((row) => row[key] != null);
    return known.length ? sum(known, (row) => row[key]!) / known.length : null;
  };
  const strikes = [mean(then, "sigPerMinute"), mean(now, "sigPerMinute")];
  const control = [mean(then, "control"), mean(now, "control")];
  return (
    <ChartCard
      title="How the sport has changed"
      question="Per fighter, each year: how much lands, how often it lands, and how much of the fight is spent on top."
      finding={years.length > 1 && strikes[0] != null && strikes[1] != null ? <>
        Strikes landed per minute: <b>{strikes[0].toFixed(1)} → {strikes[1].toFixed(1)}</b>
        {control[0] != null && control[1] != null ? <>. Time in control: <b>{Math.round(control[0])}% → {Math.round(control[1])}%</b></> : null}
        {" "}({span(then.map((row) => row.year))} against {span(now.map((row) => row.year))}).
      </> : null}
      note="Control is the share of fight time either fighter spent in control, from the official stats."
    >
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {PACE.map((measure) => {
          const known = years.filter((row) => row[measure.key] != null);
          const scale = known.length ? niceTicks(known.map((row) => row[measure.key]!)) : null;
          return (
            <figure key={measure.key} className="min-w-0">
              <figcaption className="text-xs font-medium text-zinc-700">{measure.label}</figcaption>
              {known.length > 1 && scale ? (
                <LinePlot name={`pace-${measure.key}`} tip={tip} label={measure.label} height={140}
                  xs={known.map((row) => row.year)} xLabel={(year) => `’${String(year).slice(2)}`}
                  series={[{ key: measure.key, label: measure.label, color: MORE, values: known.map((row) => row[measure.key]) }]}
                  domain={scale.domain} ticks={scale.ticks} format={measure.format}
                  content={(index) => {
                    const row = known[index];
                    return <TipBody title={String(row.year)} note={bouts(row.bouts)} rows={[[measure.label, measure.format(row[measure.key]!)]]} />;
                  }} />
              ) : <Empty />}
            </figure>
          );
        })}
      </div>
      {tip.element}
    </ChartCard>
  );
}

function Empty() {
  return <div className="grid h-32 place-items-center text-xs text-zinc-400">Not enough bouts for these filters.</div>;
}

// -- Page --------------------------------------------------------------------------

export default function ChartsPage() {
  const [params, setParams] = useSearchParams();
  const division = params.get("division") ?? "all";
  const since = params.get("since") ?? "all";
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };
  const query = new URLSearchParams();
  if (division !== "all") query.set("division", division);
  if (since !== "all") query.set("since", since);
  const request = `/api/charts${query.size ? `?${query}` : ""}`;
  const { data, loading, error, retry } = useApi<StatsCharts>(request);
  // The last answer stays up while the next filter loads, so nothing jumps.
  const [shown, setShown] = useState<StatsCharts | null>(null);
  useEffect(() => { if (data) setShown(data); }, [data]);
  const charts = data ?? shown;
  const scroll = useRouteScrollRestoration<HTMLDivElement>("charts:page", Boolean(charts));
  useSeo({
    title: "UFC Charts: How Fights Are Won",
    description: "How UFC fights end, when finishes come, whether the odds are right, and which edges win fights: age, reach, momentum, layoffs and what judges reward.",
    path: "/charts",
  });

  if (!charts) {
    return <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-400">
      {error ? <RequestNotice onRetry={retry}>Couldn’t load the charts.</RequestNotice> : <span role="status" className="appear-late">Drawing charts…</span>}
    </div>;
  }

  const cards: ReactNode[] = [
    <Edges key="edges" rows={charts.edges} />,
    <Odds key="odds" bins={charts.odds} />,
    <Endings key="endings" years={charts.endings} />,
    <FinishClock key="clock" cells={charts.finishClock} />,
    <AgeCurve key="age" ages={charts.age} />,
    <Gaps key="gaps" gaps={charts.gaps} />,
    <Momentum key="momentum" streaks={charts.streaks} layoffs={charts.layoffs} />,
    <Decisions key="decisions" decisions={charts.decisions} />,
    <Divisions key="divisions" rows={charts.divisionEndings} selected={charts.division} />,
    <Pace key="pace" years={charts.pace} />,
  ];

  return (
    <div ref={scroll} className="h-full overflow-y-auto">
      <main className="mx-auto flex max-w-[100rem] flex-col gap-2 p-2 pb-8 sm:gap-3 sm:p-3">
        <h1 className="sr-only">UFC charts</h1>
        <PageToolbar>
          <StatsTabs />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="text-[11px] tabular-nums text-zinc-400 max-sm:hidden" role="status">{loading ? "Updating…" : bouts(charts.bouts)}</span>
            <select aria-label="Division" value={charts.division} onChange={(event) => set("division", event.target.value)} className={SELECT}>
              <option value="all">All bouts</option>
              <option value="men">Men</option>
              <option value="women">Women</option>
              <optgroup label="Division">
                {charts.divisions.map((name) => <option key={name} value={name}>{name}</option>)}
              </optgroup>
            </select>
            <select aria-label="Since" value={charts.since} onChange={(event) => set("since", event.target.value)} className={SELECT}>
              <option value="all">All time</option>
              {charts.years.map((year) => <option key={year} value={year}>Since {year}</option>)}
            </select>
          </div>
        </PageToolbar>
        {error ? <RequestNotice onRetry={retry}>Couldn’t update the charts. The last results are shown.</RequestNotice> : null}
        <div aria-busy={loading} className={`grid grid-cols-1 gap-2 transition-opacity sm:gap-3 lg:grid-cols-2 ${loading ? "opacity-70 delay-200" : ""}`}>
          {cards}
        </div>
      </main>
    </div>
  );
}

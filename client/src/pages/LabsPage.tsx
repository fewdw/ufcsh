import { useEffect, useMemo, useState } from "react";
import { ChevronDown, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useApi } from "../api";
import type { LabsResponse, LabsSummary } from "../api";
import FighterSearch, { type PickedFighter } from "../components/FighterSearch";
import StatsModeSwitch from "../components/StatsModeSwitch";
import { LOSS_RAMP, PANEL, WIN_RAMP, compact, formatValue, type Format } from "../components/chartTokens";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSeo } from "../seo";
import {
  EMPTY_FILTERS,
  FILTER_SECTIONS,
  activeCount,
  clearKeys,
  describeFilters,
  toQuery,
  type FilterField,
  type LabFilters,
} from "./labFilters";

const selectClass = "w-full rounded-lg border border-zinc-200 bg-white py-2 pl-2.5 pr-7 text-[11px] font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-500";
const inputClass = "w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[11px] tabular-nums text-zinc-800 outline-none transition placeholder:text-zinc-300 focus:border-zinc-500";

type Population = { filters: LabFilters; fighters: PickedFighter[]; opponents: PickedFighter[] };
type LabState = { a: Population };

const emptyPopulation = (): Population => ({
  filters: { ...EMPTY_FILTERS, division: [], fighterIds: [], opponentIds: [] },
  fighters: [],
  opponents: [],
});
const DEFAULT_STATE: LabState = { a: emptyPopulation() };

type QuickFilter = {
  id: string;
  label: string;
  note: string;
  patch: Partial<LabFilters>;
  keys: (keyof LabFilters)[];
};

const QUICK_FILTERS: QuickFilter[] = [
  { id: "favorite", label: "Favorites", note: "Shorter closing price", patch: { odds: "favorite" }, keys: ["odds"] },
  { id: "underdog", label: "Underdogs", note: "Longer closing price", patch: { odds: "underdog" }, keys: ["odds"] },
  { id: "layoff", label: "Long layoffs", note: "365+ days away", patch: { layoffMin: "365" }, keys: ["layoffMin"] },
  { id: "turnaround", label: "Quick returns", note: "60 days or less", patch: { layoffMax: "60" }, keys: ["layoffMax"] },
  { id: "streak", label: "Hot streaks", note: "3+ UFC wins entering", patch: { winStreakMin: "3" }, keys: ["winStreakMin"] },
  { id: "ko-return", label: "After a KO loss", note: "First bout back", patch: { prev: "koLoss" }, keys: ["prev"] },
  { id: "debut", label: "UFC debuts", note: "First Octagon bout", patch: { prev: "debut" }, keys: ["prev"] },
  { id: "title", label: "Title bouts", note: "Undisputed or interim", patch: { title: "only" }, keys: ["title"] },
  { id: "main", label: "Main events", note: "Top bout on the card", patch: { mainEvent: "only" }, keys: ["mainEvent"] },
  { id: "five", label: "Five rounders", note: "Scheduled for five", patch: { rounds: "5" }, keys: ["rounds"] },
  { id: "veteran", label: "Age 35+", note: "Age on fight night", patch: { ageMin: "35" }, keys: ["ageMin"] },
  { id: "champions", label: "Former champions", note: "No longer holding gold", patch: { status: "formerChampion" }, keys: ["status"] },
];

function sameValue(a: LabFilters[keyof LabFilters], b: LabFilters[keyof LabFilters] | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function Metric({ label, value, note, tone = "default" }: {
  label: string;
  value: string;
  note: string;
  tone?: "default" | "positive" | "negative";
}) {
  const color = tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-rose-700" : "text-zinc-950";
  return (
    <div className="min-w-0 border-r border-zinc-100 px-3 py-3 last:border-r-0">
      <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-400">{label}</div>
      <div className={`mt-1 truncate text-base font-semibold tabular-nums ${color}`} title={value}>{value}</div>
      <div className="mt-0.5 truncate text-[9px] text-zinc-400" title={note}>{note}</div>
    </div>
  );
}

function FilterControl({ field, filters, divisions, years, set }: {
  field: FilterField;
  filters: LabFilters;
  divisions: string[];
  years: { first: number; last: number };
  set: (key: keyof LabFilters, value: string | string[]) => void;
}) {
  if (field.kind === "divisions") {
    return (
      <label className="block">
        <span className="mb-1.5 block text-[10px] font-semibold text-zinc-700">Divisions</span>
        <span className="flex flex-wrap gap-1">
          {divisions.map((division) => {
            const selected = filters.division.includes(division);
            return (
              <button
                key={division}
                type="button"
                aria-pressed={selected}
                onClick={() => set("division", selected ? filters.division.filter((entry) => entry !== division) : [...filters.division, division])}
                className={`rounded-full border px-2 py-1 text-[9px] font-semibold transition ${selected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-900"}`}
              >
                {division.replace("Women's ", "W ")}
              </button>
            );
          })}
        </span>
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="block min-w-0">
        <span className="mb-1.5 block text-[10px] font-semibold text-zinc-700">{field.label}</span>
        <select value={filters[field.key] as string} onChange={(event) => set(field.key, event.target.value)} className={selectClass}>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {field.hint ? <span className="mt-1 block text-[9px] leading-3.5 text-zinc-400">{field.hint}</span> : null}
      </label>
    );
  }
  if (field.kind === "number") {
    return (
      <label className="block min-w-0">
        <span className="mb-1.5 block text-[10px] font-semibold text-zinc-700">{field.label}{field.unit ? ` (${field.unit})` : ""}</span>
        <input type="number" value={filters[field.key] as string} onChange={(event) => set(field.key, event.target.value)} className={inputClass} placeholder="Any" />
        {field.hint ? <span className="mt-1 block text-[9px] leading-3.5 text-zinc-400">{field.hint}</span> : null}
      </label>
    );
  }
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[10px] font-semibold text-zinc-700">{field.label}{field.unit ? ` (${field.unit})` : ""}</span>
      <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
        <input type="number" value={filters[field.minKey] as string} onChange={(event) => set(field.minKey, event.target.value)} className={inputClass} placeholder={field.placeholderMin ?? (field.minKey === "from" ? String(years.first) : "Min")} aria-label={`${field.label} minimum`} />
        <span className="text-[9px] text-zinc-300">to</span>
        <input type="number" value={filters[field.maxKey] as string} onChange={(event) => set(field.maxKey, event.target.value)} className={inputClass} placeholder={field.placeholderMax ?? (field.maxKey === "to" ? String(years.last) : "Max")} aria-label={`${field.label} maximum`} />
      </span>
      {field.hint ? <span className="mt-1 block text-[9px] leading-3.5 text-zinc-400">{field.hint}</span> : null}
    </label>
  );
}

function FilterDeck({ population, divisions, years, onChange, onReset }: {
  population: Population;
  divisions: string[];
  years: { first: number; last: number };
  onChange: (population: Population) => void;
  onReset: () => void;
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(["scope"]));
  const filters = population.filters;
  const set = (key: keyof LabFilters, value: string | string[]) => onChange({ ...population, filters: { ...filters, [key]: value } as LabFilters });
  const applyQuick = (quick: QuickFilter) => {
    const selected = quick.keys.every((key) => sameValue(filters[key], quick.patch[key]));
    onChange({ ...population, filters: selected ? clearKeys(filters, quick.keys) : { ...filters, ...quick.patch } });
  };

  return (
    <aside className="min-w-0 border-b border-zinc-200 bg-zinc-50/70 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <span>
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Build the cohort</span>
          <span className="mt-0.5 block text-[9px] text-zinc-400">Conditions are measured entering the bout.</span>
        </span>
        <button type="button" onClick={onReset} disabled={activeCount(filters) === 0} className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-default disabled:opacity-30" title="Reset every filter" aria-label="Reset every filter">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="border-b border-zinc-200 p-3">
        <div className="mb-2 text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-400">Fast studies</div>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_FILTERS.map((quick) => {
            const selected = quick.keys.every((key) => sameValue(filters[key], quick.patch[key]));
            return (
              <button key={quick.id} type="button" aria-pressed={selected} onClick={() => applyQuick(quick)} className={`min-w-0 rounded-xl border px-2.5 py-2 text-left transition ${selected ? "border-zinc-900 bg-zinc-900 text-white shadow-sm" : "border-zinc-200 bg-white hover:border-zinc-400"}`}>
                <span className="block truncate text-[10px] font-semibold">{quick.label}</span>
                <span className={`mt-0.5 block truncate text-[8px] ${selected ? "text-zinc-300" : "text-zinc-400"}`}>{quick.note}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y divide-zinc-200 lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto">
        {FILTER_SECTIONS.map((section) => (
          <details
            key={section.id}
            open={openSections.has(section.id)}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setOpenSections((current) => {
                const next = new Set(current);
                if (open) next.add(section.id);
                else next.delete(section.id);
                return next;
              });
            }}
            className="group"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span><span className="block text-[10px] font-semibold text-zinc-800">{section.title}</span><span className="mt-0.5 block text-[8px] text-zinc-400">{section.blurb}</span></span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-1">
              {section.fields.map((field) => <FilterControl key={field.kind === "range" ? String(field.minKey) : field.kind === "divisions" ? "division" : String(field.key)} field={field} filters={filters} divisions={divisions} years={years} set={set} />)}
              {section.id === "fighter" ? (
                <div>
                  <span className="mb-1.5 block text-[10px] font-semibold text-zinc-700">Specific fighters</span>
                  <FighterSearch selected={population.fighters} compact emptyPlaceholder="Any fighter" onChange={(fighters) => onChange({ ...population, fighters, filters: { ...filters, fighterIds: fighters.map((fighter) => fighter.id) } })} />
                </div>
              ) : null}
              {section.id === "opponent" ? (
                <div>
                  <span className="mb-1.5 block text-[10px] font-semibold text-zinc-700">Specific opponents</span>
                  <FighterSearch selected={population.opponents} compact emptyPlaceholder="Any opponent" onChange={(opponents) => onChange({ ...population, opponents, filters: { ...filters, opponentIds: opponents.map((fighter) => fighter.id) } })} />
                </div>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}

type MethodDatum = { label: string; value: number; color: string };

function MethodSide({ title, total, data, tone }: { title: string; total: number; data: MethodDatum[]; tone: "win" | "loss" }) {
  return (
    <div className="min-w-0 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-[9px] font-bold uppercase tracking-[0.14em] ${tone === "win" ? "text-emerald-700" : "text-rose-700"}`}>{title}</span>
        <span className="text-xs font-semibold tabular-nums text-zinc-900">{compact(total)}</span>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-zinc-100">
        {data.filter((entry) => entry.value > 0).map((entry) => <span key={entry.label} style={{ width: `${total ? (entry.value / total) * 100 : 0}%`, backgroundColor: entry.color }} title={`${entry.label}: ${entry.value}`} />)}
      </div>
      <div className="mt-3 space-y-2">
        {data.map((entry) => (
          <div key={entry.label} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 text-[10px]">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-zinc-500">{entry.label}</span>
            <span className="font-semibold tabular-nums text-zinc-800">{compact(entry.value)}</span>
            <span className="w-11 text-right tabular-nums text-zinc-400">{formatValue(total ? (entry.value / total) * 100 : null, "percent")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Coverage({ label, known, total, color }: { label: string; known: number; total: number; color: string }) {
  const percent = total ? Math.round((known / total) * 1000) / 10 : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-[9px]"><span className="font-medium text-zinc-500">{label}</span><span className="tabular-nums text-zinc-400">{compact(known)} · {formatValue(percent, "percent")}</span></div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} /></div>
    </div>
  );
}

function ValueBlock({ label, value, format, note }: { label: string; value: number | null; format: Format; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-3">
      <div className="text-[8px] font-bold uppercase tracking-[0.13em] text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-950">{formatValue(value, format)}</div>
      <div className="mt-0.5 text-[9px] leading-3.5 text-zinc-400">{note}</div>
    </div>
  );
}

function CombinedRecord({ data, loading }: { data: LabsResponse; loading: boolean }) {
  const s: LabsSummary = data.summary;
  const total = s.wins + s.losses + s.draws + s.ncs;
  const slices = [
    { value: s.wins, color: "#047857" },
    { value: s.losses, color: "#be123c" },
    { value: s.draws, color: "#f59e0b" },
    { value: s.ncs, color: "#a1a1aa" },
  ];
  let cursor = 0;
  const gradient = slices.filter((slice) => slice.value > 0).map((slice) => {
    const start = cursor;
    cursor += total ? (slice.value / total) * 100 : 0;
    return `${slice.color} ${start}% ${cursor}%`;
  }).join(", ");
  const winMethods: MethodDatum[] = [
    { label: "KO/TKO", value: s.outcomes.win_ko, color: WIN_RAMP[0] },
    { label: "Submission", value: s.outcomes.win_sub, color: WIN_RAMP[1] },
    { label: "Decision", value: s.outcomes.win_dec, color: WIN_RAMP[2] },
    { label: "Other", value: s.outcomes.win_other, color: "#d1fae5" },
  ];
  const lossMethods: MethodDatum[] = [
    { label: "KO/TKO", value: s.outcomes.loss_ko, color: LOSS_RAMP[0] },
    { label: "Submission", value: s.outcomes.loss_sub, color: LOSS_RAMP[1] },
    { label: "Decision", value: s.outcomes.loss_dec, color: LOSS_RAMP[2] },
    { label: "Other", value: s.outcomes.loss_other, color: "#ffe4e6" },
  ];
  const pricedEdge = s.priced_win_rate != null && s.bet_avg_implied != null ? Math.round((s.priced_win_rate - s.bet_avg_implied) * 10) / 10 : null;
  const edgeTone = pricedEdge == null || pricedEdge === 0 ? "default" : pricedEdge > 0 ? "positive" : "negative";
  const roiTone = s.roi == null || s.roi === 0 ? "default" : s.roi > 0 ? "positive" : "negative";

  return (
    <div className={`min-w-0 bg-white transition-opacity ${loading ? "opacity-55" : ""}`} aria-busy={loading}>
      <div className="grid gap-px bg-zinc-100 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <div className="bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full" style={{ background: total ? `conic-gradient(${gradient})` : "#f4f4f5" }} role="img" aria-label={`${s.wins} wins, ${s.losses} losses, ${s.draws} draws, ${s.ncs} no contests`}>
              <div className="grid h-[5.8rem] w-[5.8rem] place-items-center rounded-full bg-white text-center shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                <span><span className="block text-2xl font-semibold leading-none tabular-nums text-zinc-950">{formatValue(s.win_rate, "percent")}</span><span className="mt-1 block text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-400">win rate</span></span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-400">Combined record</div>
              <div className="mt-1 break-words text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
                <span className="text-emerald-700">{s.wins}</span><span className="text-zinc-300">–</span><span className="text-rose-700">{s.losses}</span>
                {s.draws ? <><span className="text-zinc-300">–</span><span className="text-amber-600">{s.draws}</span></> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-400">
                <span><strong className="font-semibold text-zinc-700">{compact(s.n)}</strong> fighter-bout observations</span>
                <span><strong className="font-semibold text-zinc-700">{compact(s.fights)}</strong> unique fights</span>
                {s.ncs ? <span><strong className="font-semibold text-zinc-700">{compact(s.ncs)}</strong> no contests</span> : null}
              </div>
              <p className="mt-3 max-w-2xl text-[10px] leading-4 text-zinc-400">Every completed UFC bout matching the conditions is included. If both fighters match, the bout contributes one observation to each side of the record.</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 bg-white sm:grid-cols-4 xl:grid-cols-2">
          <Metric label="Finish wins" value={formatValue(s.finish_rate, "percent")} note="share of wins" />
          <Metric label="R1 finishes" value={formatValue(s.r1_finish_rate, "percent")} note="share of wins" />
          <Metric label="Finished in losses" value={formatValue(s.finished_rate, "percent")} note="share of losses" />
          <Metric label="Inside distance" value={formatValue(s.stoppage_rate, "percent")} note="either fighter" />
          <Metric label="Avg fight time" value={formatValue(s.avg_seconds, "time")} note="all timed bouts" />
          <Metric label="Avg age" value={formatValue(s.avg_age, "years")} note="on fight night" />
          <Metric label="Fighters" value={compact(s.fighters)} note="unique athletes" />
          <Metric label="Stat sample" value={compact(s.stat_bouts)} note="official detail rows" />
        </div>
      </div>

      <div className="grid gap-px border-t border-zinc-100 bg-zinc-100 xl:grid-cols-2">
        <div className="grid gap-px bg-zinc-100 sm:grid-cols-2">
          <div className="bg-white"><MethodSide title="Winning methods" total={s.wins} data={winMethods} tone="win" /></div>
          <div className="bg-white"><MethodSide title="Losing methods" total={s.losses} data={lossMethods} tone="loss" /></div>
        </div>
        <div className="bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div><div className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">Market read</div><div className="mt-0.5 text-[10px] text-zinc-400">Closing prices, flat $100 stakes, vig included.</div></div>
            <div className="text-right text-[9px] tabular-nums text-zinc-400">{compact(s.priced)} priced</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
            <ValueBlock label="Actual win rate" value={s.priced_win_rate} format="percent" note="priced decisions only" />
            <ValueBlock label="Market implied" value={s.bet_avg_implied} format="percent" note="same priced sample" />
            <div className={`rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-3 ${edgeTone === "positive" ? "text-emerald-700" : edgeTone === "negative" ? "text-rose-700" : "text-zinc-950"}`}>
              <div className="text-[8px] font-bold uppercase tracking-[0.13em] text-zinc-400">Actual − market</div><div className="mt-1 text-lg font-semibold tabular-nums">{pricedEdge == null ? "—" : `${pricedEdge > 0 ? "+" : ""}${pricedEdge} pts`}</div><div className="mt-0.5 text-[9px] leading-3.5 text-zinc-400">directional edge</div>
            </div>
            <div className={`rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-3 ${roiTone === "positive" ? "text-emerald-700" : roiTone === "negative" ? "text-rose-700" : "text-zinc-950"}`}>
              <div className="text-[8px] font-bold uppercase tracking-[0.13em] text-zinc-400">Flat-stake ROI</div><div className="mt-1 text-lg font-semibold tabular-nums">{formatValue(s.roi, "percent")}</div><div className="mt-0.5 text-[9px] leading-3.5 text-zinc-400">{formatValue(s.profit, "currency")} over {compact(s.bets)} bets</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-px border-t border-zinc-100 bg-zinc-100 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="bg-white p-4">
          <div className="mb-3"><div className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">Fight shape</div><div className="mt-0.5 text-[10px] text-zinc-400">Rate statistics use every matching bout with official detail data.</div></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ValueBlock label="Sig. landed / min" value={s.sig_per_min} format="decimal" note="offensive pace" />
            <ValueBlock label="Sig. absorbed / min" value={s.sig_absorbed_per_min} format="decimal" note="opponent pace" />
            <ValueBlock label="Strike differential" value={s.sig_differential_per_min} format="signed" note="per minute" />
            <ValueBlock label="Control share" value={s.control_share} format="percent" note="of elapsed time" />
            <ValueBlock label="Takedowns / 15" value={s.td_per_15} format="decimal" note="landed" />
            <ValueBlock label="TD allowed / 15" value={s.td_taken_per_15} format="decimal" note="conceded" />
            <ValueBlock label="Knockdowns / 15" value={s.kd_per_15} format="decimal" note="scored" />
            <ValueBlock label="KD allowed / 15" value={s.kd_taken_per_15} format="decimal" note="absorbed" />
          </div>
        </div>
        <div className="bg-white p-4">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">Data coverage</div>
          <div className="mt-1 text-[10px] leading-4 text-zinc-400">A filter that needs missing data excludes that observation instead of guessing.</div>
          <div className="mt-4 space-y-4">
            <Coverage label="Fight-night age" known={s.age_known} total={s.n} color="#2563eb" />
            <Coverage label="Closing odds" known={s.priced} total={s.n} color="#7c3aed" />
            <Coverage label="Official fight stats" known={s.stat_bouts} total={s.n} color="#0f766e" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LabsPage() {
  const [state, setState] = useHistoryState<LabState>("labs:combined-record", DEFAULT_STATE);
  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("labs:page");
  const query = useMemo(() => toQuery(state.a.filters, "none"), [state.a.filters]);
  const { data, loading } = useApi<LabsResponse>(`/api/labs?${query}`);
  const [held, setHeld] = useState<LabsResponse | null>(null);

  useEffect(() => { if (data) setHeld(data); }, [data]);
  useSeo({
    title: "UFC Labs — Combined Record Research",
    description: "Build a UFC fight cohort from market role, layoffs, form, experience, opponent quality and matchup context, then inspect its complete combined record.",
    path: "/labs",
  });

  const result = data ?? held;
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const fighter of [...state.a.fighters, ...state.a.opponents]) map.set(fighter.id, fighter.name);
    return map;
  }, [state.a.fighters, state.a.opponents]);
  const chips = describeFilters(state.a.filters, names);
  const setPopulation = (population: Population) => setState({ a: population });
  const reset = () => setState({ a: emptyPopulation() });

  if (!result) return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Building the complete fight cohort…</div>;

  return (
    <div ref={pageScroll} className="h-full overflow-y-auto">
      <main className="mx-auto flex max-w-[100rem] flex-col gap-3 p-3 pb-10">
        <header className={`${PANEL} flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between`}>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400">UFC Labs · first instrument</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">Combined record of</h1>
            <p className="mt-1 text-[11px] text-zinc-400">One cohort, every matching completed fight, no comparison layer.</p>
          </div>
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <span className={`text-[10px] font-medium text-zinc-400 transition-opacity ${loading ? "opacity-100" : "opacity-0"}`} role="status">Updating…</span>
            <StatsModeSwitch />
          </div>
        </header>

        <section className={`${PANEL} overflow-hidden`} aria-label="Combined record research dashboard">
          <div className="border-b border-zinc-200 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.length ? chips.map((chip) => (
                <button key={chip.id} type="button" onClick={() => setPopulation({ ...state.a, filters: clearKeys(state.a.filters, chip.keys), fighters: chip.keys.includes("fighterIds") ? [] : state.a.fighters, opponents: chip.keys.includes("opponentIds") ? [] : state.a.opponents })} className="group flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-2.5 pr-1.5 text-[10px] font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-white" title={`Remove ${chip.label}`}>
                  {chip.label}<X className="h-2.5 w-2.5 text-zinc-300 transition group-hover:text-zinc-700" aria-hidden="true" />
                </button>
              )) : <span className="text-[10px] text-zinc-400">All fighters · all divisions · every completed UFC bout on record</span>}
              <span className="ml-auto text-[9px] tabular-nums text-zinc-400">{activeCount(state.a.filters)} active filters</span>
            </div>
          </div>
          <div className="grid min-w-0 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <FilterDeck population={state.a} divisions={result.divisions} years={result.years_available} onChange={setPopulation} onReset={reset} />
            <CombinedRecord data={result} loading={loading} />
          </div>
        </section>
      </main>
    </div>
  );
}

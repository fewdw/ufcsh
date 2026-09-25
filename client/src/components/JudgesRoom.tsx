import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Search } from "lucide-react";
import { useApi, type JudgeEvidenceBout, type JudgeEvidenceResponse, type JudgeExplorerOfficial, type LabsJudgesResponse } from "../api";
import { BarList, ChartCard, Legend, StatTile } from "./charts";
import { SERIES, compact, formatValue } from "./chartTokens";
import RequestNotice from "./RequestNotice";

const rate = (part: number, whole: number) => whole ? (part / whole) * 100 : null;
const percent = (value: number | null) => formatValue(value, "percent");
const selectClass = "rounded-lg border border-zinc-200 bg-white py-1 pl-2 pr-7 text-[10px] font-semibold text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400";
type View = "scorecards" | "judges";
type RoundScope = "all" | "3" | "5";
type JudgeMetric = "rogue" | "favorite" | "draw" | "wide" | "margin";
type Selection = { kind: "verdict" | "scoreline" | "official"; value: string; label: string };

const ROUND_TABS: { key: RoundScope; label: string }[] = [
  { key: "all", label: "All" }, { key: "3", label: "3 rounds" }, { key: "5", label: "5 rounds" },
];
const METRICS: { key: JudgeMetric; label: string; hint: string }[] = [
  { key: "rogue", label: "Rogue index", hint: "How often this judge was the lone card against two matching peers." },
  { key: "favorite", label: "Favorite lean", hint: "How often a decisive card backed the betting favorite when both closing prices were known." },
  { key: "draw", label: "Draw cards", hint: "How often this judge submitted an even final score." },
  { key: "wide", label: "Wide dissents", hint: "Among this judge’s lone dissenting cards, how many had a margin of at least three points." },
  { key: "margin", label: "Card margin", hint: "Average absolute point gap on this judge’s final cards." },
];
const FIGHT_SORTS = [
  { key: "recent", label: "Newest first" }, { key: "oldest", label: "Oldest first" },
  { key: "closest", label: "Closest cards" }, { key: "widest", label: "Widest disagreement" },
] as const;
const VERDICT_MARK: Record<string, string> = { unanimous: "UD", split: "SD", majority: "MD", draw: "D", incomplete: "—" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)} '${year.slice(2)}`;
};

function judgeReading(judge: JudgeExplorerOfficial, metric: JudgeMetric) {
  if (metric === "favorite") return { value: judge.favorite_pick_rate, denominator: judge.priced_picks, display: `${percent(judge.favorite_pick_rate)} favorite`, tip: [{ label: "cards for favorite", value: compact(judge.favorite_picks) }, { label: "decisive priced cards", value: compact(judge.priced_picks) }] };
  if (metric === "draw") return { value: judge.draw_rate, denominator: judge.cards, display: `${percent(judge.draw_rate)} draws`, tip: [{ label: "draw cards", value: compact(judge.draw_cards) }, { label: "all cards", value: compact(judge.cards) }] };
  if (metric === "wide") return { value: judge.wide_dissent_rate, denominator: judge.dissents, display: `${percent(judge.wide_dissent_rate)} wide`, tip: [{ label: "wide dissents (3+ points)", value: compact(judge.wide_dissents) }, { label: "close dissents (0–2 points)", value: compact(judge.close_dissents) }] };
  if (metric === "margin") return { value: judge.average_margin, denominator: judge.cards, display: `${formatValue(judge.average_margin, "decimal")} pt avg`, tip: [{ label: "average absolute margin", value: formatValue(judge.average_margin, "decimal") }, { label: "cards", value: compact(judge.cards) }] };
  return { value: judge.dissent_rate, denominator: judge.complete_cards, display: `${percent(judge.dissent_rate)} dissent`, tip: [{ label: "lone dissents", value: compact(judge.dissents) }, { label: "complete panels", value: compact(judge.complete_cards) }, { label: "agreement", value: percent(judge.dissent_rate == null ? null : 100 - judge.dissent_rate) }] };
}

function useJudgeFightFeed(studyQuery: string, rounds: RoundScope, selection: Selection | null, search: string, sort: string) {
  const url = selection ? `/api/labs/judge-bouts?${studyQuery}&judgeRounds=${rounds}&judgeKind=${selection.kind}&judgeValue=${encodeURIComponent(selection.value)}&q=${encodeURIComponent(search)}&sort=${sort}` : null;
  const [state, setState] = useState<{ url: string | null; rows: JudgeEvidenceBout[]; total: number }>({ url: null, rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const fetchPage = useCallback((feedUrl: string, offset: number) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(false);
    void fetch(`${feedUrl}&limit=60&offset=${offset}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<JudgeEvidenceResponse>; })
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((current) => offset === 0 ? { url: feedUrl, rows: page.rows, total: page.total } : current.url === feedUrl ? { ...current, rows: [...current.rows, ...page.rows], total: page.total } : current);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) { pending.current = null; setLoading(false); } });
  }, []);
  useEffect(() => {
    pending.current?.abort();
    setState({ url, rows: [], total: 0 });
    if (url) fetchPage(url, 0);
    return () => pending.current?.abort();
  }, [url, fetchPage]);
  const current = state.url === url ? state : { url, rows: [] as JudgeEvidenceBout[], total: 0 };
  const loadMore = useCallback(() => { if (url) fetchPage(url, current.rows.length); }, [url, fetchPage, current.rows.length]);
  return { ...current, loading, error, more: current.rows.length < current.total, loadMore };
}

function EvidenceRow({ bout, selection }: { bout: JudgeEvidenceBout; selection: Selection }) {
  return <li className="border-b border-zinc-100 px-4 py-2.5 last:border-b-0 hover:bg-zinc-50/70">
    <div className="flex min-w-0 items-baseline gap-2 text-[11px]">
      <span className="inline-grid h-5 min-w-7 shrink-0 place-items-center rounded-md bg-zinc-100 px-1 text-[9px] font-bold text-zinc-600 ring-1 ring-inset ring-zinc-200">{VERDICT_MARK[bout.verdict]}</span>
      <span className="min-w-0 truncate">
        <Link to={`/fighters/${bout.f1.id}`} className={`${bout.f1.outcome === "win" ? "font-semibold text-zinc-900" : "text-zinc-600"} hover:underline`}>{bout.f1.name}</Link>
        <span className="px-1 text-zinc-300">vs</span>
        <Link to={`/fighters/${bout.f2.id}`} className={`${bout.f2.outcome === "win" ? "font-semibold text-zinc-900" : "text-zinc-600"} hover:underline`}>{bout.f2.name}</Link>
      </span>
      <span className="ml-auto shrink-0 tabular-nums text-zinc-400">{shortDate(bout.date)}</span>
    </div>
    <div className="ml-9 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-zinc-500">
      {bout.cards.map((card, i) => <span key={`${i}-${card.judge}`} className={card.judge && selection.kind === "official" && selection.value === card.judge ? "font-semibold text-orange-600" : ""}>{card.judge || `Judge ${i + 1}`} <span className="tabular-nums text-zinc-800">{card.f1_score}–{card.f2_score}</span></span>)}
    </div>
    <div className="ml-9 mt-1 flex min-w-0 items-center gap-1.5 text-[9px] text-zinc-400">
      <span>{bout.division}</span><span>·</span>{bout.scheduled_rounds > 0 ? <><span>{bout.scheduled_rounds} round{bout.scheduled_rounds === 1 ? "" : "s"}</span><span>·</span></> : null}
      <Link to={`/fights/${bout.fight_id}`} className="truncate hover:text-zinc-900 hover:underline" title={bout.event_name}>{bout.event_name}</Link>
    </div>
  </li>;
}

function FightEvidence({ studyQuery, rounds, selection, onClear }: { studyQuery: string; rounds: RoundScope; selection: Selection | null; onClear: () => void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const settledSearch = useDeferredValue(search.trim());
  const feed = useJudgeFightFeed(studyQuery, rounds, selection, settledSearch, sort);
  const { error, loadMore, loading, more, rows, total } = feed;
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { setSearch(""); setSort("recent"); }, [selection, rounds, studyQuery]);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !more || loading || error) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore(); }, { root: scroller.current, rootMargin: "240px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, loading, error, rows.length, loadMore]);
  return <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
    <header className="border-b border-zinc-100 px-4 py-2">
      <div className="flex h-7 items-center gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold text-zinc-900">{selection?.label ?? "Fights"}</h3>
        {selection ? <span className="text-[10px] tabular-nums text-zinc-400">{compact(total)}</span> : null}
        <button type="button" onClick={onClear} disabled={!selection} className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 disabled:invisible"><RotateCcw className="h-3 w-3" /> Clear</button>
      </div>
      {selection ? <div className="mt-1 flex items-center gap-2">
        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Order scorecard fights" className={selectClass}>{FIGHT_SORTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
        <label className="relative ml-auto min-w-40 flex-1 sm:max-w-64"><Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" /><input type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fighters or events" aria-label="Search scorecard fights" className="w-full rounded-lg border border-zinc-200 py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400" /></label>
      </div> : null}
    </header>
    <div ref={scroller} className="h-80 overflow-y-auto">
      {!selection ? <p className="grid h-full place-items-center px-4 text-center text-[11px] text-zinc-400">Click any category to show its fights.</p> : null}
      {error ? <div className="p-3"><RequestNotice onRetry={loadMore}>Couldn’t load these fights.</RequestNotice></div> : null}
      {selection && !loading && !error && rows.length === 0 ? <p className="grid h-full place-items-center text-[11px] text-zinc-400">No matching fights.</p> : null}
      <ul>{selection ? rows.map((bout) => <EvidenceRow key={bout.fight_id} bout={bout} selection={selection} />) : null}</ul>
      <div ref={sentinel} className="py-3 text-center text-xs text-zinc-400">{loading ? "Loading…" : more ? `${compact(total - rows.length)} more` : rows.length ? "End of the list" : ""}</div>
    </div>
  </section>;
}

export default function JudgesRoom({ studyQuery }: { studyQuery: string }) {
  const [view, setView] = useState<View>("scorecards");
  const [rounds, setRounds] = useState<RoundScope>("3");
  const [metric, setMetric] = useState<JudgeMetric>("rogue");
  const [judgeSearch, setJudgeSearch] = useState("");
  const [scoreSearch, setScoreSearch] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const details = useApi<LabsJudgesResponse>(`/api/labs/judges?${studyQuery}&judgeRounds=${rounds}`);
  const j = details.data;
  useEffect(() => { setSelection(null); }, [studyQuery, rounds, view]);
  const judges = useMemo(() => {
    if (!j) return [];
    const q = judgeSearch.trim().toLocaleLowerCase();
    return j.officials.filter((judge) => !q || judge.label.toLocaleLowerCase().includes(q)).map((judge) => ({ judge, reading: judgeReading(judge, metric) })).sort((a, b) => {
      const aEnough = a.reading.denominator >= 10 ? 1 : 0;
      const bEnough = b.reading.denominator >= 10 ? 1 : 0;
      return bEnough - aEnough || (b.reading.value ?? -1) - (a.reading.value ?? -1) || b.reading.denominator - a.reading.denominator || a.judge.label.localeCompare(b.judge.label);
    });
  }, [j, judgeSearch, metric]);
  if (!j) return <p className="px-4 py-10 text-center text-[11px] text-zinc-400" role="status">{details.error ? "Couldn’t read the scorecards." : "Reading the scorecards…"}</p>;

  const divided = j.verdicts.split + j.verdicts.majority;
  const verdicts = [
    { key: "unanimous", label: "Unanimous", n: j.verdicts.unanimous }, { key: "split", label: "Split", n: j.verdicts.split },
    { key: "majority", label: "Majority", n: j.verdicts.majority }, { key: "draw", label: "Drawn panel", n: j.verdicts.drawn },
    { key: "incomplete", label: "Incomplete card", n: j.verdicts.incomplete },
  ].filter((row) => row.n > 0);
  const scoreQuery = scoreSearch.trim().replace(/-/g, "–").toLocaleLowerCase();
  const scorelines = j.scorelines.filter((score) => !scoreQuery || score.label.toLocaleLowerCase().includes(scoreQuery));
  const selectedMetric = METRICS.find((item) => item.key === metric)!;

  return <div className="grid min-w-0 grid-cols-1 gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="tablist" aria-label="Judges room view">
        {(["scorecards", "judges"] as View[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={view === tab} onClick={() => setView(tab)} className={`rounded-md px-3 py-1.5 text-[10px] font-bold capitalize transition ${view === tab ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"}`}>{tab}</button>)}
      </div>
      <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Scheduled fight length">
        {ROUND_TABS.map((tab) => <button key={tab.key} type="button" aria-pressed={rounds === tab.key} onClick={() => setRounds(tab.key)} className={`rounded-md px-3 py-1.5 text-[10px] font-bold transition ${rounds === tab.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"}`}>{tab.label}</button>)}
      </div>
    </div>

    {view === "scorecards" ? <ScorecardsView j={j} rounds={rounds} verdicts={verdicts} scorelines={scorelines} scoreSearch={scoreSearch} setScoreSearch={setScoreSearch} selection={selection} setSelection={setSelection} divided={divided} />
      : <JudgesView j={j} metric={metric} setMetric={setMetric} judges={judges} judgeSearch={judgeSearch} setJudgeSearch={setJudgeSearch} selection={selection} setSelection={setSelection} selectedMetric={selectedMetric} />}
    <FightEvidence studyQuery={studyQuery} rounds={rounds} selection={selection} onClear={() => setSelection(null)} />
  </div>;
}

type Scoreline = LabsJudgesResponse["scorelines"][number];
function ScorecardsView({ j, rounds, verdicts, scorelines, scoreSearch, setScoreSearch, selection, setSelection, divided }: { j: LabsJudgesResponse; rounds: RoundScope; verdicts: { key: string; label: string; n: number }[]; scorelines: Scoreline[]; scoreSearch: string; setScoreSearch: (value: string) => void; selection: Selection | null; setSelection: (value: Selection) => void; divided: number }) {
  return <>
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100 sm:grid-cols-4">
      <div className="bg-white"><StatTile label="Fights ending in decision" value={percent(rate(j.decision_bouts, j.bouts))} note={`${compact(j.decision_bouts)} of ${compact(j.bouts)} fights`} /></div>
      <div className="bg-white"><StatTile label="All three agreed" value={percent(rate(j.verdicts.unanimous, j.scored_bouts))} note={`${compact(j.verdicts.unanimous)} decisions`} emphasis /></div>
      <div className="bg-white"><StatTile label="Judges disagreed" value={percent(rate(divided, j.scored_bouts))} note={`${compact(j.verdicts.split)} split · ${compact(j.verdicts.majority)} majority`} /></div>
      <div className="bg-white"><StatTile label="Winner landed less" value={percent(rate(j.against_the_numbers, j.against_the_numbers_known))} note={`${compact(j.against_the_numbers)} of ${compact(j.against_the_numbers_known)} known`} /></div>
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
      <ChartCard title="How the decisions were called" subtitle={`${rounds === "all" ? "All scheduled lengths" : `${rounds}-round fights`} · click a result to see its fights`}>
        <BarList format="percent" data={verdicts.map((row) => ({ key: row.key, label: row.label, value: rate(row.n, j.scored_bouts), displayValue: `${compact(row.n)} decisions · ${percent(rate(row.n, j.scored_bouts))}`, selected: selection?.kind === "verdict" && selection.value === row.key, onSelect: () => setSelection({ kind: "verdict", value: row.key, label: `${row.label} decisions` }), tip: [{ label: "decisions", value: compact(row.n) }, { label: "of scored decisions", value: percent(rate(row.n, j.scored_bouts)), color: SERIES[0] }] }))} />
      </ChartCard>
      <ChartCard title="The cards they wrote" subtitle={`Every final score · ${compact(j.cards)} cards · click a score to see its fights`} legend={<Legend items={[{ label: "Share of cards", color: SERIES[0], shape: "line" }]} />}>
        <div className="border-b border-zinc-100 px-3 py-2"><label className="relative block"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" /><input type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={scoreSearch} onChange={(event) => setScoreSearch(event.target.value)} placeholder="Find a score, e.g. 50–45" aria-label="Search final scores" className="w-full rounded-lg border border-zinc-200 py-2 pl-8 pr-3 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400" /></label></div>
        <BarList format="percent" height={320} data={scorelines.map((score) => ({ key: score.key, label: score.label, value: score.share, displayValue: `${compact(score.n)} cards · ${percent(score.share)}`, selected: selection?.kind === "scoreline" && selection.value === score.key, onSelect: () => setSelection({ kind: "scoreline", value: score.key, label: `${score.label} scorecards` }), tip: [{ label: "cards", value: compact(score.n) }, { label: "of all cards", value: percent(score.share), color: SERIES[0] }] }))} />
      </ChartCard>
    </div>
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100">
      <div className="bg-white"><StatTile label="Favorite won split" value={percent(rate(j.signals.split_favorite_wins, j.signals.split_favorite_known))} note={`${compact(j.signals.split_favorite_wins)} of ${compact(j.signals.split_favorite_known)} priced splits`} /></div>
      <div className="bg-white"><StatTile label="Champion won split" value={percent(rate(j.signals.split_champion_wins, j.signals.split_champion_known))} note={`${compact(j.signals.split_champion_wins)} of ${compact(j.signals.split_champion_known)} champion splits`} /></div>
      <div className="bg-white"><StatTile label="Polar-opposite panels" value={compact(j.signals.polar_opposites)} note="Wide cards for opposite fighters" /></div>
    </div>
  </>;
}

type JudgeRow = { judge: JudgeExplorerOfficial; reading: ReturnType<typeof judgeReading> };
function JudgesView({ j, metric, setMetric, judges, judgeSearch, setJudgeSearch, selection, setSelection, selectedMetric }: { j: LabsJudgesResponse; metric: JudgeMetric; setMetric: (value: JudgeMetric) => void; judges: JudgeRow[]; judgeSearch: string; setJudgeSearch: (value: string) => void; selection: Selection | null; setSelection: (value: Selection) => void; selectedMetric: (typeof METRICS)[number] }) {
  return <ChartCard title="Judge tendencies" subtitle={`${selectedMetric.hint} Click a judge to see every fight they scored.`}>
    <div className="border-b border-zinc-100 px-3 py-2"><div className="flex flex-wrap gap-1">{METRICS.map((item) => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => setMetric(item.key)} className={`rounded-full border px-2.5 py-1 text-[9px] font-bold transition ${metric === item.key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400"}`}>{item.label}</button>)}</div><label className="relative mt-2 block"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" /><input type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={judgeSearch} onChange={(event) => setJudgeSearch(event.target.value)} placeholder={`Search all ${j.officials.length} judges`} aria-label="Search judges" className="w-full rounded-lg border border-zinc-200 py-2 pl-8 pr-3 text-xs outline-none placeholder:text-zinc-400 focus:border-zinc-400" /></label></div>
    <BarList format={metric === "margin" ? "decimal" : "percent"} minSample={10} height={380} data={judges.map(({ judge, reading }) => ({ key: judge.key, label: judge.label, value: reading.value, displayValue: reading.display, n: reading.denominator, selected: selection?.kind === "official" && selection.value === judge.key, onSelect: () => setSelection({ kind: "official", value: judge.key, label: judge.label }), tip: [{ label: selectedMetric.label.toLocaleLowerCase(), value: metric === "margin" ? formatValue(reading.value, "decimal") : percent(reading.value), color: SERIES[0] }, ...reading.tip] }))} />
    <p className="px-4 pb-3 text-[10px] leading-4 text-zinc-500">Patterns flag judges worth examining; they do not prove corruption. Assignment mix, eras, fight length and small samples all matter.</p>
  </ChartCard>;
}

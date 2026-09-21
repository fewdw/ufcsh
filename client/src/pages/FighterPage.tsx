import { Children, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api";
import type { CompleteRecordBefore, FighterProfile, FighterRecord, FighterStat, HistoryRow, ProfessionalHistoryRow } from "../api";
import { formatDateShortWithYear, formatLine, formatMethod, lastName } from "../format";
import { formatValue } from "../components/chartTokens";
import FighterPortrait from "../components/FighterPortrait";
import Flag from "../components/Flag";
import ResultDots from "../components/ResultDots";
import WeightJourney, { WeightChangeMarker } from "../components/WeightJourney";
import { weightJourney } from "../weightJourney";
import RequestNotice from "../components/RequestNotice";
import { useSeo } from "../seo";
import { useRouteScrollRestoration } from "../navigationState";
import { outsideFighterUrl, useSettings, withRanking } from "../settings";

const shell = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

function historyResultLabel(outcome: HistoryRow["outcome"]): string {
  switch (outcome) {
    case "win": return "Win";
    case "loss": return "Loss";
    case "draw": return "Draw";
    case "nc": return "No Contest";
    default: return "RESULT";
  }
}

/** The result, compressed to one letter in a small solid dot — a full "WIN"/
 *  "LOSS" word is legible from across the room this list doesn't need to be
 *  read from. The word itself survives for a screen reader and as a tooltip. */
function resultBadgeLetter(outcome: HistoryRow["outcome"], upcoming: boolean): string {
  if (upcoming) return "?";
  switch (outcome) {
    case "win": return "W";
    case "loss": return "L";
    case "draw": return "D";
    case "nc": return "NC";
    default: return "?";
  }
}

function resultBadgeClasses(outcome: HistoryRow["outcome"], upcoming: boolean): string {
  if (upcoming) return "bg-sky-100 text-sky-700";
  switch (outcome) {
    case "win": return "bg-emerald-500 text-white";
    case "loss": return "bg-rose-500 text-white";
    case "draw": return "bg-amber-400 text-white";
    case "nc": return "bg-zinc-300 text-zinc-700";
    default: return "bg-zinc-200 text-zinc-500";
  }
}

function OpponentForm({ form }: { form: NonNullable<HistoryRow["opponent_form"]> }) {
  if (!form.length) return null;
  return <ResultDots results={form} label="Last five professional bouts entering this fight" />;
}

/** One record as a wheel: wins counterclockwise from 12, losses clockwise, with
 *  the method split listed beside it. */
function RecordWheel({ history, scope, record }: { history: (HistoryRow | ProfessionalHistoryRow)[]; scope: "ufc" | "all"; record: string }) {
  const bouts = history.filter((fight) => !fight.upcoming && fight.outcome !== null);
  const methodGroup = (method: string | null) => {
    const normalized = method?.trim().toUpperCase() ?? "";
    if (normalized === "KO/TKO" || /^(?:KO|K\.O\.?|TKO)(?:\s|\(|$)/.test(normalized)) return "KO/TKO";
    if (normalized === "SUB" || /^(?:TECH(?:NICAL|INAL)\s+)?SUBMISSION(?:\s|$)/.test(normalized)) return "SUB";
    if (normalized.endsWith("-DEC") || /^(?:TECHNICAL\s+)?DECISION(?:\s|$)/.test(normalized)) return "DEC";
    return "OTHER";
  };
  const winDefinitions = [
    { key: "win-KO/TKO", label: "KO/TKO", color: "#047857", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "win" && methodGroup(fight.method) === "KO/TKO" },
    { key: "win-SUB", label: "SUB", color: "#34d399", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "win" && methodGroup(fight.method) === "SUB" },
    { key: "win-DEC", label: "DEC", color: "#a7f3d0", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "win" && methodGroup(fight.method) === "DEC" },
  ];
  const lossDefinitions = [
    { key: "loss-KO/TKO", label: "KO/TKO", color: "#be123c", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "loss" && methodGroup(fight.method) === "KO/TKO" },
    { key: "loss-SUB", label: "SUB", color: "#fb7185", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "loss" && methodGroup(fight.method) === "SUB" },
    { key: "loss-DEC", label: "DEC", color: "#fecdd3", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "loss" && methodGroup(fight.method) === "DEC" },
  ];
  const otherDefinitions = [
    { key: "loss-OTHER", label: "Other", color: "#fda4af", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "loss" && methodGroup(fight.method) === "OTHER" },
    { key: "win-OTHER", label: "Other", color: "#6ee7b7", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "win" && methodGroup(fight.method) === "OTHER" },
  ];
  const extraDefinitions = [
    { key: "draw", label: "Draws", color: "#f59e0b", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "draw" },
    { key: "nc", label: "No contests", color: "#71717a", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "nc" },
  ];
  const count = <T extends { match: (fight: HistoryRow | ProfessionalHistoryRow) => boolean }>(definitions: T[]) =>
    definitions.map((definition) => ({ ...definition, count: bouts.filter(definition.match).length }));
  const wins = count(winDefinitions);
  const losses = count(lossDefinitions);
  const [otherLosses, otherWins] = count(otherDefinitions);
  const extras = count(extraDefinitions);
  const winRows = otherWins.count ? [...wins, otherWins] : wins;
  const lossRows = otherLosses.count ? [...losses, otherLosses] : losses;
  // CSS conic gradients advance clockwise. Losses begin at 12 o'clock and run
  // clockwise. Wins are placed in reverse at the end, so reading counterclockwise
  // from 12 gives KO/TKO, SUB, DEC, then Other.
  const segments = [...lossRows, ...extras, ...[...winRows].reverse()].filter((segment) => segment.count > 0);
  let position = 0;
  const gradient = segments.map((segment) => {
    const start = position;
    position += bouts.length ? (segment.count / bouts.length) * 100 : 0;
    return `${segment.color} ${start}% ${position}%`;
  }).join(", ");

  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div className="text-sm font-semibold tabular-nums text-zinc-900" title={scope === "ufc" ? "Current UFC-only record" : "Current verified complete professional record"}>
        <span className="text-[10px] font-bold text-zinc-400">{scope === "ufc" ? "UFC" : "PRO"}</span> {record}
      </div>
      {bouts.length ? <div className="flex items-center gap-3">
        <div
          className="grid h-20 w-20 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(from 0deg, ${gradient})` }}
          role="img"
          aria-label={`${bouts.length} ${scope === "ufc" ? "UFC" : "professional"} bouts by result and method`}
        >
          <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-center shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
            <span className="text-sm font-semibold tabular-nums text-zinc-900">{bouts.length}<span className="block text-[8px] font-bold uppercase tracking-wider text-zinc-400">{scope === "ufc" ? "UFC" : "PRO"}</span></span>
          </div>
        </div>
        <div>
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-emerald-700">
                Wins ({winRows.reduce((total, segment) => total + segment.count, 0)})
              </div>
              {winRows.map((segment) => (
                <div key={segment.key} className="flex items-center gap-1.5 text-[9px] leading-4 text-zinc-500">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} />
                  <span className="whitespace-nowrap"><strong className="font-semibold text-zinc-700">{segment.count}</strong> {segment.label}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-rose-700">
                Losses ({lossRows.reduce((total, segment) => total + segment.count, 0)})
              </div>
              {lossRows.map((segment) => (
                <div key={segment.key} className="flex items-center gap-1.5 text-[9px] leading-4 text-zinc-500">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} />
                  <span className="whitespace-nowrap"><strong className="font-semibold text-zinc-700">{segment.count}</strong> {segment.label}</span>
                </div>
              ))}
            </div>
          </div>
          {extras.some((segment) => segment.count > 0) ? (
            <div className="mt-1.5 flex gap-3 border-t border-zinc-100 pt-1.5">
              {extras.filter((segment) => segment.count > 0).map((segment) => (
                <div key={segment.key} className="flex items-center gap-1.5 text-[9px] text-zinc-500">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: segment.color }} />
                  <span>{segment.count} {segment.label}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div> : null}
    </div>
  );
}

function EnteringRecords({
  career,
  ufc,
  name,
  className = "",
}: {
  career: CompleteRecordBefore | null | undefined;
  ufc: HistoryRow["record_before"];
  name: string;
  className?: string;
}) {
  if (!career && !ufc) return null;
  return (
    <span
      className={`flex min-w-0 flex-wrap gap-x-2 tabular-nums ${className}`}
      title={`${name}'s records entering this fight${career ? " from verified complete professional history" : ""}`}
    >
      <span className={career ? "" : "text-zinc-400"}><span className="font-bold text-zinc-400">REC</span> {career?.text ?? "—"}</span>
      <span className={ufc ? "" : "text-zinc-400"}><span className="font-bold text-zinc-400">UFC</span> {ufc?.text ?? "—"}</span>
    </span>
  );
}

const PERF_AWARD = {
  perf: { short: "Perf. of the Night", full: "Performance of the Night" },
  ko: { short: "KO of the Night", full: "Knockout of the Night" },
  sub: { short: "Sub of the Night", full: "Submission of the Night" },
} as const;
const TAG = "inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold leading-4";

/** Rows of bouts. A container, not a viewport breakpoint: this list shares the
 *  page with a second column from `lg` up, so how much room a bout actually has
 *  is not something the window width can answer. The divider carries more of
 *  the load at card width, where it is the only line marking where one ends. */
const BOUT_LIST = "@container divide-y divide-zinc-100 pb-2 @3xl:divide-zinc-50";

/** What the bout's result line does not say: awards this fighter took home and
 * whoever came in over the limit. Each tag spells its meaning out in words. */
function BoutNotes({ row, className = "mt-1" }: { row: HistoryRow | ProfessionalHistoryRow; className?: string }) {
  const perf = row.bonuses?.perf ? PERF_AWARD[row.bonuses.perf] : null;
  const misses = [
    { who: "Missed weight", name: "This fighter", pounds: row.weight_miss?.fighter },
    { who: `${lastName(row.opponent.name)} missed weight`, name: row.opponent.name, pounds: row.weight_miss?.opponent },
  ].filter((miss) => miss.pounds != null);
  if (!perf && !row.bonuses?.fotn && !misses.length) return null;
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {row.bonuses?.fotn ? <span className={`${TAG} bg-orange-50 text-orange-700`} title="Fight of the Night bonus"><span aria-hidden="true">🔥</span>Fight of the Night</span> : null}
      {perf ? <span className={`${TAG} bg-amber-50 text-amber-800`} title={`${perf.full} bonus`}><span aria-hidden="true">💰</span>{perf.short}</span> : null}
      {misses.map((miss) => (
        <span key={miss.who} className={`${TAG} bg-rose-50 text-rose-700`} title={`${miss.name} missed weight${miss.pounds ? ` at ${miss.pounds} lb` : ""}`}>
          <span aria-hidden="true">⚖️</span>{miss.who}{miss.pounds ? ` · ${miss.pounds} lb` : ""}
        </span>
      ))}
    </span>
  );
}

/** The three places a bout can lead: its matchup, the opponent's profile, the
 *  event. Each falls back to an outside source when this promotion is not one
 *  the site holds, and to plain text when there is nowhere to go — the same
 *  ladder in both shapes of the row below, so it lives in one place. */
function BoutLink({ to, href, label, className, children }: {
  to?: string | null;
  href?: string | null;
  label: string;
  className: string;
  children: ReactNode;
}) {
  if (to) return <Link to={to} aria-label={label} className={className}>{children}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" aria-label={label} className={className}>{children}</a>;
  return <div className={className}>{children}</div>;
}

/** A run of facts, middot-separated, that wraps onto as many lines as the width
 *  it is given needs. Each separator trails its own fact and is tied to the word
 *  before it by a non-breaking space, so the run breaks between facts — or
 *  inside a long one, like a submission spelled out in full — but never leaves a
 *  dot to open a line. Facts shrink below their content width so that long one
 *  wraps instead of running off the side of a phone. */
function FactRun({ children, className = "" }: { children: ReactNode; className?: string }) {
  // Children.toArray drops the nulls a conditional fact leaves behind, so the
  // separators land between the facts that actually rendered, and the last fact
  // in the run knows it is last.
  const facts = Children.toArray(children);
  return (
    <>
      {facts.map((fact, index) => (
        <span key={index} className={`min-w-0 ${className}`}>
          {fact}
          {index < facts.length - 1 ? <span className="pr-1.5 text-zinc-300" aria-hidden="true">{"\u00A0·"}</span> : null}
        </span>
      ))}
    </>
  );
}

/** Everything both shapes of a bout row read off the record, resolved once. */
function boutFields(row: HistoryRow | ProfessionalHistoryRow) {
  const outside = row.promotion === "outside";
  return {
    result: row.upcoming ? "Upcoming" : historyResultLabel(row.outcome),
    method: (row.upcoming ? "Scheduled" : formatMethod(row.method, row.round, row.time)) || "Result pending",
    fighterOdds: formatLine(row.closing_odds?.fighter),
    opponentOdds: formatLine(row.closing_odds?.opponent),
    outside,
    fightTo: row.fight_id ? `/fights/${row.fight_id}` : null,
    fightHref: "source_url" in row ? row.source_url : null,
    opponentTo: row.opponent.id ? `/fighters/${row.opponent.id}` : null,
    opponentHref: outside && "source_url" in row.opponent
      ? outsideFighterUrl(row.opponent.name, row.opponent.source_url ?? null)
      : "source_url" in row.opponent ? row.opponent.source_url : null,
    eventTo: row.event_id ? `/events/${row.event_id}` : null,
    eventHref: "event_url" in row ? row.event_url : null,
    narrativeClass: row.title_type === "interim" ? "text-belt-interim" : row.title_type === "title" ? "text-belt" : "text-zinc-500",
  };
}

const HIT = "transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

/**
 * A bout at reading width: three lines beside the result badge — who, how it
 * went, and where. The four columns of the table below carry the same facts
 * spread across 46rem, which is more width than a phone has; stacking those
 * columns instead gave a bout the height of half a screen, so this packs them
 * into runs separated by middots, the way every other compact row in the app
 * reads. The records each fighter carried in stay behind the table, the one
 * place there is room for them.
 */
function BoutCard({ row, fighterName }: { row: HistoryRow | ProfessionalHistoryRow; fighterName: string }) {
  const bout = boutFields(row);
  return (
    <div className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 px-4 py-2.5 @3xl:hidden`}>
      <span
        className={`col-start-1 row-start-1 grid h-6 min-w-6 shrink-0 place-items-center self-center rounded-full px-1 text-[10px] font-bold leading-none ${resultBadgeClasses(row.outcome, row.upcoming)}`}
        title={bout.result}
        aria-hidden="true"
      >
        {resultBadgeLetter(row.outcome, row.upcoming)}
      </span>

      <BoutLink
        to={bout.opponentTo}
        href={bout.opponentHref}
        label={`Open ${row.opponent.name} profile`}
        className={`col-start-2 row-start-1 -mx-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-1 py-0.5 ${HIT}`}
      >
        <span className="min-w-0 break-words text-[13px] font-semibold leading-5 text-zinc-900">{row.opponent.name}</span>
        {/* Both closing lines are here, and position is what says whose is
            whose: the opponent's sits against their name, the fighter's on the
            line about their own result. Neither number can be read off as the
            other's, so each also carries the name in a tooltip and spells the
            whole thing out for a screen reader. */}
        {bout.opponentOdds ? (
          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-zinc-400" title={`${row.opponent.name} closing odds`}>
            <span className="sr-only">{row.opponent.name} closing odds </span>{bout.opponentOdds}
          </span>
        ) : null}
        {row.opponent_form ? <OpponentForm form={row.opponent_form} /> : null}
      </BoutLink>

      <BoutLink
        to={bout.fightTo}
        href={bout.fightHref}
        label={`Open ${row.opponent.name} matchup`}
        className={`col-start-2 -mx-1 flex min-w-0 flex-wrap items-center rounded px-1 py-0.5 text-[11px] leading-4 text-zinc-500 ${HIT}`}
      >
        <span className="sr-only">{bout.result}</span>
        <FactRun>
          <span className="font-medium">{bout.method}</span>
          {bout.outside ? <span className="font-semibold text-violet-500">Outside UFC</span> : <span>{row.weight_class}</span>}
          {row.title_narrative ? <span className={`font-semibold ${bout.narrativeClass}`}>{row.title_narrative}</span> : null}
        </FactRun>
        {/* Out of the run and against the right edge, where it lines up with
            the date below and with every other price down the list — and where
            a long run wrapping cannot strand it alone on a line of its own. */}
        {bout.fighterOdds ? (
          <span className="ml-auto shrink-0 pl-2 font-semibold tabular-nums text-zinc-400" title={`${fighterName} closing odds`}>
            <span className="sr-only">{fighterName} closing odds </span>{bout.fighterOdds}
          </span>
        ) : null}
      </BoutLink>

      <BoutLink
        to={bout.eventTo}
        href={bout.eventHref}
        label={`Open ${row.event_name}`}
        className={`col-start-2 -mx-1 flex min-w-0 items-baseline gap-x-2 rounded px-1 py-0.5 ${HIT}`}
      >
        {/* The name takes the slack, so every date in the list lands on the
            same right edge and the column of dates can be read straight down. */}
        <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-zinc-600">{row.event_name}</span>
        <span className="shrink-0 text-[10px] leading-4 tabular-nums text-zinc-400">{formatDateShortWithYear(row.date)}</span>
      </BoutLink>

      <BoutNotes row={row} className="col-start-2 mt-1.5" />
    </div>
  );
}

/** The same bout as a row of four columns, once the list is wider than the
 *  46rem they need. Each column is its own hit target, as the card's lines are. */
function BoutTableRow({ row, fighterName }: { row: HistoryRow | ProfessionalHistoryRow; fighterName: string }) {
  const bout = boutFields(row);
  const cell = "hidden min-w-0 px-3 py-2.5 @3xl:flex";
  return (
    <>
      <BoutLink
        to={bout.fightTo}
        href={bout.fightHref}
        label={`Open ${row.opponent.name} matchup`}
        className={`${cell} items-start ${HIT}`}
      >
        <span className="flex w-full min-w-0 items-center gap-2.5">
          <span
            className={`grid h-7 min-w-7 shrink-0 place-items-center self-center rounded-full px-1 text-[11px] font-bold leading-none ${resultBadgeClasses(row.outcome, row.upcoming)}`}
            title={bout.result}
            aria-hidden="true"
          >
            {resultBadgeLetter(row.outcome, row.upcoming)}
          </span>
          <span className="sr-only">{bout.result}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="min-w-0 flex-1 text-[11px] font-medium leading-5 text-zinc-500 [overflow-wrap:anywhere]">{bout.method}</span>
              {bout.fighterOdds ? <span className="shrink-0 text-[10px] font-semibold tabular-nums text-zinc-400" title={`${fighterName} closing odds`}>{bout.fighterOdds}</span> : null}
            </span>
            <EnteringRecords career={row.career_record_before} ufc={row.record_before} name={fighterName} className="mt-0.5 w-full text-[10px] font-medium leading-4 text-zinc-400" />
          </span>
        </span>
      </BoutLink>

      <BoutLink
        to={bout.opponentTo}
        href={bout.opponentHref}
        label={`Open ${row.opponent.name} profile`}
        className={`${cell} items-start gap-2.5 ${HIT}`}
      >
        <span className="block min-w-0">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 break-words text-sm font-semibold leading-5 text-zinc-900">{row.opponent.name}</span>
            {bout.opponentOdds ? <span className="shrink-0 text-[10px] font-semibold tabular-nums text-zinc-400" title={`${row.opponent.name} closing odds`}>{bout.opponentOdds}</span> : null}
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <EnteringRecords career={row.opponent_career_record_before} ufc={row.opponent_record_before} name={row.opponent.name} className="text-[10px] font-semibold leading-4 text-zinc-500" />
            {row.opponent_form ? <OpponentForm form={row.opponent_form} /> : null}
          </span>
          <BoutNotes row={row} />
        </span>
      </BoutLink>

      <div className={`${cell} flex-col justify-start border-l border-zinc-100 text-left`}>
        <span className="block break-words text-[11px] leading-5 text-zinc-500">
          {bout.outside ? <span className="font-semibold text-violet-500">Outside UFC</span> : row.weight_class}
          {row.title_narrative ? <span className={`block font-semibold leading-4 ${bout.narrativeClass}`}>{row.title_narrative}</span> : null}
        </span>
      </div>

      <BoutLink
        to={bout.eventTo}
        href={bout.eventHref}
        label={`Open ${row.event_name}`}
        className={`${cell} flex-col justify-start border-l border-zinc-100 text-right ${HIT}`}
      >
        <span className="block text-xs font-medium leading-5 text-zinc-600">{row.event_name}</span>
        <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-400">{formatDateShortWithYear(row.date)}</span>
      </BoutLink>
    </>
  );
}

/**
 * One bout, in whichever shape the list it sits in has room for. Both are
 * always rendered and one is always `display: none`, which keeps it out of the
 * accessibility tree as well as off the screen — so a reader meets exactly one
 * copy of the bout, and neither shape has to bend its markup to serve the other.
 */
function HistoryRowView({ row, fighterName }: { row: HistoryRow | ProfessionalHistoryRow; fighterName: string }) {
  return (
    // The four tracks need 43rem between them, so the table waits for @3xl's
    // 48rem rather than a window width — which is what it used to key off, and
    // why it appeared at 40rem and ran straight out of the card. The result
    // track is sized to hold "KO/TKO · R5 · 1:32" and a four-figure price on
    // one line at that narrowest width, since it is the first thing read.
    <div className="grid grid-cols-1 items-stretch @3xl:grid-cols-[13rem_minmax(11rem,1.1fr)_7rem_minmax(12rem,1.3fr)]">
      <BoutCard row={row} fighterName={fighterName} />
      <BoutTableRow row={row} fighterName={fighterName} />
    </div>
  );
}

/**
 * Where this fighter stands at the top of the sport. Only places worth calling
 * a record appear: a top-five finish across the whole promotion, or a top-three
 * one inside their own division when the division is deep enough for that to
 * mean something. The list is recomputed from the fight records themselves, so
 * it moves the night someone passes them.
 */
function Records({ records }: { records: FighterRecord[] }) {
  if (!records.length) return null;
  const place = (record: FighterRecord) => `${record.tied ? "T" : ""}${record.rank}`;
  return (
    <section className={shell}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pb-2 pt-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Records</span>
      </div>
      <div className="divide-y divide-zinc-50 pb-2">
        {records.map((record) => (
          <div key={record.key} className="flex items-center gap-3 px-4 py-2">
            <span
              className={`grid h-8 w-10 shrink-0 place-items-center rounded-lg text-xs font-bold tabular-nums ${
                record.rank === 1
                  ? "bg-amber-100 text-belt ring-1 ring-inset ring-amber-200"
                  : record.rank <= 3
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600"
              }`}
              title={`${place(record)} of ${record.field.toLocaleString("en-US")} fighters who qualify`}
            >
              {place(record)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight text-zinc-900">{record.label}</span>
              <span className="mt-0.5 block text-[11px] leading-tight text-zinc-400">
                {record.scope} · {record.detail}
              </span>
            </span>
            <span className="shrink-0 text-right text-base font-semibold tabular-nums text-zinc-950">
              {formatValue(record.value, record.format)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Every qualifying top-50 placement, grouped so alternate readings such as
 * a method's count and percentage stay together instead of repeating panels. */
function StatisticalRanks({ stats }: { stats: FighterStat[] }) {
  // Collapsed by default; the visitor's choice carries over to every profile.
  const { settings, update } = useSettings();
  if (!stats.length) return null;
  const groups = [...stats.reduce((map, stat) => {
    const current = map.get(stat.category) ?? { order: stat.category_order, rows: [] as FighterStat[] };
    current.rows.push(stat);
    map.set(stat.category, current);
    return map;
  }, new Map<string, { order: number; rows: FighterStat[] }>())]
    .sort((a, b) => a[1].order - b[1].order);
  const place = (stat: FighterStat) => `${stat.tied ? "T" : ""}${stat.rank}`;

  return (
    <details
      open={settings.topStatsOpen}
      onToggle={(event) => update("topStatsOpen", (event.target as HTMLDetailsElement).open)}
      className={`${shell} group @container overflow-hidden`}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden"
        title="Expand top-50 statistics"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Top-50 statistics</span>
          <span className="mt-0.5 block text-[10px] text-zinc-400">
            {stats.length} {stats.length === 1 ? "placement" : "placements"} across {groups.length} {groups.length === 1 ? "category" : "categories"}
          </span>
        </span>
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 12 12"
        >
          <path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="columns-1 gap-0 border-t border-zinc-100 @[36rem]:columns-2" style={{ columnRule: "1px solid var(--color-plot-axis)" }}>
        {groups.map(([category, group]) => (
          <section key={category} className="break-inside-avoid min-w-0 border-b border-zinc-100 bg-white px-4 py-3">
            <h3 className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">{category}</h3>
            <div className="divide-y divide-zinc-50">
              {group.rows.map((stat) => (
                <div key={stat.key} className="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span
                    className={`grid h-6 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold tabular-nums ${
                      stat.rank <= 10 ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
                    }`}
                    title={`${place(stat)} of ${stat.field.toLocaleString("en-US")} qualifying fighters`}
                  >
                    {place(stat)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold leading-4 text-zinc-800">{stat.label}</span>
                    <span className="block truncate text-[9px] leading-3.5 text-zinc-400" title={`${stat.scope} · ${stat.detail}`}>
                      {stat.scope} · {stat.detail}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-900">
                    {formatValue(stat.value, stat.format)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

export default function FighterPage() {
  const { fighterId } = useParams();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { data: fighter, loading, error, retry } = useApi<FighterProfile>(fighterId ? withRanking(`/api/fighters/${fighterId}`, settings.rankingSource) : null,
    data => data?.refreshing ? 5_000 : 5 * 60_000);
  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("fighter:page", Boolean(fighter));
  useSeo({
    title: fighter ? `${fighter.name} — Record & Fight History` : "UFC Fighter Profile",
    description: fighter
      ? `${fighter.name} UFC profile: ${fighter.record} record, physical statistics, ranking and complete fight history.`
      : "UFC fighter record, profile, statistics, ranking and fight history.",
    path: fighterId ? `/fighters/${fighterId}` : undefined,
    type: "profile",
    structuredData: fighter
      ? {
          "@context": "https://schema.org",
          "@type": "Person",
          name: fighter.name,
          alternateName: fighter.nickname || undefined,
          birthDate: fighter.birth_date || undefined,
          url: `https://ufc.sh/fighters/${fighter.id}`,
          ...(fighter.photo_url ? { image: fighter.photo_url } : {}),
        }
      : undefined,
  });

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Loading fighter…</div>;
  }
  if (error && !fighter) {
    return <div className="p-5"><RequestNotice onRetry={retry}>Couldn’t load this fighter. Please try again.</RequestNotice></div>;
  }
  if (!fighter) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Fighter not found.</div>;
  }

  const upcoming = fighter.history.filter((h) => h.upcoming);
  const past = fighter.pro_history ?? fighter.history.filter((h) => !h.upcoming);
  const ufcPast = past.filter((h) => h.promotion !== "outside");
  const outsidePast = past.filter((h) => h.promotion === "outside");
  const journey = weightJourney(ufcPast);
  const weightChanges = new Map(journey.milestones.map((milestone) => [milestone.fightId, milestone]));
  const outsideWins = outsidePast.filter((h) => h.outcome === "win").length;
  const outsideLosses = outsidePast.filter((h) => h.outcome === "loss").length;
  const outsideDraws = outsidePast.filter((h) => h.outcome === "draw").length;
  const outsideRecord = `${outsideWins}-${outsideLosses}${outsideDraws ? `-${outsideDraws}` : ""}`;

  const bio: [string, string][] = (
    [
      ["Height", fighter.height],
      ["Weight", fighter.weight],
      ["Reach", fighter.reach],
      ["Stance", fighter.stance],
      ["Age", fighter.age == null ? "" : String(fighter.age)],
      ["Born", [fighter.birthplace, fighter.country].filter(Boolean).join(", ")],
    ] as [string, string][]
  ).filter(([, v]) => v);


  return (
    <div ref={pageScroll} className="h-full overflow-y-auto lg:overflow-hidden">
      <div className="flex flex-col gap-3 p-3 pb-8 lg:h-full lg:pb-3">
        {error ? <RequestNotice onRetry={retry}>Couldn’t refresh this profile. Showing the last loaded data.</RequestNotice> : null}
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="self-start rounded-full px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700"
        >
          ← Back
        </button>

        {/* Wide windows split the profile: who they are and where they rank on
            the left, held in view, and every fight they've had on the right. */}
        {/* On a wide window the page itself never scrolls: each column is its
            own scroller, so reading one leaves the other exactly where it was. */}
        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(24rem,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 [&>*]:shrink-0 lg:overflow-y-auto lg:overscroll-contain">
        <section className={`${shell} @container px-6 py-5`}>
          <div className="flex flex-col gap-5">
            <div className="flex min-w-0 items-center gap-5">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <FighterPortrait src={fighter.photo_full_url} headshot={fighter.photo_url} name={fighter.name} size="profile" />
              </div>
              <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 break-words text-2xl font-semibold tracking-tight text-zinc-950">
                <span>{fighter.name}</span>
                {fighter.country_code || fighter.country ? (
                  <Flag code={fighter.country_code} name={fighter.country} className="text-xl" />
                ) : null}
              </h1>
              {fighter.nickname ? <div className="text-sm text-zinc-400">“{fighter.nickname}”</div> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {/* With a verified history the records head their wheels below;
                    until then the pro record has no wheel, so it stays here. */}
                {fighter.record_verified ? null : <span className="font-semibold tabular-nums text-zinc-900" title="Professional record"><span className="text-[10px] font-bold text-zinc-400">PRO</span> {fighter.record}</span>}
                {fighter.ranking ? (
                  <span title="Current ranking from the source chosen on the Rankings page" className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${fighter.ranking.rank === "C" ? "bg-amber-100 text-belt" : fighter.ranking.rank === "IC" ? "bg-slate-100 text-belt-interim" : "bg-zinc-100 text-zinc-600"}`}>
                    {fighter.ranking.rank === "C" ? "Champion" : fighter.ranking.rank === "IC" ? "Interim champion" : `#${fighter.ranking.rank}`} · {fighter.ranking.division}
                  </span>
                ) : null}
              </div>
              {bio.length ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  {bio.map(([label, value]) => (
                    <span key={label} title={label === "Age" ? "Current age today" : undefined}>
                      <span className="text-zinc-400">{label}</span> {value}
                    </span>
                  ))}
                </div>
              ) : null}
              </div>
            </div>
            {/* Both records at once, side by side while the card is wide
                enough and stacked when it is not. The professional wheel
                waits until that history is verified. */}
            <div className="flex flex-wrap items-start justify-center gap-x-10 gap-y-5 border-t border-zinc-100 pt-4 empty:hidden">
              {fighter.record_verified ? <RecordWheel key={`${fighter.id}-all`} history={fighter.pro_history} scope="all" record={fighter.record} /> : null}
              <RecordWheel key={`${fighter.id}-ufc`} history={fighter.history} scope="ufc" record={fighter.ufc_record} />
            </div>
          </div>
        </section>

        <WeightJourney base={journey.base} milestones={journey.milestones} />

        <Records records={fighter.records ?? []} />

        <StatisticalRanks stats={fighter.stats ?? []} />
        </div>

        <div className="flex min-w-0 flex-col gap-3 [&>*]:shrink-0 lg:overflow-y-auto lg:overscroll-contain">

        {upcoming.length ? (
          <section className={shell}>
            <div className="px-5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Upcoming
            </div>
            <div className={BOUT_LIST}>
              {upcoming.map((row) => (
                <HistoryRowView key={row.fight_id} row={row} fighterName={fighter.name} />
              ))}
            </div>
          </section>
        ) : null}

        <section className={shell}>
          <h2 className="border-b border-zinc-100 px-5 py-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            UFC ({ufcPast.length}) · {fighter.ufc_record}
          </h2>
          {!fighter.record_verified ? (
            <div className="px-5 pb-1 pt-4 text-[10px] text-zinc-400">Outside-UFC history is still syncing; UFC bouts are shown now.</div>
          ) : null}
          <div className={BOUT_LIST}>
            {ufcPast.length ? (
              ufcPast.map((row, index) => {
                const milestone = row.fight_id ? weightChanges.get(row.fight_id) : undefined;
                return <div key={row.fight_id ?? `${row.date}-${row.opponent.name}-${index}`}
                  id={row.fight_id ? `weight-bout-${row.fight_id}` : undefined} tabIndex={milestone ? -1 : undefined}
                  className="scroll-m-4 overflow-hidden rounded-sm focus:outline-2 focus:outline-sky-300">
                  {milestone ? <WeightChangeMarker milestone={milestone} /> : null}
                  <HistoryRowView row={row} fighterName={fighter.name} />
                </div>;
              })
            ) : (
              <div className="px-5 py-6 text-sm text-zinc-400">No UFC fights on record.</div>
            )}
          </div>
        </section>

        {outsidePast.length ? (
          <details className={`${shell} group overflow-hidden`}>
            <summary
              className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden"
              title="Expand pre-UFC and outside-UFC history"
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  Outside UFC ({outsidePast.length}) · {outsideRecord}
                </span>
              </span>
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
                fill="none"
                viewBox="0 0 12 12"
              >
                <path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <div className={`${BOUT_LIST} border-t border-zinc-100`}>
              {outsidePast.map((row, index) => <HistoryRowView key={row.fight_id ?? `${row.date}-${row.opponent.name}-${index}`} row={row} fighterName={fighter.name} />)}
            </div>
          </details>
        ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}

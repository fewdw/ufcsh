import { isFightDay, liveFightId } from "../liveEvent";
import Freshness from "../components/Freshness";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { prefetch, useApi } from "../api";
import type { CareerBefore, EventDetail, EventFight, FightDetailBlock, FightSide, HistoryRow, Matchup, MatchupSide } from "../api";
import {
  formatDate,
  formatDateShortWithYear,
  formatMethod,
  lastName,
  outcomeClasses,
  rankLabel,
} from "../format";
import Avatar from "../components/Avatar";
import FighterPortrait from "../components/FighterPortrait";
import ResultDots from "../components/ResultDots";
import BonusIcons from "../components/BonusIcons";
import MatchupOdds from "../components/MatchupOdds";
import { segmentedSelected } from "../components/segmented";
import {
  CareerProfile,
  CHART_TEXT,
  CompareRow,
  FightStatistics,
  Legend,
  PANEL_SHELL,
  PanelEmpty,
  PanelHeading,
  Scorecards,
  TaleOfTape,
  compareLabel,
  compareValue,
} from "../components/FightStats";
import { useRouteScrollRestoration } from "../navigationState";
import { useSeo } from "../seo";
import { useSettings, withRanking } from "../settings";

const shell = PANEL_SHELL;
const RESULT_PILL =
  "inline-flex shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-[0.06em]";

/** Which belt is on the line. Only the fight-details page names the interim
 *  one — the event page shows the same plain belt icon for both — so fall back
 *  to the event flag while the detail is still loading. */
function beltOf(fight: Matchup): "title" | "interim" | "tuf" | "tournament" | null {
  return fight.detail?.titleBout ?? fight.title_type ?? (fight.title_fight ? "title" : null);
}

const DECISION_LABEL: Record<string, string> = {
  "U-DEC": "UNANIMOUS",
  "S-DEC": "SPLIT",
  "M-DEC": "MAJORITY",
};

/**
 * Short, all-caps result label. ufcstats records knockouts and technical
 * knockouts in one "KO/TKO" bucket, so that is the most we can honestly say —
 * except for a doctor's stoppage, which the detail page names as a TKO.
 */
function shortMethod(fight: Matchup): string {
  const detailed = fight.detail?.methodInfo?.["Method"] ?? "";
  if (/^tko\b/i.test(detailed)) return "TKO";
  const decision = /^decision\s*-\s*(\w+)/i.exec(detailed);
  if (decision) return decision[1].toUpperCase();
  const method = fight.method ?? "";
  return DECISION_LABEL[method] ?? method.toUpperCase();
}

/** "KO/TKO R1/3 3:12" — how it ended, in one line under the winner's photo. */
function resultSummary(fight: Matchup): string {
  const total = fight.detail?.methodInfo?.["Time format"]?.match(/(\d+)\s*Rnd/i)?.[1];
  // Early bouts were scheduled as "1 Rnd + OT", so a fight can end in a round
  // past the scheduled count. Drop the total rather than print "R2/1". Formats
  // with no round count at all ("No Time Limit") land here too.
  const scheduled = total && Number(fight.round) <= Number(total) ? total : "";
  return [
    shortMethod(fight),
    fight.round ? `R${fight.round}${scheduled ? `/${scheduled}` : ""}` : "",
    fight.time ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "Welterweight" / "Flyweight Title" / "Interim Heavyweight Title" — gold for
 *  the undisputed belt, steel for the interim one, spelled out either way so
 *  the colour is never the only thing saying what is at stake. */
function WeightClassLabel({ fight }: { fight: Matchup }) {
  const belt = beltOf(fight);
  const tournament = belt === "tuf" || belt === "tournament";
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.14em] ${
        belt === "interim"
          ? "font-bold text-belt-interim"
          : belt
            ? tournament
              ? "font-semibold text-zinc-600"
              : "font-bold text-belt"
            : "font-semibold text-zinc-500"
      }`}
    >
      {belt === "tuf" ? "TUF Tournament" : belt === "tournament" ? "Tournament" : (
        <>
          {belt === "interim" ? "Interim " : ""}
          {fight.weight_class}
          {belt ? " Title" : ""}
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------

/** The result reads off the winner's photo. A draw or no-contest belongs to
 *  both fighters; a loss never carries it — the red ring already says so. */
const RESULT_PREFIX: Record<string, string> = {
  win: "Won by ",
  draw: "Draw, ",
  nc: "No contest, ",
};

function FighterHero({
  side,
  align,
  bonuses,
  result,
  portrait,
  onPortraitError,
}: {
  side: MatchupSide;
  align: "left" | "right";
  bonuses: FightDetailBlock["bonuses"] | undefined;
  result?: string | null;
  /** Both corners fall back together when either portrait is unavailable. */
  portrait: boolean;
  onPortraitError: () => void;
}) {
  const rank = side.ranking?.rank === "IC" || side.ranking?.rank === "I" ? "I" : rankLabel(side.ranking) || "NR";
  const rankingBadge = <span className={`inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 text-[10px] font-medium leading-none tabular-nums ${rank === "C" ? "text-belt" : rank === "I" ? "text-belt-interim" : "text-zinc-500"}`} title="Current ranking from the selected source; NR means unranked">{rank}</span>;
  const showResult = side.outcome ? RESULT_PREFIX[side.outcome] : undefined;
  return (
    <Link
      to={`/fighters/${side.id}`}
      aria-label={`View ${side.name}’s fighter profile`}
      className={`matchup-fighter matchup-fighter--${align} group flex min-w-0 flex-col items-center gap-3 text-center @[46rem]:gap-4 ${
        align === "right"
          ? "@[46rem]:flex-row-reverse @[46rem]:text-right"
          : "@[46rem]:flex-row @[46rem]:text-left"
      }`}
    >
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        {portrait ? (
          <FighterPortrait
            src={side.photo_full_url}
            headshot={side.photo_url}
            name={side.name}
            onUnavailable={onPortraitError}
            size="hero"
            glow={false}
            corner={align === "left" ? "f1" : "f2"}
            outcome={side.outcome}
          />
        ) : (
          <Avatar src={side.photo_url} name={side.name} size="lg" outcome={side.outcome} />
        )}
      </div>
      <div className="matchup-identity min-w-0">
        <div
          className={`flex items-baseline justify-center gap-2 ${
            align === "right" ? "@[46rem]:justify-end" : "@[46rem]:justify-start"
          }`}
        >
          {align === "left" ? rankingBadge : null}
          {align === "right" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
          <span className={`matchup-name min-w-0 text-balance text-lg font-semibold leading-tight ${side.outcome === "loss" ? "text-zinc-400" : "text-zinc-900"}`}>
            {side.name}
          </span>
          {align === "left" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
          {align === "right" ? rankingBadge : null}
        </div>
        {side.nickname ? <div className="mt-1 text-[10px] text-zinc-400">“{side.nickname}”</div> : null}
        {result && showResult ? (
          <span className={`${RESULT_PILL} mt-2 whitespace-nowrap tabular-nums ${outcomeClasses(side.outcome)}`}>
            <span className="sr-only">{showResult}</span>
            {result}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

/** All that is left of the result block: the chip under each photo carries the
 *  method, round and time, and the referee sits with the weight class. Without
 *  judges there is nothing to show — and no divider to draw. */
function MatchupResult({ fight }: { fight: Matchup }) {
  if (!fight.detail?.judges?.length) return null;
  return (
    <div className="mt-5 border-t border-zinc-100">
      <Scorecards fight={fight} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison panels. Tale of the tape, form, previous meetings and common
// opponents are the same object with different contents: a headed panel whose
// body is a divided stack of mirrored rows (f1 left, f2 right, the thing being
// compared between them). Everything shared lives in FightStats.

const FORM_LIMIT = 5;

function formOutcomeClass(outcome: HistoryRow["outcome"]): string {
  switch (outcome) {
    case "win":
      return "text-emerald-700";
    case "loss":
      return "text-rose-700";
    case "draw":
      return "text-amber-700";
    case "nc":
      return "text-zinc-600";
    default:
      return "text-zinc-900";
  }
}

function formOutcomeWord(outcome: HistoryRow["outcome"]): string {
  switch (outcome) {
    case "win":
      return "Win";
    case "loss":
      return "Loss";
    case "draw":
      return "Draw";
    case "nc":
      return "NC";
    default:
      return "Result";
  }
}

function OutcomePill({ outcome }: { outcome: HistoryRow["outcome"] }) {
  return (
    <span
      className={`${RESULT_PILL} ${outcomeClasses(outcome)}`}
    >
      {formOutcomeWord(outcome)}
    </span>
  );
}

/** One borderless stop in the shared ten-bout form timeline. Result and
 *  method are deliberately separate: W/L/D/NC says what happened to this
 *  fighter; the quieter text beside it says how the bout ended. */
function FormBout({ row }: { row: HistoryRow }) {
  const method = row.method ?? "";
  const opponent = lastName(row.opponent.name);
  const result = formOutcomeWord(row.outcome);
  return (
    <Link
      to={`/fights/${row.fight_id}`}
      title={`${result} vs ${row.opponent.name}${method ? ` · ${method}` : ""}`}
      aria-label={`${result} against ${row.opponent.name}${method ? `. ${method}` : ""}`}
      className="group flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center transition-colors hover:bg-zinc-50/80 focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
    >
      <span
        className={`flex items-center justify-center px-0.5 text-[10px] font-bold leading-3.5 [overflow-wrap:anywhere] group-hover:underline ${formOutcomeClass(row.outcome)}`}
      >
        {opponent}
      </span>
      <span className="flex max-w-full flex-wrap items-center justify-center gap-1">
        <OutcomePill outcome={row.outcome} />
        <span className="text-[9px] font-semibold leading-4 text-zinc-600">{method || "—"}</span>
      </span>
      <span className="block whitespace-nowrap text-[9px] leading-3 text-zinc-400 tabular-nums">
        {formatDateShortWithYear(row.date)}
      </span>
    </Link>
  );
}

function FormTimeline({ fight, f1, f2 }: { fight: Matchup; f1: HistoryRow[]; f2: HistoryRow[] }) {
  // Both histories point toward the middle, putting each fighter's most
  // recent bout on either side of the center.
  const leftRows = [...f1].reverse();
  const left: (HistoryRow | null)[] = [
    ...Array<null>(FORM_LIMIT - leftRows.length).fill(null),
    ...leftRows,
  ];
  const right: (HistoryRow | null)[] = [...f2, ...Array<null>(FORM_LIMIT - f2.length).fill(null)];

  return (
    <div className="w-full">
      <div className="grid grid-cols-2">
        <div className="flex min-w-0 justify-end px-3 py-0.5">
          <span className={`flex items-center gap-1.5 ${CHART_TEXT} font-semibold text-f1-ink`}>
            {lastName(fight.f1.name)}
          </span>
        </div>
        <div className="flex min-w-0 justify-start border-l border-zinc-200 px-3 py-0.5">
          <span className={`flex items-center gap-1.5 ${CHART_TEXT} font-semibold text-f2-ink`}>
            {lastName(fight.f2.name)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-10">
        {[...left, ...right].map((row, index) =>
          row ? (
            <div
              key={`${index < FORM_LIMIT ? "f1" : "f2"}-${row.fight_id}`}
              className={`min-w-0 ${index === FORM_LIMIT ? "border-l border-zinc-200" : ""}`}
            >
              <FormBout row={row} />
            </div>
          ) : (
            <div
              key={`empty-${index}`}
              aria-hidden="true"
              className={`flex items-center justify-center ${CHART_TEXT} text-zinc-300 ${index === FORM_LIMIT ? "border-l border-zinc-200" : ""}`}
            >
              —
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** A number both sides carry into the bout, mirrored either side of its name.
 *  Values are computed from our own fight records as they stood on the night,
 *  so an old matchup never shows a fighter's present-day career totals. */
function EnteringRow({ label, f1, f2, note }: { label: string; f1: React.ReactNode; f2: React.ReactNode; note?: string }) {
  if (!f1 && !f2) return null;
  const value = (content: React.ReactNode) => <span className={compareValue}>
    {typeof content === "string" && /debut/i.test(content)
      ? <span className="text-sky-600">{content}</span>
      : content || "—"}
  </span>;
  return (
    <CompareRow
      f1={value(f1)}
      f2={value(f2)}
      center={<span className={compareLabel} title={note}>{label}</span>}
    />
  );
}

function MatchupContext({ fight }: { fight: Matchup }) {
  const f1 = fight.f1.career_before;
  const f2 = fight.f2.career_before;
  if (!f1 && !f2) return null;

  const record = (career: CareerBefore | null) =>
    career ? `${career.wins}-${career.losses}${career.draws ? `-${career.draws}` : ""}` : "";
  const run = (career: CareerBefore | null, side: MatchupSide, red = false) => {
    if (!career) return "";
    if (career.bouts + career.ncs === 0) return "Debut";
    const results = side.run_form?.length ? side.run_form : [{ outcome: career.lastOutcome, method: career.lastMethod }];
    const streak = side.streak ?? (career.winStreak ? { count: career.winStreak, outcome: "win" } : career.lossStreak ? { count: career.lossStreak, outcome: "loss" } : { count: results.length, outcome: results.at(-1)?.outcome });
    const kind = streak.outcome === "win" ? "W" : streak.outcome === "loss" ? "L" : streak.outcome === "draw" ? "D" : "NC";
    return <span className={`inline-flex items-center justify-center gap-2 ${red ? "flex-row-reverse" : ""}`} title={`${side.name}: ${streak.count} ${streak.outcome ?? "no contest"} ${streak.count === 1 ? "result" : "results"} entering this bout${side.streak?.complete ? ", counting bouts outside the UFC" : ""}`}><ResultDots results={results.slice(-5)} reverse={red} label={`${side.name} current run${results.length > 5 ? ", showing the latest 5 results" : ""}`} className="shrink-0 !flex-nowrap" /><strong className={`shrink-0 tabular-nums ${red ? "text-f2-ink" : "text-f1-ink"}`}>{streak.count}{kind}</strong></span>;
  };
  const layoff = (career: CareerBefore | null) => {
    if (!career) return "";
    if (career.daysSince == null) return "UFC debut";
    const months = Math.round(career.daysSince / 30.4);
    return career.daysSince < 60 ? `${career.daysSince} days` : `${months} months`;
  };
  const lastResult = (career: CareerBefore | null) => {
    if (!career || career.lastOutcome == null) return career ? "UFC debut" : "";
    const word = career.lastOutcome === "win" ? "Won" : career.lastOutcome === "loss" ? "Lost" : career.lastOutcome === "draw" ? "Drew" : "No contest";
    return career.lastMethod ? `${word} · ${career.lastMethod}` : word;
  };
  const belt = (career: CareerBefore | null) => {
    if (!career) return "";
    if (career.champion) return "Champion";
    if (career.interimChampion) return "Interim champion";
    if (career.formerChampion) return "Former champion";
    return career.titleFights > 0 ? `${career.titleFights} title bouts` : "";
  };

  return (
    <div className="matchup-context mx-auto w-full max-w-md" aria-label="Matchup context entering the fight">
      <h3 className="sr-only">Career entering this fight</h3>
      <EnteringRow label="Record" f1={fight.f1.complete_record_before?.text ?? ""} f2={fight.f2.complete_record_before?.text ?? ""} note="Complete professional record entering this bout, reconstructed from verified dated history" />
      <EnteringRow label="UFC record" f1={record(f1)} f2={record(f2)} />
      <EnteringRow label="Current run" f1={run(f1, fight.f1)} f2={run(f2, fight.f2, true)} note="Consecutive results before this bout, across every promotion where the professional history is verified. Circle = UFC, diamond = outside it; solid = finish, hollow = decision. No contests do not extend or break a run." />
      <EnteringRow label="Last time out" f1={lastResult(f1)} f2={lastResult(f2)} note="How their previous UFC bout ended" />
      <EnteringRow label="Time out" f1={layoff(f1)} f2={layoff(f2)} note="Days since their previous UFC bout" />
      <EnteringRow label="Standing" f1={belt(f1)} f2={belt(f2)} note="Where they stood with the belt going into this bout" />
    </div>
  );
}

function RecentForm({ fight }: { fight: Matchup }) {
  // Form leading into this fight: completed bouts that happened before it.
  const before = (rows: HistoryRow[]) =>
    rows
      .filter((r) => !r.upcoming && r.fight_id !== fight.id && r.date <= fight.event.date)
      .slice(0, FORM_LIMIT);
  const f1 = before(fight.f1.history);
  const f2 = before(fight.f2.history);
  const rows = Math.max(f1.length, f2.length);
  return (
    <section className={`${shell} flex flex-col overflow-hidden`}>
      <h2 className="px-5 pb-1 pt-3 text-sm font-semibold text-zinc-900">Last Five</h2>
      {rows === 0 ? (
        <PanelEmpty>Neither fighter had a UFC bout before this one.</PanelEmpty>
      ) : (
        <FormTimeline key={fight.id} fight={fight} f1={f1} f2={f2} />
      )}
    </section>
  );
}

function HeadToHead({ fight, later = false }: { fight: Matchup; later?: boolean }) {
  const meetings = fight.head_to_head.filter((row) => later ? row.date > fight.event.date : !row.upcoming && row.date <= fight.event.date);
  if (!meetings.length) return null;

  const hasLaterMeeting = meetings.some((row) => row.date > fight.event.date);

  const gridColumns =
    meetings.length === 1
      ? "grid-cols-1"
      : meetings.length === 2
        ? "@[36rem]:grid-cols-2"
        : meetings.length === 3
          ? "@[36rem]:grid-cols-3"
          : "@[36rem]:grid-cols-2 @[52rem]:grid-cols-4";

  return (
    <section className={`${shell} flex flex-col overflow-hidden`}>
      <PanelHeading
        title={later ? "Subsequent meetings" : "Previous meetings"}
        subtitle={
          hasLaterMeeting
            ? undefined
            : `They have met ${meetings.length} time${meetings.length > 1 ? "s" : ""} before`
        }
        aside={<Legend fight={fight} />}
      />
      <div className={`grid gap-px bg-zinc-100 ${gridColumns}`}>
        {meetings.map((row) => {
          const isLater = row.date > fight.event.date;
          const winner =
            row.outcome === "win"
              ? { label: lastName(fight.f1.name), tone: "bg-f1-soft text-f1-ink" }
              : row.outcome === "loss"
                ? { label: lastName(fight.f2.name), tone: "bg-f2-soft text-f2-ink" }
                : row.outcome === "draw"
                  ? { label: "Draw", tone: outcomeClasses("draw") }
                  : row.outcome === "nc"
                    ? { label: "No contest", tone: outcomeClasses("nc") }
                    : { label: row.upcoming ? "Scheduled" : "Result unavailable", tone: outcomeClasses(null) };

          return (
            <Link
              key={row.fight_id}
              to={`/fights/${row.fight_id}`}
              title={`${winner.label} · ${row.event_name} · ${formatDate(row.date)} · ${formatMethod(row.method, row.round, row.time)}`}
              className="group min-w-0 bg-white px-3 py-4 text-center transition-colors hover:bg-zinc-50/80 focus-visible:relative focus-visible:z-10 focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900"
            >
              {isLater ? (
                <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.12em] text-sky-600">
                  After this bout
                </span>
              ) : null}
              <span
                className={`${RESULT_PILL} max-w-full ${winner.tone}`}
              >
                <span className="truncate group-hover:underline">{winner.label}</span>
              </span>
              <span className={`mt-1.5 block truncate ${CHART_TEXT} font-semibold text-zinc-600`}>
                {row.method || "Method unavailable"}
              </span>
              <span className="mt-1 block whitespace-nowrap text-[10px] text-zinc-400 tabular-nums">
                {formatDateShortWithYear(row.date)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function CommonFight({ row, align }: { row: HistoryRow; align: "left" | "right" }) {
  const result = formOutcomeWord(row.outcome);
  const method = row.method || "Method unavailable";
  return (
    <Link
      to={`/fights/${row.fight_id}`}
      title={`${result} · ${method} · ${row.event_name} · ${formatDate(row.date)}`}
      aria-label={`${result} by ${method} on ${formatDate(row.date)}`}
      className={`group block min-w-0 rounded-xl px-2 py-1.5 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <span className={`flex min-w-0 items-center gap-1.5 ${align === "right" ? "justify-end" : "justify-start"}`}>
        {align === "left" ? <OutcomePill outcome={row.outcome} /> : null}
        <span className={`min-w-0 truncate ${CHART_TEXT} font-semibold text-zinc-600 group-hover:underline`}>
          <span className="sr-only">{result}: </span>
          {method}
        </span>
        {align === "right" ? <OutcomePill outcome={row.outcome} /> : null}
      </span>
      <span className="mt-0.5 block whitespace-nowrap text-[9px] text-zinc-400 tabular-nums">
        {formatDateShortWithYear(row.date)}
      </span>
    </Link>
  );
}

function CommonOpponents({ fight }: { fight: Matchup }) {
  const shared = fight.common_opponents.map((comparison) => ({
    ...comparison,
    f1_fights: comparison.f1_fights.filter((row) => !row.upcoming && row.date <= fight.event.date),
    f2_fights: comparison.f2_fights.filter((row) => !row.upcoming && row.date <= fight.event.date),
  })).filter((comparison) => comparison.f1_fights.length && comparison.f2_fights.length);
  if (!shared.length) return null;

  return (
    <section className={`${shell} flex flex-col overflow-hidden`}>
      <PanelHeading
        title="Common opponents"
        subtitle={`${shared.length} opponent${shared.length > 1 ? "s" : ""} both have faced`}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] items-center border-b border-zinc-100 px-4 py-2 @[36rem]:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
        <div className={`flex min-w-0 items-center justify-end gap-1.5 pr-3 ${CHART_TEXT} font-semibold text-f1-ink`}>
          <span className="h-2 w-2 shrink-0 rounded-full bg-f1" />
          <span className="truncate">{lastName(fight.f1.name)}</span>
        </div>
        <div className="text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Opponent
        </div>
        <div className={`flex min-w-0 items-center justify-start gap-1.5 pl-3 ${CHART_TEXT} font-semibold text-f2-ink`}>
          <span className="h-2 w-2 shrink-0 rounded-full bg-f2" />
          <span className="truncate">{lastName(fight.f2.name)}</span>
        </div>
      </div>
      <div className="divide-y divide-zinc-100">
        {shared.map((comparison) => (
          <div
            key={comparison.opponent.id}
            className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] items-center px-4 py-2 @[36rem]:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]"
          >
            <div className="min-w-0 space-y-0.5 pr-3">
              {comparison.f1_fights.map((row) => (
                <CommonFight key={row.fight_id} row={row} align="right" />
              ))}
            </div>
            <div className="min-w-0 border-x border-zinc-100 px-2 py-1 text-center">
              <Link
                to={`/fighters/${comparison.opponent.id}`}
                title={comparison.opponent.name}
                className={`${CHART_TEXT} block truncate font-semibold text-zinc-900 underline-offset-2 hover:underline`}
              >
                {lastName(comparison.opponent.name)}
              </Link>
            </div>
            <div className="min-w-0 space-y-0.5 pl-3">
              {comparison.f2_fights.map((row) => (
                <CommonFight key={row.fight_id} row={row} align="left" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// rail: the rest of the card as picture-vs-picture buttons

function FightRailSkeleton() {
  return (
    <aside className={`hidden w-40 shrink-0 flex-col overflow-hidden sm:flex lg:w-48 ${shell}`} aria-label="Loading fight card">
      <div className="border-b border-zinc-200 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Card</div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="grid grid-cols-2 items-center gap-3 rounded-xl bg-zinc-50 px-1.5 py-2.5" aria-hidden="true">
            <span className="flex justify-center"><Avatar src={null} name="" size="matchup" /></span>
            <span className="flex justify-center"><Avatar src={null} name="" size="matchup" /></span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** A matchup opened cold. The panels are drawn empty rather than replaced by a
 *  centred word, so opening one reads as the page filling in — not as the page
 *  being thrown away and rebuilt. */
function MatchupSkeleton() {
  return (
    <div className="min-w-0 flex-1 overflow-hidden" role="status" aria-label="Loading matchup">
      <div className="flex w-full flex-col gap-3">
        <section className={`overflow-hidden ${shell}`} aria-hidden="true">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
            <span className="h-4 w-48 rounded bg-zinc-100" />
            <span className="h-8 w-20 rounded-lg bg-zinc-100" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-5 py-8">
            {["left", "center", "right"].map((slot) => (
              <div key={slot} className={`flex flex-col items-center gap-2 ${slot === "center" ? "" : "min-w-0"}`}>
                {slot === "center" ? null : <Avatar src={null} name="" size="xl" />}
                <span className={`h-4 rounded bg-zinc-100 ${slot === "center" ? "w-24" : "w-32"}`} />
                <span className="h-3 w-20 rounded bg-zinc-50" />
              </div>
            ))}
          </div>
        </section>
        {[0, 1].map((panel) => (
          <section key={panel} className={`${shell} px-5 py-6`} aria-hidden="true">
            <span className="block h-4 w-40 rounded bg-zinc-100" />
            <span className="mt-4 block h-24 w-full rounded-xl bg-zinc-50" />
          </section>
        ))}
      </div>
    </div>
  );
}

function railMethodTag(fight: EventFight, outcome: FightSide["outcome"]): { label: string; tone: string } | null {
  if (outcome === "draw") return { label: "Draw", tone: "bg-amber-100 text-amber-700" };
  if (outcome === "nc") return { label: "NC", tone: "bg-zinc-200 text-zinc-700" };
  if (outcome !== "win" || !fight.method) return null;
  const label = fight.method === "KO/TKO" ? "KO" : fight.method.endsWith("-DEC") ? "DEC" : fight.method;
  return { label: fight.round ? `${label} R${fight.round}` : label, tone: "bg-emerald-100 text-emerald-700" };
}

function FightRail({ eventId, currentId, returnDepth }: { eventId: string; currentId: string; returnDepth: number | null }) {
  const { settings } = useSettings();
  const railEvent = useRef<EventDetail | null>(null);
  const { data: event, loading } = useApi<EventDetail>(withRanking(`/api/events/${eventId}`, settings.rankingSource), isFightDay(railEvent.current?.date) ? 10_000 : 60_000);
  if (event) railEvent.current = event;
  if (loading || !event) return <FightRailSkeleton />;
  if (event.fights.length < 2) return null;
  const liveId = liveFightId(event);
  return (
    <aside className={`hidden w-40 shrink-0 flex-col overflow-hidden sm:flex lg:w-48 ${shell}`}>
      <div className="border-b border-zinc-200 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Card
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto p-1.5">
        {event.fights.map((f) => {
          const isCurrent = f.id === currentId;
          const isLive = f.id === liveId;
          const f1Method = railMethodTag(f, f.f1.outcome);
          const f2Method = railMethodTag(f, f.f2.outcome);
          return (
            <Link
              key={f.id}
              to={`/fights/${f.id}`}
              state={{ eventId, ...(returnDepth ? { eventReturnDepth: returnDepth + 1 } : {}) }}
              aria-current={isCurrent ? "page" : undefined}
              title={`${f.f1.name} vs ${f.f2.name}${f.method ? ` · ${formatMethod(f.method, f.round, f.time)}` : ""}${isLive ? " · live now" : ""}`}
              onPointerEnter={() => prefetch(withRanking(`/api/fights/${f.id}`, settings.rankingSource))}
              onPointerDown={() => prefetch(withRanking(`/api/fights/${f.id}`, settings.rankingSource))}
              onFocus={() => prefetch(withRanking(`/api/fights/${f.id}`, settings.rankingSource))}
              className={[
                "relative grid w-full grid-cols-2 items-start gap-x-3 gap-y-2 rounded-xl border px-2 py-3 transition-colors",
                // The bout on now keeps its border whether or not it is also
                // the matchup being read, so the two markings can coexist.
                isCurrent ? segmentedSelected : "bg-zinc-50 hover:bg-zinc-100",
                isLive ? "border-emerald-200" : "border-transparent",
              ].join(" ")}
            >
              {isLive ? (
                <>
                  {/* Left, not right: the rail's scrollbar clips the right edge of a tile. */}
                  <span className="live-dot absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  <span className="sr-only">Live now. </span>
                </>
              ) : null}
              <span className="flex min-w-0 flex-col items-center gap-2">
                <Avatar src={f.f1.photo_url} name={f.f1.name} size="matchup" outcome={f.f1.outcome} />
                <span className="flex w-full min-w-0 flex-wrap items-center justify-center gap-1">
                  <span className={`max-w-full whitespace-normal [overflow-wrap:anywhere] text-center text-[10px] font-semibold leading-tight ${isCurrent ? "text-zinc-900" : "text-zinc-600"}`}>{lastName(f.f1.name)}</span>
                </span>
              </span>
              <span className="flex min-w-0 flex-col items-center gap-2">
                <Avatar src={f.f2.photo_url} name={f.f2.name} size="matchup" outcome={f.f2.outcome} />
                <span className="flex w-full min-w-0 flex-wrap items-center justify-center gap-1">
                  <span className={`max-w-full whitespace-normal [overflow-wrap:anywhere] text-center text-[10px] font-semibold leading-tight ${isCurrent ? "text-zinc-900" : "text-zinc-600"}`}>{lastName(f.f2.name)}</span>
                </span>
              </span>
              {f1Method || f2Method ? (
                <span className="col-span-2 flex flex-wrap items-center justify-center gap-1 text-center text-[9px] text-zinc-500">
                  {f.f1.outcome === "win" || f.f2.outcome === "win" ? <span>{lastName(f.f1.outcome === "win" ? f.f1.name : f.f2.name)} won</span> : null}
                  <span className={`rounded px-1 py-px text-[8px] font-semibold ${(f1Method ?? f2Method)!.tone}`}>{(f1Method ?? f2Method)!.label}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

/** Matchup view rendered inside the events layout: card rail + detail + close. */
export default function FightView({ fightId, eventIdHint }: { fightId: string; eventIdHint?: string | null }) {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const previousFight = useRef<Matchup | null>(null);
  const [failedPortraitPair, setFailedPortraitPair] = useState<string | null>(null);
  const { data: loadedFight, loading, error, retry } = useApi<Matchup>(withRanking(`/api/fights/${fightId}`, settings.rankingSource), isFightDay(previousFight.current?.event.date) ? 10_000 : 60_000);
  if (loadedFight) previousFight.current = loadedFight;
  const fight = loadedFight ?? previousFight.current;
  const eventReturnDepth = location.state != null
    && typeof location.state === "object"
    && "eventReturnDepth" in location.state
    && typeof location.state.eventReturnDepth === "number"
    && location.state.eventReturnDepth > 0
    ? location.state.eventReturnDepth
    : null;
  const detailScroll = useRouteScrollRestoration<HTMLDivElement>("fight:detail", Boolean(fight));
  const eventId = loadedFight?.event.id ?? eventIdHint ?? previousFight.current?.event.id;
  const matchupTitle = loadedFight ? `${loadedFight.f1.name} vs ${loadedFight.f2.name}` : "UFC Matchup";
  const matchupDescription = loadedFight
    ? `${loadedFight.f1.name} vs ${loadedFight.f2.name} at ${loadedFight.event.name}: ${loadedFight.weight_class} odds, tale of the tape, fighter statistics${loadedFight.status === "past" ? " and result" : ""}.`
    : "Compare UFC matchup odds, fighter statistics and tale of the tape.";
  useSeo({
    title: matchupTitle,
    description: matchupDescription,
    path: `/fights/${fightId}`,
    structuredData: loadedFight
      ? {
          "@context": "https://schema.org",
          "@type": "SportsEvent",
          name: matchupTitle,
          sport: "Mixed Martial Arts",
          startDate: loadedFight.event.date,
          eventStatus:
            loadedFight.status === "past"
              ? "https://schema.org/EventCompleted"
              : "https://schema.org/EventScheduled",
          url: `https://ufc.sh/fights/${loadedFight.id}`,
          competitor: [
            { "@type": "Person", name: loadedFight.f1.name, url: `https://ufc.sh/fighters/${loadedFight.f1.id}` },
            { "@type": "Person", name: loadedFight.f2.name, url: `https://ufc.sh/fighters/${loadedFight.f2.id}` },
          ],
          superEvent: {
            "@type": "SportsEvent",
            name: loadedFight.event.name,
            url: `https://ufc.sh/events/${loadedFight.event.id}`,
          },
          ...(loadedFight.event.location ? { location: { "@type": "Place", name: loadedFight.event.location } } : {}),
        }
      : undefined,
  });

  const closeFight = useCallback(() => {
    if (eventReturnDepth) navigate(-eventReturnDepth);
    else if (eventId) navigate(`/events/${eventId}`);
    else navigate(-1);
  }, [eventId, eventReturnDepth, navigate]);

  // Escape closes the matchup back to its event card (browser-back while the
  // matchup is still loading and the event isn't known yet).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeFight();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeFight]);

  if (loading && !fight) {
    return (
      <div className="flex h-full min-h-0 gap-3">
        {eventId ? <FightRail eventId={eventId} currentId={fightId} returnDepth={eventReturnDepth} /> : <FightRailSkeleton />}
        <MatchupSkeleton />
      </div>
    );
  }
  if (!fight) {
    return (
      <div className="flex h-full min-h-0 gap-3">
        {eventId ? <FightRail eventId={eventId} currentId={fightId} returnDepth={eventReturnDepth} /> : null}
        <div className={`flex min-w-0 flex-1 items-center justify-center ${shell}`}>
          <div className="text-sm text-zinc-400">Matchup not found.</div>
        </div>
      </div>
    );
  }

  const detail: FightDetailBlock | null = fight.detail;
  const hasStats = detail?.type === "past" && Boolean(detail.totals || detail.sigStrikes);
  // Numbers but no verdict: this bout is happening as the page is read.
  const statsLive = hasStats && fight.status !== "past";
  const result = fight.status === "past" ? resultSummary(fight) : null;
  const portraitPair = JSON.stringify([fight.id, fight.f1.photo_full_url, fight.f2.photo_full_url]);
  const portraits = Boolean(fight.f1.photo_full_url && fight.f2.photo_full_url) && failedPortraitPair !== portraitPair;
  const portraitUnavailable = () => setFailedPortraitPair(portraitPair);
  const referee = fight.detail?.methodInfo?.["Referee"];
  const changingMatchup = !loadedFight && fight.id !== fightId;

  return (
    <div className="flex h-full min-h-0 gap-3">
      <FightRail eventId={eventId ?? fight.event.id} currentId={fightId} returnDepth={eventReturnDepth} />

      <div className="relative min-h-0 min-w-0 flex-1">
        {changingMatchup ? (
          <div className="absolute inset-0 z-30 flex cursor-wait items-start justify-center bg-zinc-100/50 pt-6 backdrop-blur-[1px]">
            <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
              {error ? <button type="button" onClick={retry}>Couldn’t load matchup · Retry</button> : "Loading matchup…"}
            </span>
          </div>
        ) : null}
        <div ref={detailScroll} inert={changingMatchup} className="h-full overflow-y-auto" aria-busy={changingMatchup}>
          <div className="@container flex w-full flex-col gap-3 pb-8">
            <div className="shrink-0">
            <section data-photo-view={portraits ? "full" : "face"} className={`matchup-top-card matchup-overview @container overflow-hidden ${shell}`}>
              <div className="matchup-heading flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><Link
                  to={`/events/${fight.event.id}`}
                  onClick={(event) => {
                    if (!eventReturnDepth) return;
                    event.preventDefault();
                    closeFight();
                  }}
                  className="text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline"
                >
                  {fight.event.name}
                </Link>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-zinc-500">
                  {isFightDay(fight.event.date) ? <span className="flex items-center gap-2"><span className="text-emerald-700">Auto-updating</span><Freshness label="Stats checked" at={fight.stats_updated_at} staleAfterHours={1 / 12} />{error && !changingMatchup ? <span role="status">Connection interrupted; retrying…</span> : null}</span> : null}
                  <span>{formatDate(fight.event.date)}</span>
                  <button
                    type="button"
                    onClick={closeFight}
                    aria-label="Close matchup and return to event"
                    title="Close matchup (Esc)"
                    aria-keyshortcuts="Escape"
                    className="matchup-header-control ml-2 px-2 font-mono text-[11px]"
                  >
                    Esc
                  </button>
                </div>
              </div>

              <div className="matchup-body px-5 py-5">
                {/* The two heroes and the price sit on one line; the panels that
                    compare them run underneath at full width. Keeping the
                    comparisons out of the middle column is what stops a long
                    name or "Former champion" from being clipped while the
                    space either side of the card goes unused. */}
                <div className="matchup-hero grid grid-cols-2 items-start gap-4 @[46rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @[46rem]:gap-6">
                  <div className="col-start-1 row-start-1 min-w-0">
                    <FighterHero side={fight.f1} align="left" bonuses={fight.bonuses} result={result} portrait={portraits} onPortraitError={portraitUnavailable} />
                  </div>
                  <div className="matchup-market self-center col-span-2 col-start-1 row-start-2 flex w-full flex-col items-center text-center @[46rem]:col-span-1 @[46rem]:col-start-2 @[46rem]:row-start-1 @[46rem]:w-auto @[46rem]:max-w-[19rem]">
                    <div className="matchup-prices">
                      <MatchupOdds f1={fight.odds?.f1.close} f2={fight.odds?.f2.close}
                        f1Open={fight.odds?.f1.open} f2Open={fight.odds?.f2.open}
                        f1Name={fight.f1.name} f2Name={fight.f2.name} />
                    </div>
                    <WeightClassLabel fight={fight} />
                    {referee ? <div className="mt-1 text-[10px] text-zinc-400">Ref {referee}</div> : null}
                  </div>
                  <div className="col-start-2 row-start-1 min-w-0 @[46rem]:col-start-3">
                    <FighterHero side={fight.f2} align="right" bonuses={fight.bonuses} result={result} portrait={portraits} onPortraitError={portraitUnavailable} />
                  </div>
                </div>

              </div>
            </section>
            </div>

            {fight.status === "past" ? <>
              {hasStats ? <FightStatistics fight={fight} live={statsLive} /> : (
                <div className={`${shell} px-5 py-4 text-xs text-zinc-500`} role="status">
                  Result confirmed. Detailed statistics are still being published{isFightDay(fight.event.date) ? " — checking automatically." : "."}
                </div>
              )}
              {fight.detail?.judges?.length ? <section className={`${shell} px-5 pb-5`}><MatchupResult fight={fight} /></section> : null}
              <HeadToHead fight={fight} later />
            </> : null}
            <section className={`matchup-overview @container px-5 pb-5 ${shell}`}>
              <div className="matchup-comparisons grid @[46rem]:grid-cols-2">
                <h2 className="matchup-comparison-heading text-zinc-500">At a glance</h2>
                <TaleOfTape fight={fight} compact />
                <MatchupContext fight={fight} />
              </div>
            </section>
            <RecentForm fight={fight} />
            <CareerProfile fight={fight} />
            <HeadToHead fight={fight} />
            <CommonOpponents fight={fight} />
          </div>
        </div>
      </div>
    </div>
  );
}

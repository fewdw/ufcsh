import { List, X } from "lucide-react";
import { isFightDay } from "../liveEvent";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useApi } from "../api";
import type { EventDetail, EventFight, FightDetailBlock, HistoryRow, Matchup, MatchupSide, ProfessionalHistoryRow } from "../api";
import {
  formatDate,
  formatDateShortWithYear,
  formatMethod,
  futureDayLabel,
  lastName,
  outcomeClasses,
  outcomeLabel,
  rankLabel,
  roundsLabel,
} from "../format";
import Avatar from "../components/Avatar";
import { CardEventTitle, CardNavigation, CARD_STEP } from "../components/CardHeader";
import FightScoring from "../components/FightScoring";
import FightPredictions from "../components/FightPredictions";
import { FightRail, FightRailSkeleton, FightStepLink, MatchupSkeleton } from "../components/FightRail";
const FightDiscussion = lazy(() => import("../components/FightDiscussion"));
import FighterPortrait from "../components/FighterPortrait";
import { resultDot } from "../resultDots";
import MatchupOdds, { OddsFormatTabs, OddsMarkets } from "../components/MatchupOdds";
import { hasOddsMarkets } from "../oddsLayout";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "../components/segmented";
import {
  CareerProfile,
  CHART_TEXT,
  CompareRow,
  FightStatistics,
  PANEL_SHELL,
  PanelEmpty,
  PanelHeading,
  Scorecards,
  TaleOfTape,
  compareLabel,
  compareValue,
  metaText,
  sectionLabel,
} from "../components/FightStats";
import { cardFightSearch, useRouteScrollRestoration } from "../navigationState";
import { SITE_URL, useSeo } from "../seo";
import { useSettings, withRanking } from "../settings";
import { scoreableRoundCount } from "../scoring";
import { useNow } from "../useNow";
import { CLOSE_BUTTON, CLOSE_ICON } from "../ui";
import { useShortcutNav } from "../shortcuts";

const shell = PANEL_SHELL;
const RESULT_PILL =
  "inline-flex shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-[0.06em]";

/** Only a confirmed title type earns a belt label. The event flag alone can
 *  be set on ordinary bouts, including the debut fights on this card. */
function beltOf(fight: Matchup): "title" | "interim" | "tuf" | "tournament" | null {
  return fight.detail?.titleBout ?? fight.title_type ?? null;
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
      className={`inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
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
      {fight.scheduled_rounds ? <span className="ml-1.5 text-zinc-400">{roundsLabel(fight.scheduled_rounds)}</span> : null}
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

/** Before 2014 the performance award was a Knockout or Submission of the Night.
 *  The pills carry the fans' shorthand; the full name is the tooltip. */
const PERF_AWARD = {
  perf: { short: "POTN", full: "Performance of the Night" },
  ko: { short: "KOTN", full: "Knockout of the Night" },
  sub: { short: "SOTN", full: "Submission of the Night" },
} as const;
const AWARD_PILL = "inline-flex whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold leading-4 text-amber-800";

function FighterHero({
  side,
  align,
  bonuses,
  result,
  portrait,
  onPortraitError,
  reserveRank = false,
}: {
  side: MatchupSide;
  align: "left" | "right";
  bonuses: Matchup["bonuses"] | undefined;
  result?: string | null;
  /** Both corners fall back together when either portrait is unavailable. */
  portrait: boolean;
  onPortraitError: () => void;
  /** The other corner shows a rank badge: hold its line here too, so the two
   *  names start level when the heroes sit side by side over their pictures. */
  reserveRank?: boolean;
}) {
  const rank = side.ranking?.rank === "IC" || side.ranking?.rank === "I" ? "I" : rankLabel(side.ranking) || "NR";
  const rankingBadge = rank === "NR" ? null : <span className={`inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 text-[10px] font-medium leading-none tabular-nums ${rank === "C" ? "text-belt" : rank === "I" ? "text-belt-interim" : "text-zinc-500"}`} title="Current ranking from the selected source; NR means unranked">{rank}</span>;
  const showResult = side.outcome ? RESULT_PREFIX[side.outcome] : undefined;
  const fotn = !!bonuses?.fotn;
  const perf = bonuses?.perf && side.outcome === "win" ? bonuses.perf_kind ?? "perf" : null;
  const className = `matchup-fighter matchup-fighter--${align} group flex min-w-0 flex-col items-center gap-3 text-center @[58rem]:gap-4 ${
    align === "right"
      ? "@[58rem]:flex-row-reverse @[58rem]:text-right"
      : "@[58rem]:flex-row @[58rem]:text-left"
  }`;
  const content = <>
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        {portrait ? (
          <FighterPortrait
            src={side.photo_full_url}
            headshot={side.photo_url}
            name={side.name}
            onUnavailable={onPortraitError}
            size="hero"
            corner={align === "left" ? "f1" : "f2"}
            outcome={side.outcome}
            glow={false}
          />
        ) : (
          <Avatar src={side.photo_url} name={side.name} size="lg" outcome={side.outcome} />
        )}
      </div>
      <div className="matchup-identity min-w-0">
        {/* Rank and awards sit on their own line above the name, so a long
            name never pushes the badge onto a line of its own. */}
        {rankingBadge ? <div className="mb-1.5 flex items-center justify-center gap-1.5">{rankingBadge}</div>
          : reserveRank ? <div aria-hidden="true" className="mb-1.5 h-5 @[58rem]:hidden" /> : null}
        <div className={`matchup-name text-balance font-semibold transition-[filter] ${side.outcome === "loss" ? "text-zinc-400" : align === "left" ? "text-f1 group-hover:brightness-90" : "text-f2 group-hover:brightness-90"}`}>
          {side.name}
        </div>
        {side.nickname ? <div className="mt-0.5 text-xs text-zinc-400">“{side.nickname}”</div> : null}
        {(result && showResult) || fotn || perf || side.weight_miss != null ? (
          <div className={`mt-2 flex flex-wrap items-center justify-center gap-1 ${align === "right" ? "@[58rem]:justify-end" : "@[58rem]:justify-start"}`}>
            {result && showResult ? (
              <span className={`${RESULT_PILL} max-w-full justify-center text-balance tabular-nums ${outcomeClasses(side.outcome)}`}>
                <span className="sr-only">{showResult}</span>
                {result}
              </span>
            ) : null}
            {side.weight_miss != null ? (
              <span className={`${RESULT_PILL} max-w-full justify-center text-balance tabular-nums bg-rose-100 text-rose-700`}>
                Missed weight{side.weight_miss ? ` · ${side.weight_miss} lb` : ""}
              </span>
            ) : null}
            {/* Fight of the Night belongs to both corners, a performance award to the winner. */}
            {perf ? <span className={AWARD_PILL} title={`${PERF_AWARD[perf].full} bonus`}>{PERF_AWARD[perf].short}</span> : null}
            {fotn ? <span className={AWARD_PILL} title="Fight of the Night bonus">FOTN</span> : null}
          </div>
        ) : null}
      </div>
    </>;
  return side.profile_eligible
    ? <Link to={`/fighters/${side.id}`} aria-label={`View ${side.name}’s fighter profile`} className={className}>{content}</Link>
    : <div className={className}>{content}</div>;
}

// ---------------------------------------------------------------------------
// Comparison panels. Tale of the tape, form, previous meetings and common
// opponents are the same object with different contents: a headed panel whose
// body is a divided stack of mirrored rows (f1 left, f2 right, the thing being
// compared between them). Everything shared lives in FightStats.

const FORM_LIMIT = 5;

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

type UfcHistoryRow = HistoryRow | ProfessionalHistoryRow;

/** The compact W/L badge used both in Tale of the Tape and Last Five. */
function CompactOutcomePill({ outcome, title }: { outcome: HistoryRow["outcome"]; title?: string }) {
  return (
    <span
      className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${outcomeClasses(outcome)}`}
      title={title ?? formOutcomeWord(outcome)}
    >
      {outcomeLabel(outcome) || "?"}
    </span>
  );
}

function FormMark({ row }: { row: UfcHistoryRow }) {
  const dot = resultDot({ outcome: row.outcome, method: row.method, ufc: row.promotion !== "outside" });
  return <CompactOutcomePill outcome={row.outcome} title={dot.label} />;
}

function FormTarget({ row, className, children }: { row: UfcHistoryRow; className: string; children: React.ReactNode }) {
  const result = formOutcomeWord(row.outcome);
  const method = row.method ?? "";
  const title = `${result} vs ${row.opponent.name}${method ? ` · ${method}` : ""} · ${formatDate(row.date)}`;
  const label = `${result} against ${row.opponent.name}${method ? `. ${method}` : ""}. ${formatDate(row.date)}`;
  if (row.fight_id) return <Link to={`/fights/${row.fight_id}`} title={title} aria-label={label} className={className}>{children}</Link>;
  const href = "source_url" in row ? row.source_url : null;
  if (href) return <a href={href} target="_blank" rel="noreferrer" title={title} aria-label={label} className={className}>{children}</a>;
  return <div title={title} className={className}>{children}</div>;
}

/** First name over everything after it, so "Rafael dos Anjos" keeps its
 *  particle with the surname. A single-word name sits on the surname line. */
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return ["", parts[0] ?? name];
  return [parts[0], parts.slice(1).join(" ")];
}

/** One stop in a fighter's run into this bout. The opponent leads — that is
 *  what the eye hunts for — with how it ended under it and the date last.
 *  Colour never carries the result alone: the mark spells it out as W/L/D/NC
 *  and screen readers are given the whole word. */
function FormBout({ row }: { row: UfcHistoryRow }) {
  const method = resultDot(row).shortMethod ?? "";
  const [given, surname] = splitName(row.opponent.name);
  return (
    <FormTarget
      row={row}
      className="group flex h-full min-w-0 flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-center transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900"
    >
      <span className="flex w-full min-w-0 flex-col text-[11px] leading-4">
        <span className="block truncate font-medium text-zinc-500">{given || " "}</span>
        <span className="block truncate font-semibold text-zinc-800">{surname}</span>
      </span>
      <span className="flex max-w-full flex-wrap items-center justify-center gap-1">
        <FormMark row={row} />
        <span className="text-[9px] font-semibold uppercase leading-4 tracking-[0.04em] text-zinc-500">
          {method || "—"}
        </span>
      </span>
      <span className={`block whitespace-nowrap leading-3 ${metaText}`}>
        {formatDateShortWithYear(row.date)}
      </span>
    </FormTarget>
  );
}

/** One stop as a line of its own, for a panel too narrow for five columns:
 *  the result and opponent, and under them how it ended and when. */
function FormListBout({ row }: { row: UfcHistoryRow }) {
  const method = resultDot(row).shortMethod ?? "";
  return (
    <FormTarget
      row={row}
      className="flex min-w-0 items-start gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900"
    >
      <FormMark row={row} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${CHART_TEXT} font-semibold leading-4 text-zinc-800`}>{row.opponent.name}</span>
        <span className="block truncate text-[10px] leading-3 text-zinc-400">
          <span className="font-semibold uppercase text-zinc-500">{method || "—"}</span> · {formatDateShortWithYear(row.date)}
        </span>
      </span>
    </FormTarget>
  );
}

/** One fighter's last five, oldest to newest. Side by side the second half
 *  is mirrored so both latest bouts meet at the centre; too narrow, it
 *  becomes a newest-first list. */
function FormHalf({ name, rows, side }: { name: string; rows: UfcHistoryRow[]; side: "f1" | "f2" }) {
  const chronological = [...rows].reverse();
  const cells: (UfcHistoryRow | null)[] = [
    ...Array<null>(Math.max(0, FORM_LIMIT - chronological.length)).fill(null),
    ...chronological,
  ];
  const mirror = side === "f2" ? "@[56rem]:flex-row-reverse" : "";
  return (
    <div className="min-w-0" aria-label={`${name}'s last five`}>
      {/* The name in its corner's ink says whose list this is. */}
      <div className={`mb-1 truncate px-1 text-[13px] font-semibold leading-5 @[56rem]:hidden ${side === "f1" ? "text-f1-ink" : "text-f2-ink"}`}>
        {name}
      </div>
      <div className="flex flex-col @[34rem]:hidden">
        {rows.length ? rows.map((row, index) => <FormListBout key={row.fight_id ?? `${row.date}-${row.opponent.name}-${index}`} row={row} />)
          : <p className={`px-1 py-1 ${CHART_TEXT} text-zinc-400`}>No earlier bouts available.</p>}
      </div>
      <div className={`hidden items-stretch @[34rem]:flex ${mirror}`}>
        {cells.map((row, index) =>
          row ? (
            <div key={row.fight_id ?? `${row.date}-${row.opponent.name}-${index}`} className="min-w-0 flex-1 basis-0">
              <FormBout row={row} />
            </div>
          ) : (
            <div
              key={`empty-${index}`}
              aria-hidden="true"
              className={`flex min-w-0 flex-1 basis-0 items-center justify-center ${CHART_TEXT} text-zinc-300`}
            >
              —
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function FormTimeline({ fight, f1, f2 }: { fight: Matchup; f1: UfcHistoryRow[]; f2: UfcHistoryRow[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-x-2 px-2 py-2 @[34rem]:grid-cols-1 @[34rem]:gap-y-4 @[34rem]:px-3 @[34rem]:py-3 @[56rem]:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] @[56rem]:gap-x-3 @[56rem]:gap-y-0">
      <FormHalf name={fight.f1.name} rows={f1} side="f1" />
      <div aria-hidden="true" className="bg-zinc-100 @[34rem]:hidden @[56rem]:block @[56rem]:bg-zinc-200" />
      <FormHalf name={fight.f2.name} rows={f2} side="f2" />
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

  const layoff = (days: number | null, record: string | null) => {
    if (days == null) return record ? "—" : "UFC debut";
    const months = Math.round(days / 30.4);
    return days < 60 ? `${days} days` : `${months} months`;
  };
  const f1Last = fight.f1.recent_history?.[0];
  const f2Last = fight.f2.recent_history?.[0];
  const lastFight = (row: UfcHistoryRow | undefined) => row ? (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <CompactOutcomePill outcome={row.outcome} />
      <span className="min-w-0 text-zinc-500" title={row.method ?? undefined}>{resultDot(row).shortMethod || "—"}</span>
    </span>
  ) : null;

  if (!f1 && !f2 && !f1Last && !f2Last && !fight.f1.complete_record_before && !fight.f2.complete_record_before) return null;

  return (
    <div className="matchup-context mx-auto w-full max-w-md" aria-label="Matchup context entering the fight">
      <h3 className="sr-only">Career entering this fight</h3>
      <EnteringRow label="Record" f1={fight.f1.complete_record_before?.text ?? ""} f2={fight.f2.complete_record_before?.text ?? ""} note="Complete professional record entering this bout, reconstructed from verified dated history" />
      <EnteringRow label="UFC record" f1={fight.f1.ufc_record_before ?? ""} f2={fight.f2.ufc_record_before ?? ""} />
      <EnteringRow label="Time out" f1={layoff(fight.f1.ufc_days_since_before, fight.f1.ufc_record_before)} f2={layoff(fight.f2.ufc_days_since_before, fight.f2.ufc_record_before)} note="Days since their previous UFC bout" />
      <EnteringRow label="Last fight" f1={lastFight(f1Last)} f2={lastFight(f2Last)} note="Result and method in each fighter's previous professional bout, in any promotion" />
    </div>
  );
}

function OddsPanel({ fight }: { fight: Matchup }) {
  const props = fight.odds?.props;
  const { settings, update } = useSettings();
  if (!hasOddsMarkets(props, fight.f1.name, fight.f2.name)) return null;
  return (
    <section className={`${shell} @container flex flex-col overflow-hidden`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-zinc-200 px-4 py-2 sm:py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Odds</h2>
          <Link
            to={`/events/${fight.event.id}?odds=1`}
            className="text-[10px] text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Full card odds <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <OddsFormatTabs format={settings.oddsFormat} onChange={(oddsFormat) => update("oddsFormat", oddsFormat)} />
      </header>
      <OddsMarkets
        odds={props}
        moneyline={fight.odds ? { f1: fight.odds.f1, f2: fight.odds.f2 } : null}
        fightId={fight.id}
        f1Name={fight.f1.name}
        f2Name={fight.f2.name}
        format={settings.oddsFormat}
        compact
        result={{
          winner: fight.f1.outcome === "win" ? 1 : fight.f2.outcome === "win" ? 2 : null,
          method: fight.method,
          round: fight.round,
          time: fight.time,
        }}
      />
    </section>
  );
}

function RecentForm({ fight }: { fight: Matchup }) {
  const f1 = fight.f1.recent_history ?? [];
  const f2 = fight.f2.recent_history ?? [];
  const rows = Math.max(f1.length, f2.length);
  return (
    <section className={`${shell} flex flex-col overflow-hidden`}>
      <PanelHeading title="Last five" />
      {rows === 0 ? (
        <PanelEmpty>No earlier professional bouts are available.</PanelEmpty>
      ) : (
        <FormTimeline key={fight.id} fight={fight} f1={f1} f2={f2} />
      )}
    </section>
  );
}

/** Their other bouts against each other, before this one or (for a past fight)
 *  after it. Oldest first, so a rivalry reads left to right in order. */
function meetingsOf(fight: Matchup, later: boolean): HistoryRow[] {
  return fight.head_to_head
    .filter((row) => later ? row.date > fight.event.date : !row.upcoming && row.date <= fight.event.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Opponents both had faced before this bout. */
function sharedOpponents(fight: Matchup) {
  return fight.common_opponents.map((comparison) => ({
    ...comparison,
    f1_fights: comparison.f1_fights.filter((row) => !row.upcoming && row.date <= fight.event.date),
    f2_fights: comparison.f2_fights.filter((row) => !row.upcoming && row.date <= fight.event.date),
  })).filter((comparison) => comparison.f1_fights.length && comparison.f2_fights.length);
}

function HeadToHead({ fight, later = false }: { fight: Matchup; later?: boolean }) {
  const meetings = meetingsOf(fight, later);
  if (!meetings.length) return null;

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
                <span className={`mb-1.5 block ${sectionLabel} !text-sky-600`}>
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
              <span className={`mt-1 block whitespace-nowrap ${metaText}`}>
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
      <span className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 ${align === "right" ? "justify-end" : "justify-start"}`}>
        {align === "left" ? <OutcomePill outcome={row.outcome} /> : null}
        <span className={`whitespace-nowrap ${CHART_TEXT} font-semibold text-zinc-600 group-hover:underline`}>
          <span className="sr-only">{result}: </span>
          {method}
        </span>
        {align === "right" ? <OutcomePill outcome={row.outcome} /> : null}
      </span>
      <span className={`mt-0.5 block whitespace-nowrap ${metaText}`}>
        {formatDateShortWithYear(row.date)}
      </span>
    </Link>
  );
}

function CommonOpponents({ fight }: { fight: Matchup }) {
  const shared = sharedOpponents(fight);
  if (!shared.length) return null;

  return (
    <section className={`${shell} flex flex-col overflow-hidden`}>
      <PanelHeading title="Common opponents" />
      <div className="divide-y divide-zinc-100">
        {shared.map((comparison) => (
          // Too narrow for three columns, the opponent heads the row and the
          // two records sit under it, still first fighter left.
          <div
            key={comparison.opponent.id}
            className="grid grid-cols-2 items-center gap-x-2 px-4 py-2 @[30rem]:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] @[30rem]:gap-x-0 @[40rem]:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]"
          >
            <div className="col-start-1 row-start-2 min-w-0 space-y-0.5 @[30rem]:row-start-1 @[30rem]:pr-3">
              {comparison.f1_fights.map((row) => (
                <CommonFight key={row.fight_id} row={row} align="right" />
              ))}
            </div>
            <div className="col-span-2 col-start-1 row-start-1 min-w-0 border-zinc-100 px-2 py-1 text-center @[30rem]:col-span-1 @[30rem]:col-start-2 @[30rem]:border-x">
              <Link
                to={`/fighters/${comparison.opponent.id}`}
                title={comparison.opponent.name}
                className={`${CHART_TEXT} block truncate font-semibold text-zinc-900 underline-offset-2 hover:underline`}
              >
                {comparison.opponent.name}
              </Link>
            </div>
            <div className="col-start-2 row-start-2 min-w-0 space-y-0.5 @[30rem]:col-start-3 @[30rem]:row-start-1 @[30rem]:pl-3">
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

type MatchupTab = "fight" | "matchup" | "odds" | "score" | "predict" | "discussion";
const TAB_LABEL: Record<MatchupTab, string> = { fight: "Result", matchup: "Matchup", odds: "Odds", score: "Score", predict: "Predict", discussion: "Discussion" };

/** The matchup's sections, grouped by the question they answer. Arrow keys move
 *  between tabs the way a native tab control does. */
function MatchupTabs({ tabs, current, onSelect }: { tabs: MatchupTab[]; current: MatchupTab; onSelect: (tab: MatchupTab) => void }) {
  const refs = useRef(new Map<MatchupTab, HTMLButtonElement>());
  const move = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    onSelect(tab);
    refs.current.get(tab)?.focus();
  };
  return (
    <div role="tablist" aria-label="Matchup sections" className={`${segmentedGroup} w-full`}>
      {tabs.map((tab, index) => (
        <button
          key={tab}
          ref={(node) => { if (node) refs.current.set(tab, node); else refs.current.delete(tab); }}
          type="button"
          role="tab"
          id={`matchup-tab-${tab}`}
          aria-selected={tab === current}
          aria-controls="matchup-tabpanel"
          tabIndex={tab === current ? 0 : -1}
          onClick={() => onSelect(tab)}
          onKeyDown={(event) => move(event, index)}
          className={`${segmentedTab} ${tab === current ? segmentedSelected : segmentedIdle}`}
        >
          {TAB_LABEL[tab]}
        </button>
      ))}
    </div>
  );
}

/** Matchup view rendered inside the events layout: card rail + detail + close. */
export default function FightView({ fightId, eventIdHint }: { fightId: string; eventIdHint?: string | null }) {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const previousFight = useRef<Matchup | null>(null);
  const [failedPortraitPair, setFailedPortraitPair] = useState<string | null>(null);
  const { data: loadedFight, loading, error, retry } = useApi<Matchup>(withRanking(`/api/fights/${fightId}`, settings.rankingSource),
    data => data?.refreshing ? 5_000 : isFightDay(data?.event.date) ? 15_000 : data?.status === "past" ? 0 : 5 * 60_000);
  if (loadedFight) previousFight.current = loadedFight;
  const fight = loadedFight ?? previousFight.current;
  const eventReturnDepth = location.state != null
    && typeof location.state === "object"
    && "eventReturnDepth" in location.state
    && typeof location.state.eventReturnDepth === "number"
    && location.state.eventReturnDepth > 0
    ? location.state.eventReturnDepth
    : null;
  // Scoped to the fight, not the history entry: switching tabs replaces the
  // URL's `?tab=` search param, which mints a new location key and would
  // otherwise read as a brand-new page and reset the scroll to the top.
  const detailScroll = useRouteScrollRestoration<HTMLDivElement>("fight:detail", Boolean(fight), fightId);
  const eventId = loadedFight?.event.id ?? eventIdHint ?? previousFight.current?.event.id;
  const { data: cardEvent } = useApi<EventDetail>(eventId ? withRanking(`/api/events/${eventId}`, settings.rankingSource) : null,
    data => data?.refreshing ? 5_000 : isFightDay(data?.date) ? 15_000 : data?.status === "past" ? 0 : 5 * 60_000);
  const now = useNow(fight?.status !== "past");
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
          url: `${SITE_URL}/fights/${loadedFight.id}`,
          competitor: [
            { "@type": "Person", name: loadedFight.f1.name, ...(loadedFight.f1.profile_eligible ? { url: `${SITE_URL}/fighters/${loadedFight.f1.id}` } : {}) },
            { "@type": "Person", name: loadedFight.f2.name, ...(loadedFight.f2.profile_eligible ? { url: `${SITE_URL}/fighters/${loadedFight.f2.id}` } : {}) },
          ],
          superEvent: {
            "@type": "SportsEvent",
            name: loadedFight.event.name,
            url: `${SITE_URL}/events/${loadedFight.event.id}`,
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
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog closes itself first, and a field being typed in keeps its Escape.
      if (document.querySelector("dialog[open]")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      closeFight();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeFight]);

  // The arrow keys walk the card the same way the Prev/Next links do: Next
  // moves up toward the main event.
  const cardFights = cardEvent && cardEvent.id === eventId ? cardEvent.fights : [];
  const cardAt = cardFights.findIndex((entry) => entry.id === fightId);
  const stepTo = (target: EventFight | undefined) => target && eventId ? () => navigate(
    { pathname: `/fights/${target.id}`, search: cardFightSearch(location.search) },
    { state: { eventId, ...(eventReturnDepth ? { eventReturnDepth: eventReturnDepth + 1 } : {}) } },
  ) : null;
  useShortcutNav(cardEvent && cardAt >= 0 ? {
    context: `fights on ${cardEvent.name}`,
    prevLabel: "previous fight, toward the opener",
    nextLabel: "next fight, toward the main event",
    prev: stepTo(cardFights[cardAt + 1]),
    next: stepTo(cardAt > 0 ? cardFights[cardAt - 1] : undefined),
  } : null);

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
  const portraits = [fight.f1, fight.f2].every(side => side.photo_full_url || !side.photo_url)
    && failedPortraitPair !== portraitPair;
  const portraitUnavailable = () => setFailedPortraitPair(portraitPair);
  const referee = fight.detail?.methodInfo?.["Referee"];
  const reserveRank = Boolean(fight.f1.ranking || fight.f2.ranking);
  const changingMatchup = !loadedFight && fight.id !== fightId;
  const orderedFights = cardEvent?.id === fight.event.id ? cardEvent.fights : [];
  const fightIndex = orderedFights.findIndex((entry) => entry.id === fightId);
  // Card rows run main event first. Next moves up that list toward the main
  // event; Prev moves down toward the opening bout.
  const previous = fightIndex >= 0 ? orderedFights[fightIndex + 1] ?? null : null;
  const next = fightIndex > 0 ? orderedFights[fightIndex - 1] : null;
  const navSearch = cardFightSearch(location.search);

  // Only tabs with something in them; a finished or live bout opens on what
  // happened, an upcoming one on the matchup. The choice lives in the URL.
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const tabs: MatchupTab[] = [
    ...(fight.status === "past" || fight.in_progress || hasStats ? ["fight" as const] : []),
    "matchup",
    ...(hasOddsMarkets(fight.odds?.props, fight.f1.name, fight.f2.name) ? ["odds" as const] : []),
    ...(scoreableRoundCount(fight) > 0 ? ["score" as const] : []),
    ...(fight.prediction_available !== false && (fight.status !== "past" || requestedTab === "predict") ? ["predict" as const] : []),
    "discussion",
  ];
  const tab = tabs.find((candidate) => candidate === requestedTab) ?? tabs[0];
  // Only the tab panel below should change; the reader's scroll position is
  // left alone. (A tab shorter than the current scroll depth still behaves
  // correctly on its own — the browser clamps scrollTop to the new content's
  // height, and the tab bar stays put since it's sticky.)
  const selectTab = (next: MatchupTab) => {
    navigate({ search: `?tab=${next}` }, { replace: true, state: location.state });
  };

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
            <div className="flex shrink-0 flex-col gap-3">
            <section className={`overflow-hidden ${shell}`}>
              <CardNavigation
                previous={<FightStepLink fight={previous} direction="prev" eventId={fight.event.id} returnDepth={eventReturnDepth} search={navSearch} />}
                center={<button type="button" onClick={closeFight} aria-keyshortcuts="Escape"
                  className={`${CARD_STEP} text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950`}>
                  <List className="h-3.5 w-3.5" aria-hidden="true" />Card
                </button>}
                next={<FightStepLink fight={next} direction="next" eventId={fight.event.id} returnDepth={eventReturnDepth} search={navSearch} />}
              />
              <CardEventTitle
                name={fight.event.name}
                date={fight.event.date}
                location={fight.event.location}
                venue={fight.event.venue}
                dayLabel={fight.status === "past" ? null : futureDayLabel(fight.event.date, now)}
              >
                {isFightDay(fight.event.date) && error && !changingMatchup ? <span role="status" className="text-xs text-zinc-500">Connection interrupted; retrying…</span> : null}
              </CardEventTitle>
            </section>

            <section data-photo-view={portraits ? "full" : "face"} className={`matchup-top-card matchup-overview @container relative overflow-hidden ${shell}`}>
              <button type="button" onClick={closeFight} aria-label="Close matchup and return to card" title="Close matchup (Esc)" aria-keyshortcuts="Escape"
                className={`absolute right-2 top-2 z-10 ${CLOSE_BUTTON}`}>
                <X className={CLOSE_ICON} aria-hidden="true" />
              </button>

              <div className="matchup-body px-5 py-5">
                {/* The two heroes and the price sit on one line, the price
                    between them, at every width — narrow down to a compact
                    badge rather than dropping to a row of its own, so it
                    keeps the gap between the two portraits instead of
                    pushing the card taller. The panels that compare the
                    fighters run underneath at full width; keeping the
                    comparisons out of the middle column is what stops a long
                    name or "Former champion" from being clipped while the
                    space either side of the card goes unused. */}
                <div className="matchup-hero grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1.5 @[58rem]:gap-6">
                  {/* The weight class, rounds and referee line head the hero
                      at every width. It spans all three columns rather than
                      riding in the middle one with the price: "Light
                      Heavyweight Title" is wider than the price card, and an
                      auto-width middle column sized to the badge would eat
                      the space the two names need. */}
                  <div className="matchup-billing col-span-3 col-start-1 row-start-1 flex flex-col items-center text-center">
                    <WeightClassLabel fight={fight} />
                    {referee ? (
                      <div className="mt-1 text-[10px] text-zinc-400">
                        Ref {fight.officials?.referee?.slug
                          ? <Link to={`/referees/${fight.officials.referee.slug}`} className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-700">{referee}</Link>
                          : referee}
                      </div>
                    ) : null}
                  </div>
                  <div className="col-start-1 row-start-2 min-w-0">
                    <FighterHero side={fight.f1} align="left" bonuses={fight.bonuses} result={result} portrait={portraits} onPortraitError={portraitUnavailable} reserveRank={reserveRank} />
                  </div>
                  <div className="matchup-market self-start col-start-2 row-start-2 flex w-auto flex-col items-center text-center @[58rem]:self-center @[58rem]:max-w-[19rem]">
                    <div className="matchup-prices">
                      <MatchupOdds key={fight.id} f1={fight.odds?.f1.close} f2={fight.odds?.f2.close}
                        f1Open={fight.odds?.f1.open} f2Open={fight.odds?.f2.open}
                        f1Name={fight.f1.name} f2Name={fight.f2.name}
                        props={fight.odds?.props}
                        fightId={fight.status === "upcoming" ? fight.id : undefined} />
                    </div>
                  </div>
                  <div className="col-start-3 row-start-2 min-w-0">
                    <FighterHero side={fight.f2} align="right" bonuses={fight.bonuses} result={result} portrait={portraits} onPortraitError={portraitUnavailable} reserveRank={reserveRank} />
                  </div>
                </div>

              </div>
            </section>
            </div>

            {tabs.length > 1 ? (
              <div className="sticky top-0 z-20 -mt-3 bg-zinc-100 pt-3">
                {/* The same segmented control the sidebar filters use, on the
                    same white panel it sits on there. */}
                <div className={`${shell} p-1.5`}>
                  <MatchupTabs tabs={tabs} current={tab} onSelect={selectTab} />
                </div>
              </div>
            ) : null}

            <div id="matchup-tabpanel" role={tabs.length > 1 ? "tabpanel" : undefined} aria-labelledby={tabs.length > 1 ? `matchup-tab-${tab}` : undefined} className="flex flex-col gap-3">
              {tab === "fight" ? <>
                <Scorecards fight={fight} />
                {hasStats ? <FightStatistics fight={fight} live={statsLive} /> : fight.in_progress ? (
                  <div className={`${shell} flex items-center justify-center gap-2 px-5 py-10 text-sm text-zinc-500`} role="status">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    Fight Live, results will appear soon
                  </div>
                ) : (
                  <div className={`${shell} px-5 py-4 text-xs text-zinc-500`} role="status">
                    Result confirmed. Detailed statistics are still being published{isFightDay(fight.event.date) ? " — checking automatically." : "."}
                  </div>
                )}
              </> : null}
              {tab === "matchup" ? <>
                <section className={`matchup-overview @container overflow-hidden ${shell}`}>
                  <PanelHeading title="Tale of the tape" />
                  <div className="matchup-comparisons grid px-5 pb-3">
                    <TaleOfTape fight={fight} compact />
                    <MatchupContext fight={fight} />
                  </div>
                </section>
                <RecentForm fight={fight} />
                <CareerProfile fight={fight} />
                <HeadToHead fight={fight} />
                <HeadToHead fight={fight} later />
                <CommonOpponents fight={fight} />
              </> : null}
              {tab === "odds" ? <OddsPanel fight={fight} /> : null}
              {tab === "score" ? <FightScoring key={fight.id} fight={fight} /> : null}
              {tab === "predict" ? <FightPredictions key={fight.id} fight={fight} /> : null}
              {tab === "discussion" ? (
                <Suspense fallback={<div className={`${shell} p-5 text-sm text-zinc-500`} role="status">Loading discussion…</div>}>
                  <FightDiscussion key={fight.id} fightId={fight.id} />
                </Suspense>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

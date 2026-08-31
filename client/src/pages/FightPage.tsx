import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../api";
import type { EventDetail, FightDetailBlock, HistoryRow, Matchup, MatchupSide } from "../api";
import {
  formatDate,
  formatDateShortWithYear,
  formatMethod,
  lastName,
  outcomeClasses,
  rankLabel,
} from "../format";
import Avatar from "../components/Avatar";
import BonusIcons from "../components/BonusIcons";
import OddsPair from "../components/OddsPair";
import {
  CHART_TEXT,
  FightStatistics,
  Legend,
  MatchupStats,
  PANEL_SHELL,
  PanelEmpty,
  PanelHeading,
  Scorecards,
  TaleOfTape,
} from "../components/FightStats";
import { useSeo } from "../seo";

const shell = PANEL_SHELL;
const RESULT_PILL =
  "inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase leading-4 tracking-[0.08em]";

/** Which belt is on the line. Only the fight-details page names the interim
 *  one — the event page shows the same plain belt icon for both — so fall back
 *  to the event flag while the detail is still loading. */
function beltOf(fight: Matchup): "title" | "interim" | "tuf" | "tournament" | null {
  return fight.detail?.titleBout ?? (fight.title_fight ? "title" : null);
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
}: {
  side: MatchupSide;
  align: "left" | "right";
  bonuses: FightDetailBlock["bonuses"] | undefined;
  result?: string | null;
}) {
  const rank = rankLabel(side.ranking);
  const showResult = side.outcome ? RESULT_PREFIX[side.outcome] : undefined;
  return (
    <Link
      to={`/fighters/${side.id}`}
      className={`group flex min-w-0 flex-col items-center gap-3 text-center @[42rem]:gap-4 ${
        align === "right"
          ? "@[42rem]:flex-row-reverse @[42rem]:text-right"
          : "@[42rem]:flex-row @[42rem]:text-left"
      }`}
    >
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <Avatar src={side.photo_url} name={side.name} size="lg" outcome={side.outcome} />
        {result && showResult ? (
          <span
            className={`${RESULT_PILL} whitespace-nowrap tabular-nums ${outcomeClasses(side.outcome)}`}
          >
            <span className="sr-only">{RESULT_PREFIX[side.outcome ?? ""] ?? ""}</span>
            {result}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <div
          className={`flex items-baseline justify-center gap-2 ${
            align === "right" ? "@[42rem]:justify-end" : "@[42rem]:justify-start"
          }`}
        >
          {align === "right" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
          {align === "left" ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-f1" /> : null}
          <span className="truncate text-lg font-semibold tracking-tight text-zinc-950 group-hover:underline lg:text-xl">
            {side.name}
          </span>
          {align === "right" ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-f2" /> : null}
          {align === "left" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        </div>
        {side.nickname ? <div className="truncate text-xs text-zinc-400">“{side.nickname}”</div> : null}
        {/* Name, nickname, rank, record — one per line. Alignment is inherited
            from the link, so neither side needs its own justification. */}
        <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
          {rank && side.ranking ? (
            <div className="truncate">
              {rank} {side.ranking.division}
            </div>
          ) : null}
          <div className="truncate tabular-nums">{side.record}</div>
        </div>
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
      className="group flex min-h-24 min-w-0 flex-col items-center justify-center gap-1.5 px-1 py-2.5 text-center transition-colors hover:bg-zinc-50/80 focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
    >
      <span
        className={`flex min-h-6 items-center justify-center px-0.5 text-[10px] font-bold leading-3.5 [overflow-wrap:anywhere] group-hover:underline ${formOutcomeClass(row.outcome)}`}
      >
        {opponent}
      </span>
      <span className="block">
        <OutcomePill outcome={row.outcome} />
      </span>
      <span className={`block w-full truncate ${CHART_TEXT} font-semibold leading-4 text-zinc-600`}>
        {method || "Method unavailable"}
      </span>
      <span className="block whitespace-nowrap text-[9px] leading-3 text-zinc-400 tabular-nums">
        {formatDateShortWithYear(row.date)}
      </span>
    </Link>
  );
}

function FormTimeline({ fight, f1, f2 }: { fight: Matchup; f1: HistoryRow[]; f2: HistoryRow[] }) {
  // Both histories point toward the middle, putting each fighter's most
  // recent bout on either side of the center rule.
  const leftRows = [...f1].reverse();
  const left: (HistoryRow | null)[] = [
    ...Array<null>(FORM_LIMIT - leftRows.length).fill(null),
    ...leftRows,
  ];
  const right: (HistoryRow | null)[] = [...f2, ...Array<null>(FORM_LIMIT - f2.length).fill(null)];

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 border-b border-zinc-100">
        <div className="flex min-w-0 justify-end px-3 py-2">
          <span className={`flex items-center gap-1.5 ${CHART_TEXT} font-semibold text-f1-ink`}>
            <span className="h-2 w-2 rounded-full bg-f1" />
            {lastName(fight.f1.name)}
          </span>
        </div>
        <div className="flex min-w-0 justify-start border-l border-zinc-200 px-3 py-2">
          <span className={`flex items-center gap-1.5 ${CHART_TEXT} font-semibold text-f2-ink`}>
            <span className="h-2 w-2 rounded-full bg-f2" />
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
              className={`flex min-h-24 items-center justify-center ${CHART_TEXT} text-zinc-300 ${
                index === FORM_LIMIT ? "border-l border-zinc-200" : ""
              }`}
            >
              —
            </div>
          ),
        )}
      </div>
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
      <PanelHeading
        title={fight.status === "past" ? "Form going in" : "Recent form"}
        subtitle={rows ? "Last five UFC bouts before fight night (center = most recent)" : undefined}
      />
      {rows === 0 ? (
        <PanelEmpty>No UFC fights on record.</PanelEmpty>
      ) : (
        <div>
          <FormTimeline key={fight.id} fight={fight} f1={f1} f2={f2} />
        </div>
      )}
    </section>
  );
}

function HeadToHead({ fight }: { fight: Matchup }) {
  const meetings = fight.head_to_head;
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
        title="Previous meetings"
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
  const shared = fight.common_opponents;
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

function FightRail({ eventId, currentId }: { eventId: string; currentId: string }) {
  const { data: event } = useApi<EventDetail>(`/api/events/${eventId}`);
  if (!event || event.fights.length < 2) return null;
  return (
    <aside className={`hidden w-40 shrink-0 flex-col overflow-hidden sm:flex lg:w-48 ${shell}`}>
      <div className="border-b border-zinc-200 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Card
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto p-1.5">
        {event.fights.map((f) => {
          const isCurrent = f.id === currentId;
          return (
            <Link
              key={f.id}
              to={`/fights/${f.id}`}
              state={{ eventId }}
              title={`${f.f1.name} vs ${f.f2.name}`}
              className={[
                "grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1 rounded-xl border px-1.5 py-2.5 transition-colors",
                isCurrent
                  ? "border-zinc-900 bg-zinc-900"
                  : "border-transparent bg-zinc-50 hover:border-zinc-200 hover:bg-zinc-100",
              ].join(" ")}
            >
              <span className="flex min-w-0 flex-col items-center gap-1">
                <Avatar src={f.f1.photo_url} name={f.f1.name} size="matchup" outcome={f.f1.outcome} />
                <span
                  className={`w-full truncate text-center text-[10px] font-semibold leading-tight ${isCurrent ? "text-white/90" : "text-zinc-600"}`}
                >
                  {lastName(f.f1.name)}
                </span>
              </span>
              <span
                className={`mt-6 text-[8px] font-semibold uppercase lg:mt-7 ${isCurrent ? "text-white/50" : "text-zinc-300"}`}
              >
                vs
              </span>
              <span className="flex min-w-0 flex-col items-center gap-1">
                <Avatar src={f.f2.photo_url} name={f.f2.name} size="matchup" outcome={f.f2.outcome} />
                <span
                  className={`w-full truncate text-center text-[10px] font-semibold leading-tight ${isCurrent ? "text-white/90" : "text-zinc-600"}`}
                >
                  {lastName(f.f2.name)}
                </span>
              </span>
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
  const navigate = useNavigate();
  const { data: loadedFight, loading, error } = useApi<Matchup>(`/api/fights/${fightId}`);
  const previousFight = useRef<Matchup | null>(null);
  const detailScroll = useRef<HTMLDivElement>(null);
  if (loadedFight) previousFight.current = loadedFight;
  const fight = loadedFight ?? previousFight.current;
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

  useEffect(() => {
    if (detailScroll.current) detailScroll.current.scrollTop = 0;
  }, [fightId]);

  // Escape closes the matchup back to its event card (browser-back while the
  // matchup is still loading and the event isn't known yet).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (eventId) navigate(`/events/${eventId}`);
      else navigate(-1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [eventId, navigate]);

  if (loading && !fight) {
    return (
      <div className="flex h-full min-h-0 gap-3">
        {eventId ? <FightRail eventId={eventId} currentId={fightId} /> : null}
        <div className={`flex min-w-0 flex-1 items-center justify-center ${shell}`}>
          <div className="text-sm text-zinc-400">Loading matchup…</div>
        </div>
      </div>
    );
  }
  if (error || !fight) {
    return (
      <div className="flex h-full min-h-0 gap-3">
        {eventId ? <FightRail eventId={eventId} currentId={fightId} /> : null}
        <div className={`flex min-w-0 flex-1 items-center justify-center ${shell}`}>
          <div className="text-sm text-zinc-400">Matchup not found.</div>
        </div>
      </div>
    );
  }

  const detail: FightDetailBlock | null = fight.detail;
  const result = fight.status === "past" ? resultSummary(fight) : null;
  const referee = fight.detail?.methodInfo?.["Referee"];
  const changingMatchup = loading && !loadedFight;

  return (
    <div className="flex h-full min-h-0 gap-3">
      <FightRail eventId={eventId ?? fight.event.id} currentId={fightId} />

      <div className="relative min-h-0 min-w-0 flex-1">
        {changingMatchup ? (
          <div className="absolute inset-0 z-30 flex cursor-wait items-start justify-center bg-zinc-100/50 pt-6 backdrop-blur-[1px]">
            <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm">
              Loading matchup…
            </span>
          </div>
        ) : null}
        <div ref={detailScroll} className="h-full overflow-y-auto">
          <div className="@container flex w-full flex-col gap-3 pb-8">
            <section className={`@container overflow-hidden ${shell}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3.5">
                <Link
                  to={`/events/${fight.event.id}`}
                  className="text-sm font-semibold text-zinc-900 underline-offset-2 hover:underline"
                >
                  {fight.event.name}
                </Link>
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-zinc-500">
                  <span>{formatDate(fight.event.date)}</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/events/${fight.event.id}`)}
                    aria-label="Close matchup and return to event"
                    title="Close matchup (esc)"
                    className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 pl-3 pr-2 font-semibold text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                  >
                    <span>Close</span>
                    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                      <path
                        d="m5 5 6 6m0-6-6 6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-5 py-5">
                <div className="grid grid-cols-2 items-start gap-4 @[42rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @[42rem]:items-center">
                <div className="col-start-1 row-start-1 min-w-0">
                  <FighterHero side={fight.f1} align="left" bonuses={fight.bonuses} result={result} />
                </div>
                <div className="col-span-2 col-start-1 row-start-2 flex w-full max-w-full flex-col items-center text-center @[42rem]:col-span-1 @[42rem]:col-start-2 @[42rem]:row-start-1 @[42rem]:w-64">
                  {fight.odds?.f1.close || fight.odds?.f2.close ? (
                    <div className="mb-3">
                      <OddsPair f1={fight.odds?.f1.close} f2={fight.odds?.f2.close} />
                    </div>
                  ) : null}
                  <WeightClassLabel fight={fight} />
                  {referee ? <div className="mt-1 text-[10px] text-zinc-400">Ref {referee}</div> : null}
                  <div className="mt-4 w-full">
                    <TaleOfTape fight={fight} />
                  </div>
                </div>
                <div className="col-start-2 row-start-1 min-w-0 @[42rem]:col-start-3">
                  <FighterHero side={fight.f2} align="right" bonuses={fight.bonuses} result={result} />
                </div>
                </div>
                {fight.status === "past" ? <MatchupResult fight={fight} /> : null}
              </div>
            </section>

            {fight.status !== "past" ? <MatchupStats fight={fight} /> : null}

            {/* Completed-fight totals and rounds share one collapsible card;
                physical context now lives in the matchup hero above. */}
            <RecentForm fight={fight} />
            {fight.status === "past" && detail?.type === "past" && (detail.totals || detail.sigStrikes) ? (
              <FightStatistics fight={fight} />
            ) : null}

            <HeadToHead fight={fight} />
            <CommonOpponents fight={fight} />
          </div>
        </div>
      </div>
    </div>
  );
}

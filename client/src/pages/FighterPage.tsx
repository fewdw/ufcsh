import FighterCareerStats from "../components/FighterCareerStats";
import { DecisionsPanel, RoundsPanel, StrikesPanel } from "../components/FightInsights";
import { CareerStatModal } from "../components/CareerStatDetails";
import { Children, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api";
import type { AntidopingYear, CompleteRecordBefore, FighterAward, FighterProfile, FighterRecord, HistoryRow, NewsPage, ProfessionalHistoryRow, ProfileCancelledBout } from "../api";
import { divisionName, finishDetail, formatDateShortWithYear, formatLine, formatMethod, isDecision, lastName } from "../format";
import { formatValue, PANEL } from "../components/chartTokens";
import FighterPortrait from "../components/FighterPortrait";
import Flag from "../components/Flag";
import ResultDots from "../components/ResultDots";
import { divisionMoves, type DivisionMove } from "../weightJourney";
import { rankingsLink } from "../divisionOrder";
import RequestNotice from "../components/RequestNotice";
import { BONUS_AGAINST_TAG, BONUS_TAG, FIGHT_BONUS, PERF_AWARD } from "../bonus";
import FighterStatistics from "../components/FighterStatistics";
import RankingHistory from "../components/RankingHistory";
import { fetchPage, LoadMore, useInfiniteList } from "../components/InfiniteList";
import NewsRow, { savedOff, savedSummaries } from "../components/NewsRow";
import { PanelHeading } from "../components/FightStats";
import { SITE_URL, useSeo } from "../seo";
import { useRememberedState, useRouteScrollRestoration, useTabBarAnchor } from "../navigationState";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "../components/segmented";
import { outsideFighterUrl, useSettings, withRanking } from "../settings";
import { careerBands, fightProgram, type CareerBand } from "../fighterTimeline";

const shell = PANEL;

function historyResultLabel(outcome: HistoryRow["outcome"]): string {
  switch (outcome) {
    case "win": return "Win";
    case "loss": return "Loss";
    case "draw": return "Draw";
    case "nc": return "No Contest";
    default: return "RESULT";
  }
}

/** The result, compressed to one letter in a small dot — a full "WIN"/
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

/** Finishes use deep colours; decisions use light colours, all with white letters. */
function resultBadgeClasses(outcome: HistoryRow["outcome"], upcoming: boolean, method: string | null): string {
  if (upcoming) return "bg-sky-100 text-sky-700";
  const decision = isDecision(method);
  switch (outcome) {
    case "win": return decision ? "bg-emerald-400 text-white" : "bg-emerald-800 text-white";
    case "loss": return decision ? "bg-rose-300 text-white" : "bg-rose-800 text-white";
    case "draw": return decision ? "bg-amber-300 text-white" : "bg-amber-700 text-white";
    case "nc": return "bg-zinc-400 text-white";
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
    { key: "draw", label: "Draws", one: "Draw", color: "#f59e0b", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "draw" },
    { key: "nc", label: "No contests", one: "No contest", color: "#71717a", match: (fight: HistoryRow | ProfessionalHistoryRow) => fight.outcome === "nc" },
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
      {bouts.length ? <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
        <div
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full sm:h-20 sm:w-20"
          style={{ background: `conic-gradient(from 0deg, ${gradient})` }}
          role="img"
          aria-label={`${bouts.length} ${scope === "ufc" ? "UFC" : "professional"} bouts by result and method`}
        >
          <div className="grid h-10 w-10 place-items-center rounded-full bg-white text-center shadow-[0_0_0_1px_rgba(0,0,0,0.04)] sm:h-12 sm:w-12">
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
                  <span>{segment.count} {segment.count === 1 ? segment.one : segment.label}</span>
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

/** Rows of bouts. A container, not a viewport breakpoint: this list shares the
 *  page with a second column from `lg` up, so how much room a bout actually has
 *  is not something the window width can answer. The divider carries more of
 *  the load at card width, where it is the only line marking where one ends. */
const BOUT_LIST = "@container divide-y divide-zinc-100 pb-2 @3xl:divide-zinc-50";

/** Yearly awards (Sherdog Year-End Awards), newest first. One won in a bout on
 *  record opens that matchup; one won elsewhere names the promotion. */
function FighterAwards({ awards }: { awards: FighterAward[] }) {
  return (
    <div className="border-t border-zinc-100 pt-3 sm:pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Awards</h2>
        <Link to="/awards" className="text-[11px] text-zinc-400 transition hover:text-zinc-700">All awards</Link>
      </div>
      <ul className="mt-1.5 grid gap-x-4 gap-y-1 @[40rem]:grid-cols-2">
        {awards.map((award) => {
          const against = award.opponent ? `vs. ${award.opponent}` : null;
          return (
            <li key={`${award.category}-${award.period}`} className="flex min-w-0 items-baseline gap-2">
              <span className="w-8 shrink-0 text-[11px] tabular-nums text-zinc-400">{award.period}</span>
              <span className="min-w-0 text-[13px] font-medium text-zinc-800">
                {award.label}
                {against || award.org ? <span className="text-[11px] font-normal text-zinc-400">
                  {against ? <> {award.fight_id ? <Link to={`/fights/${award.fight_id}`} className="hover:text-zinc-700 hover:underline">{against}</Link> : against}</> : null}
                  {award.org ? ` (${award.org})` : null}
                </span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Test sessions a year under the UFC Anti-Doping Program, oldest first; the
 *  current year is counted so far. */
function FighterTests({ years }: { years: AntidopingYear[] }) {
  const thisYear = new Date().getFullYear();
  const total = years.reduce((sum, row) => sum + row.tests, 0);
  return (
    <section className={shell}>
      <PanelHeading title="Drug tests" subtitle={total.toLocaleString()}
        aside={<a href="https://ufcantidoping.com/tests" target="_blank" rel="noreferrer" className="text-[11px] text-zinc-400 transition hover:text-zinc-700">UFC Anti-Doping</a>} />
      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
        {years.map((row) => (
          <li key={row.year} className="flex flex-col items-center" title={`${row.tests} test ${row.tests === 1 ? "session" : "sessions"} in ${row.year}${row.year === thisYear ? " so far" : ""}`}>
            <span className="text-sm font-semibold tabular-nums text-zinc-900">{row.tests}</span>
            <span className="text-[11px] tabular-nums text-zinc-400">{row.year}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The awards this fighter took home, which the result line does not say, and
 *  in red the performance award the opponent earned on them. */
function BoutNotes({ row, className = "mt-1" }: { row: HistoryRow | ProfessionalHistoryRow; className?: string }) {
  const perf = row.bonuses?.perf ? PERF_AWARD[row.bonuses.perf] : null;
  const against = row.bonuses?.perf_against ? PERF_AWARD[row.bonuses.perf_against] : null;
  if (!perf && !against && !row.bonuses?.fotn) return null;
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {row.bonuses?.fotn ? <span className={BONUS_TAG} title={`${FIGHT_BONUS.full} bonus`}>{FIGHT_BONUS.short}</span> : null}
      {perf ? <span className={BONUS_TAG} title={`${perf.full} bonus`}>{perf.short}</span> : null}
      {against ? <span className={BONUS_AGAINST_TAG} title={`${against.full} bonus for the opponent`}>{against.short}</span> : null}
    </span>
  );
}

/** Whoever came in over the limit, said beside the division they missed. */
function weightMisses(row: HistoryRow | ProfessionalHistoryRow) {
  return [
    { who: "Missed weight", name: "This fighter", pounds: row.weight_miss?.fighter },
    { who: `${lastName(row.opponent.name)} missed weight`, name: row.opponent.name, pounds: row.weight_miss?.opponent },
  ].filter((miss) => miss.pounds != null).map((miss) => (
    <span key={miss.who} className="font-semibold text-rose-700" title={`${miss.name} missed weight${miss.pounds ? ` at ${miss.pounds} lb` : ""}`}>
      {miss.who}{miss.pounds ? ` · ${miss.pounds} lb` : ""}
    </span>
  ));
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
  const odds = row.upcoming ? row.current_odds : row.closing_odds;
  return {
    result: row.upcoming ? "Upcoming" : historyResultLabel(row.outcome),
    method: (row.upcoming ? "Scheduled" : formatMethod(row.method, row.round, row.time)) || "Result pending",
    detail: row.upcoming ? "" : finishDetail(row.method_detail),
    fighterOdds: formatLine(odds?.fighter),
    opponentOdds: formatLine(odds?.opponent),
    oddsLabel: row.upcoming ? "current odds" : "closing odds",
    outside,
    contender: fightProgram(row.event_name) === "Contender Series",
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

function PromotionLabel({ row, move, short, rank }: { row: HistoryRow | ProfessionalHistoryRow; move?: DivisionMove; short?: boolean; rank?: HistoryRow["rank"] }) {
  const program = row.title_type === "tuf" ? "TUF" : fightProgram(row.event_name);
  if (program) return <>{program === "TUF" && row.promotion !== "outside" ? <><DivisionLabel division={divisionName(row.weight_class, row.catch_weight)} move={move} short={short} rank={rank} /> · </> : null}<span className={`font-semibold ${program === "TUF" ? "text-amber-700 dark:text-amber-300" : "text-cyan-700 dark:text-cyan-300"}`}
    title={program === "TUF" ? "The Ultimate Fighter event; this label does not imply the fighter competed on the show."
      : `${program} appearance; participation or a win alone does not confirm a UFC contract.`}>
    {program === "TUF" && row.title_type === "tuf" ? "TUF final" : program === "TUF" && /\bfinale\b/i.test(row.event_name) ? "TUF finale" : program}
  </span></>;
  return row.promotion === "outside" ? <span className="font-semibold text-violet-500">Outside UFC</span>
    : <DivisionLabel division={divisionName(row.weight_class, row.catch_weight)} move={move} short={short} rank={rank} />;
}

function RosterBand({ band }: { band: CareerBand }) {
  const content = <><span>{band.label}</span>{band.date ? <span className="font-normal opacity-75">{band.observed ? "Observed " : ""}{formatDateShortWithYear(band.date)}</span> : null}</>;
  const className = `flex min-h-12 flex-wrap items-center justify-center gap-x-2 px-4 py-3 text-sm font-semibold leading-6 @3xl:min-h-9 @3xl:py-1.5 ${band.signing
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : "bg-zinc-50 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300"}`;
  return <div className={className} title={band.detail}>{content}<span className="sr-only">{band.detail}</span></div>;
}

/** The bout's division, said as a move when it differs from the last one. */
const DIVISION_SHORT: Record<string, string> = {
  Strawweight: "SW", Flyweight: "FLW", Bantamweight: "BW", Featherweight: "FW", Lightweight: "LW",
  Welterweight: "WW", Middleweight: "MW", "Light Heavyweight": "LHW", Heavyweight: "HW",
};

/** A rank held going into a bout: "C", "IC" or "#4", nothing when unranked.
 *  A rank from another division names it ("C FW" on a lightweight bout). */
function RankTag({ ranking, who, division }: { ranking: HistoryRow["rank"]; who: string; division: string }) {
  if (!ranking) return null;
  const elsewhere = ranking.division !== division
    ? ` ${ranking.division.startsWith("Women's") ? "W" : ""}${DIVISION_SHORT[ranking.division.replace("Women's ", "")] ?? ranking.division}` : "";
  const label = `${ranking.rank === "C" ? "C" : ranking.rank === "IC" ? "IC" : `#${ranking.rank}`}${elsewhere}`;
  const held = ranking.rank === "C" ? "Champion" : ranking.rank === "IC" ? "Interim champion" : `#${ranking.rank}`;
  return (
    <span className={`shrink-0 whitespace-nowrap text-[11px] font-semibold tabular-nums ${ranking.rank === "C" ? "text-belt" : ranking.rank === "IC" ? "text-belt-interim" : "text-zinc-500"}`}
      title={`${who}: ${held} · ${ranking.division}, going into this fight`}>{label}</span>
  );
}

/** The bout's division, "↑ Up to Lightweight" for a move. In the table
 *  (`short`) it carries the rank held there ("Featherweight Champ",
 *  "Featherweight (Ranked #10)"), and a move takes a line of its own above
 *  it ("↓ Moved down"), so neither is left hanging when the column wraps. */
function DivisionLabel({ division, move, short, rank }: { division: string; move?: DivisionMove; short?: boolean; rank?: HistoryRow["rank"] }) {
  const words = move ? `${move.direction === "up" ? "↑ Up to" : "↓ Down to"} ` : "";
  if (!short) return move ? <span className="font-semibold text-zinc-700">{words}{move.to}</span> : <span>{division}</span>;
  if (!move) return <DivisionRank division={division} ranking={rank} />;
  return <>
    <span className="block font-semibold text-zinc-700">{move.direction === "up" ? "↑ Moved up" : "↓ Moved down"}</span>
    <span className="block"><DivisionRank division={division} ranking={rank} /></span>
  </>;
}

/** A division with the rank held in it: "Featherweight Champ" in gold,
 *  "Featherweight (Ranked #10)". "Women's" is left off, since every bout on a
 *  woman's profile shares it (still in the tooltip and for screen readers). */
function DivisionRank({ division, ranking }: { division: string; ranking?: HistoryRow["rank"] }) {
  const women = division.startsWith("Women's ");
  const name = women ? <><span className="sr-only">Women's </span>{division.slice(8)}</> : division;
  const champ = ranking?.rank === "C" ? "Champ" : ranking?.rank === "IC" ? "Interim Champ" : null;
  const title = [women ? division : null, ranking ? "going into this fight" : null].filter(Boolean).join(", ") || undefined;
  if (champ) {
    return <span className={`font-semibold ${ranking!.rank === "C" ? "text-belt" : "text-belt-interim"}`} title={title}>
      <span className="whitespace-nowrap">{name}</span> <span className="whitespace-nowrap">{champ}</span>
    </span>;
  }
  return <span title={title}>
    <span className="whitespace-nowrap">{name}</span>
    {ranking ? <> <span className="whitespace-nowrap font-semibold text-zinc-500 tabular-nums">(Ranked #{ranking.rank})</span></> : null}
  </span>;
}

/** A rank held in another division than the bout's, on a line under it:
 *  "Featherweight Champ" while fighting at lightweight. */
function RankElsewhere({ ranking }: { ranking: NonNullable<HistoryRow["rank"]> }) {
  return <span className="mt-0.5 block leading-4"><DivisionRank division={ranking.division} ranking={ranking} /></span>;
}

function DivisionCell({ to, className, children }: { to: string | null; className: string; children: ReactNode }) {
  return to ? <Link to={to} title="Open rankings" className={`${className} ${HIT}`}>{children}</Link> : <div className={className}>{children}</div>;
}

const HIT = "transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

/** A bout packed into three bands (who, how, where) for narrow screens, where
 *  the full table would not fit. Each band is its own target and runs the full
 *  width of the row, edge to edge with its neighbours, so a thumb anywhere on
 *  the row lands on one of the three and never in a gap between them. The
 *  lower two are indented past the result badge, lining their text up under
 *  the opponent's name. */
const BAND = "flex min-w-0 px-4 transition-colors hover:bg-zinc-50 active:bg-zinc-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900";
const BAND_INDENT = "pl-[3.125rem]";

function BoutCard({ row, fighterName, move }: { row: HistoryRow | ProfessionalHistoryRow; fighterName: string; move?: DivisionMove }) {
  const bout = boutFields(row);
  return (
    <div className="flex flex-col py-1.5 @3xl:hidden">
      <BoutLink
        to={bout.opponentTo}
        href={bout.opponentHref}
        label={`Open ${row.opponent.name} profile`}
        className={`${BAND} items-center gap-2.5 py-1.5`}
      >
        <span
          className={`grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1 text-[10px] font-bold leading-none ${resultBadgeClasses(row.outcome, row.upcoming, row.method)}`}
          title={bout.result}
          aria-hidden="true"
        >
          {resultBadgeLetter(row.outcome, row.upcoming)}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-words text-[15px] font-semibold leading-6 text-zinc-900">{row.opponent.name}</span>
          {"opponent_rank" in row ? <RankTag ranking={row.opponent_rank} who={row.opponent.name} division={row.weight_class} /> : null}
          {/* Both closing lines are here, and position is what says whose is
              whose: the opponent's sits against their name, the fighter's on the
              line about their own result. Neither number can be read off as the
              other's, so each also carries the name in a tooltip and spells the
              whole thing out for a screen reader. */}
          {bout.opponentOdds ? (
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-400" title={`${row.opponent.name} ${bout.oddsLabel}`}>
              <span className="sr-only">{row.opponent.name} {bout.oddsLabel} </span>{bout.opponentOdds}
            </span>
          ) : null}
          {row.opponent_form ? <OpponentForm form={row.opponent_form} /> : null}
          <EnteringRecords career={row.opponent_career_record_before} ufc={row.opponent_record_before} name={row.opponent.name} className="basis-full text-[10px] font-semibold leading-4 text-zinc-500" />
        </span>
      </BoutLink>

      <BoutLink
        to={bout.fightTo}
        href={bout.fightHref}
        label={`Open ${row.opponent.name} matchup`}
        className={`${BAND} ${BAND_INDENT} items-baseline py-1.5 text-xs leading-5 text-zinc-500`}
      >
        <span className="sr-only">{bout.result}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center">
          <FactRun>
            <span className="font-medium">{bout.method}</span>
            {bout.detail ? <span>{bout.detail}</span> : null}
            {bout.contender ? null : <PromotionLabel row={row} move={move} />}
            {"rank" in row && row.rank ? <RankTag ranking={row.rank} who={fighterName} division={row.weight_class} /> : null}
            {row.title_narrative ? <span className={`font-semibold ${bout.narrativeClass}`}>{row.title_narrative}</span> : null}
            {weightMisses(row)}
            {/* The awards belong to the fight, so they close its run rather
                than take a line of their own that no tap would reach. */}
            {row.bonuses?.fotn || row.bonuses?.perf || row.bonuses?.perf_against ? <BoutNotes row={row} className="inline-flex align-middle" /> : null}
          </FactRun>
        </span>
        {/* Out of the run and against the right edge, where it lines up with
            the date below and with every other price down the list — and where
            a long run wrapping cannot strand it alone on a line of its own.
            The fighter's own records entering the bout sit under the price. */}
        <span className="flex shrink-0 flex-col items-end pl-2">
          {bout.fighterOdds ? (
            <span className="font-semibold tabular-nums text-zinc-400" title={`${fighterName} ${bout.oddsLabel}`}>
              <span className="sr-only">{fighterName} {bout.oddsLabel} </span>{bout.fighterOdds}
            </span>
          ) : null}
          <EnteringRecords career={row.career_record_before} ufc={row.record_before} name={fighterName} className="justify-end text-[10px] font-medium leading-4 text-zinc-400" />
        </span>
      </BoutLink>

      <BoutLink
        to={bout.eventTo}
        href={bout.eventHref}
        label={`Open ${row.event_name}`}
        className={`${BAND} ${BAND_INDENT} items-baseline gap-x-2 py-1.5`}
      >
        {/* The name takes the slack, so every date in the list lands on the
            same right edge and the column of dates can be read straight down. */}
        <span className={`min-w-0 flex-1 break-words text-xs leading-5 ${bout.contender ? "text-cyan-700 dark:text-cyan-300" : "text-zinc-600"}`}>{row.event_name}</span>
        <span className="shrink-0 text-[11px] leading-5 tabular-nums text-zinc-400">{formatDateShortWithYear(row.date)}</span>
      </BoutLink>
    </div>
  );
}

/** The same bout as a row of four columns, once the list is wider than the
 *  46rem they need. Each column is its own hit target, as the card's lines are. */
function BoutTableRow({ row, fighterName, move }: { row: HistoryRow | ProfessionalHistoryRow; fighterName: string; move?: DivisionMove }) {
  const bout = boutFields(row);
  const cell = "hidden min-w-0 px-3 py-2.5 @3xl:flex";
  const rank = "rank" in row ? row.rank : null;
  const ownRank = rank && rank.division === row.weight_class ? rank : null;
  const otherRank = rank && rank.division !== row.weight_class ? rank : null;
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
            className={`grid h-7 min-w-7 shrink-0 place-items-center self-center rounded-full px-1 text-[11px] font-bold leading-none ${resultBadgeClasses(row.outcome, row.upcoming, row.method)}`}
            title={bout.result}
            aria-hidden="true"
          >
            {resultBadgeLetter(row.outcome, row.upcoming)}
          </span>
          <span className="sr-only">{bout.result}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="min-w-0 flex-1 text-[11px] font-medium leading-5 text-zinc-500 [overflow-wrap:anywhere]">{bout.method}</span>
              {bout.fighterOdds ? <span className="shrink-0 text-[10px] font-semibold tabular-nums text-zinc-400" title={`${fighterName} ${bout.oddsLabel}`}>{bout.fighterOdds}</span> : null}
            </span>
            {bout.detail ? <span className="block text-[11px] leading-4 text-zinc-500 [overflow-wrap:anywhere]">{bout.detail}</span> : null}
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
            {"opponent_rank" in row ? <RankTag ranking={row.opponent_rank} who={row.opponent.name} division={row.weight_class} /> : null}
            {bout.opponentOdds ? <span className="shrink-0 text-[10px] font-semibold tabular-nums text-zinc-400" title={`${row.opponent.name} ${bout.oddsLabel}`}>{bout.opponentOdds}</span> : null}
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <EnteringRecords career={row.opponent_career_record_before} ufc={row.opponent_record_before} name={row.opponent.name} className="text-[10px] font-semibold leading-4 text-zinc-500" />
            {row.opponent_form ? <OpponentForm form={row.opponent_form} /> : null}
          </span>
          <BoutNotes row={row} />
        </span>
      </BoutLink>

      {/* A ranked division opens the rankings at its list. */}
      <DivisionCell to={bout.outside ? null : rankingsLink(row.weight_class)} className={`${cell} flex-col justify-start border-l border-zinc-100 text-left`}>
        {/* One line each: the division with the rank held there, the title
            story, then any rank held in another division. */}
        <span className="block break-words text-[11px] leading-5 text-zinc-500">
          {bout.contender ? null : <span className="block"><PromotionLabel row={row} move={move} short rank={ownRank} /></span>}
          {row.title_narrative ? <span className={`block font-semibold leading-4 ${bout.narrativeClass}`}>{row.title_narrative}</span> : null}
          {otherRank ? <RankElsewhere ranking={otherRank} /> : null}
          {weightMisses(row).map((miss) => <span key={miss.key} className="mt-1 block leading-4">{miss}</span>)}
        </span>
      </DivisionCell>

      <BoutLink
        to={bout.eventTo}
        href={bout.eventHref}
        label={`Open ${row.event_name}`}
        className={`${cell} flex-col justify-start border-l border-zinc-100 text-right ${HIT}`}
      >
        <span className={`block break-words text-xs font-medium leading-5 ${bout.contender ? "text-cyan-700 dark:text-cyan-300" : "text-zinc-600"}`}>{row.event_name}</span>
        <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-400">{formatDateShortWithYear(row.date)}</span>
      </BoutLink>
    </>
  );
}

/** A booking that fell through, muted and in the bout list's own two shapes:
 *  who it was against, that it was cancelled (and why, when the event article
 *  says) or moved to a later card, and the card it was booked for. */
function CancelledRowView({ bout }: { bout: ProfileCancelledBout }) {
  const status = bout.moved_to ? "Moved" : "Cancelled";
  const badge = <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-zinc-100 px-1 text-[10px] font-bold leading-none text-zinc-400 @3xl:h-7 @3xl:min-w-7 @3xl:text-[11px]" title={status} aria-hidden="true">{status[0]}</span>;
  const opponentTo = bout.opponent.id ? `/fighters/${bout.opponent.id}` : null;
  const eventTo = bout.event_id ? `/events/${bout.event_id}` : null;
  // A moved bout leads to the one they had; a cancelled one to the source.
  const statusTo = bout.moved_to ? `/fights/${bout.moved_to.fight_id}` : null;
  const statusLabel = bout.moved_to ? `Open ${bout.opponent.name} matchup on ${bout.moved_to.event_name}` : `Cancelled bout with ${bout.opponent.name} on ${bout.source_url.includes("wikipedia.org") ? "Wikipedia" : "FightOdds.io"}`;
  const movedTo = bout.moved_to ? <span title={bout.moved_to.event_name}>to {formatDateShortWithYear(bout.moved_to.date)}</span> : null;
  const what = <FactRun>
    <span className="font-medium">{status}</span>
    {movedTo}
    {bout.weight_class ? <span>{bout.weight_class}</span> : null}
    {bout.reason ? <span>{bout.reason}</span> : null}
  </FactRun>;
  const cell = "hidden min-w-0 px-3 py-2.5 @3xl:flex";
  return (
    <div className="grid grid-cols-1 items-stretch text-zinc-400 @3xl:grid-cols-[13rem_minmax(11rem,1.1fr)_11rem_minmax(12rem,1.3fr)]">
      <div className="flex flex-col py-1.5 @3xl:hidden">
        <BoutLink to={opponentTo} label={`Open ${bout.opponent.name} profile`} className={`${BAND} items-center gap-2.5 py-1.5`}>
          {badge}
          <span className="min-w-0 break-words text-[15px] font-semibold leading-6 text-zinc-500">{bout.opponent.name}</span>
        </BoutLink>
        <BoutLink to={statusTo} href={bout.source_url} label={statusLabel} className={`${BAND} ${BAND_INDENT} items-baseline py-1.5 text-xs leading-5`}>
          <span className="flex min-w-0 flex-1 flex-wrap items-center">{what}</span>
        </BoutLink>
        <BoutLink to={eventTo} label={`Open ${bout.event_name}`} className={`${BAND} ${BAND_INDENT} items-baseline gap-x-2 py-1.5`}>
          <span className="min-w-0 flex-1 break-words text-xs leading-5">{bout.event_name}</span>
          <span className="shrink-0 text-[11px] leading-5 tabular-nums">{formatDateShortWithYear(bout.date)}</span>
        </BoutLink>
      </div>
      <BoutLink to={statusTo} href={bout.source_url} label={statusLabel} className={`${cell} items-center gap-2.5 ${HIT}`}>
        {badge}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-[11px] leading-5">
          <span className="font-medium">{status}</span>
          {movedTo}
          {bout.reason ? <span className="basis-full leading-4 [overflow-wrap:anywhere]">{bout.reason}</span> : null}
        </span>
      </BoutLink>
      <BoutLink to={opponentTo} label={`Open ${bout.opponent.name} profile`} className={`${cell} items-center ${HIT}`}>
        <span className="min-w-0 break-words text-sm font-semibold leading-5 text-zinc-500">{bout.opponent.name}</span>
      </BoutLink>
      <div className={`${cell} border-l border-zinc-100 text-[11px] leading-5`}>{bout.weight_class}</div>
      <BoutLink to={eventTo} label={`Open ${bout.event_name}`} className={`${cell} flex-col justify-start border-l border-zinc-100 text-right ${HIT}`}>
        <span className="block break-words text-xs font-medium leading-5">{bout.event_name}</span>
        <span className="mt-0.5 block text-[11px] tabular-nums">{formatDateShortWithYear(bout.date)}</span>
      </BoutLink>
    </div>
  );
}

/** Cancelled bouts slotted into the list by date: above any row (bout or
 *  roster band) they are newer than, below the ones on their own date. */
function withCancelled(rows: { date?: string; node: ReactNode }[], cancelled: ProfileCancelledBout[]): ReactNode[] {
  const out: ReactNode[] = [];
  let next = 0;
  for (const row of rows) {
    while (row.date && next < cancelled.length && cancelled[next].date > row.date) {
      out.push(<CancelledRowView key={`cancelled-${cancelled[next].key}`} bout={cancelled[next]} />);
      next++;
    }
    out.push(row.node);
  }
  for (const bout of cancelled.slice(next)) out.push(<CancelledRowView key={`cancelled-${bout.key}`} bout={bout} />);
  return out;
}

/** The switch in the Fights heading. Off by default: a cancelled booking is
 *  not a fight, so the list is the record until asked otherwise. */
function CancelledSwitch({ count, on, onChange }: { count: number; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      title={`${on ? "Hide" : "Show"} ${count} cancelled or moved ${count === 1 ? "booking" : "bookings"}`}
      className="-my-1 flex items-center gap-2 py-1 pl-2.5 pr-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-800">
      <span>Cancelled <span className="tabular-nums text-zinc-400">{count}</span></span>
      <span aria-hidden="true" className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-sky-500" : "bg-zinc-300"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

/**
 * One bout, in whichever shape the list it sits in has room for. Both are
 * always rendered and one is always `display: none`, which keeps it out of the
 * accessibility tree as well as off the screen — so a reader meets exactly one
 * copy of the bout, and neither shape has to bend its markup to serve the other.
 */
function HistoryRowView({ row, fighterName, move }: { row: HistoryRow | ProfessionalHistoryRow; fighterName: string; move?: DivisionMove }) {
  return (
    // The four tracks need 43rem between them, so the table waits for @3xl's
    // 48rem rather than a window width — which is what it used to key off, and
    // why it appeared at 40rem and ran straight out of the card. The result
    // track is sized to hold "KO/TKO · R5 · 1:32" and a four-figure price on
    // one line at that narrowest width, since it is the first thing read.
    <div className="grid grid-cols-1 items-stretch @3xl:grid-cols-[13rem_minmax(11rem,1.1fr)_11rem_minmax(12rem,1.3fr)]">
      <BoutCard row={row} fighterName={fighterName} move={move} />
      <BoutTableRow row={row} fighterName={fighterName} move={move} />
    </div>
  );
}

/** Top-five promotion-wide or top-three divisional placings, recomputed
 * from the fight records so they update the night someone is passed. */
function Records({ records }: { records: FighterRecord[] }) {
  if (!records.length) return null;
  const place = (record: FighterRecord) => `${record.tied ? "T" : ""}${record.rank}`;
  return (
    <section className={shell}>
      <PanelHeading title="Top Records" />
      <div className="divide-y divide-zinc-50 py-1">
        {records.map((record) => (
          <div key={`${record.key}:${record.scope}`} className="flex items-center gap-3 px-4 py-2">
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

/** Height, reach and the rest as small labelled tiles; birthplace, the one
 *  long value, takes a row of its own. */
function BioGrid({ bio, className = "" }: { bio: [string, ReactNode][]; className?: string }) {
  if (!bio.length) return null;
  const wide: Record<string, string> = { Bonuses: "col-span-full @[56rem]:col-span-2", Born: "col-span-full @[56rem]:col-span-4" };
  return (
    <dl className={`grid grid-cols-3 gap-x-4 gap-y-2.5 @[56rem]:grid-cols-6 ${className}`}>
      {bio.map(([label, value]) => (
        <div key={label} className={`min-w-0 ${wide[label] ?? ""}`} title={label === "Age" ? "Current age today" : undefined}>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</dt>
          <dd className="text-sm font-medium tabular-nums text-zinc-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Both kinds of bonus as one split tag, each half its count; a kind never
 *  won is left out. Performance bonuses given up follow in red. */
function BonusTally({ fight, perf, against }: { fight: number; perf: number; against: number }) {
  const parts = [
    { key: "fight", label: FIGHT_BONUS.short, count: fight, title: FIGHT_BONUS.full },
    { key: "perf", label: PERF_AWARD.perf.short, count: perf, title: "Performance (or Knockout / Submission) of the Night" },
  ].filter((part) => part.count > 0);
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {parts.length ? (
        <span className={`${BONUS_TAG} gap-0 px-0 text-[11px]`}>
          {parts.map((part, index) => (
            <span key={part.key} title={`${part.count} × ${part.title}`}
              className={`inline-flex items-baseline gap-1 px-2 ${index ? "border-l border-amber-400/60" : ""}`}>
              {part.label}<span className="font-bold tabular-nums">{part.count}</span>
            </span>
          ))}
        </span>
      ) : null}
      {against ? (
        <span className={`${BONUS_AGAINST_TAG} gap-1 px-2 text-[11px]`} title={`${against} × Performance bonus for the opponent`}>
          {PERF_AWARD.perf.short} against<span className="font-bold tabular-nums">{against}</span>
        </span>
      ) : null}
    </span>
  );
}

type ProfileTab = "fights" | "stats" | "records" | "news";
const TAB_LABELS: Record<ProfileTab, string> = { fights: "Fights", stats: "Stats", records: "Records", news: "News" };

/** The section switch, styled like the matchup tabs: every section on a
 *  narrow window; on a wide one the stats have a column of their own, so it
 *  only switches the other column between fights, records and news. */
function ProfileTabs({ tabs, current, onSelect, news, className }: {
  tabs: ProfileTab[]; current: ProfileTab; onSelect: (tab: ProfileTab, button: HTMLElement) => void; news: number | null; className: string;
}) {
  return (
    <div className={`${shell} p-1.5 ${className}`}>
      <div role="tablist" aria-label="Fighter sections" className={`${segmentedGroup} w-full`}>
        {tabs.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={key === current} onClick={(event) => onSelect(key, event.currentTarget)}
            className={`${segmentedTab} ${key === current ? segmentedSelected : segmentedIdle}`}>
            {TAB_LABELS[key]}{key === "news" && news != null ? ` (${news.toLocaleString()})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A page of a fighter's news, newest first, from the outlets the reader keeps on at /news. */
function newsUrl(fighterId: string, offset = 0): string {
  const off = savedOff().sort().join(",");
  return `/api/news?fighter=${fighterId}${off ? `&off=${encodeURIComponent(off)}` : ""}${offset ? `&offset=${offset}` : ""}`;
}

/** `first` is the page read with the profile for the tab's count; the rest
 *  are read as the list is scrolled. */
function FighterNews({ fighterId, name, first }: { fighterId: string; name: string; first: NewsPage | null }) {
  const list = useInfiniteList({
    resetKey: fighterId,
    load: (offset) => offset === 0 && first ? Promise.resolve(first) : fetchPage<NewsPage>(newsUrl(fighterId, offset), {}, "The news could not be loaded."),
    items: (page) => page.latest,
    itemKey: (story) => story.url,
  });
  const summaries = savedSummaries();
  return (
    <section className={shell}>
      {!list.first ? (
        list.error
          ? <div className="p-4"><RequestNotice onRetry={() => void list.retry()}>Couldn’t load the news.</RequestNotice></div>
          : <div role="status" className="appear-late px-5 py-6 text-sm text-zinc-400">Loading the news…</div>
      ) : list.items.length ? (
        <div className="px-4 sm:px-5">{list.items.map((story) => <NewsRow key={story.url} story={story} fighterId={fighterId} summaries={summaries} />)}</div>
      ) : (
        <div className="px-5 py-6 text-sm text-zinc-400">No news about {name} in the last month.</div>
      )}
      <LoadMore list={list} />
    </section>
  );
}

export default function FighterPage() {
  const { fighterId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { data: fighter, loading, error, retry } = useApi<FighterProfile>(fighterId ? withRanking(`/api/fighters/${fighterId}`, settings.rankingSource) : null,
    data => data?.refreshing ? 5_000 : 5 * 60_000);
  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("fighter:page", Boolean(fighter));
  // From `lg` the page stands still and its two columns scroll on their own.
  const mainScroll = useRouteScrollRestoration<HTMLDivElement>("fighter:main", Boolean(fighter));
  const sideScroll = useRouteScrollRestoration<HTMLDivElement>("fighter:side", Boolean(fighter));
  // Below `lg` the two columns become two tabs under the fighter.
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const tab: ProfileTab = requestedTab === "stats" || requestedTab === "records" || requestedTab === "news" ? requestedTab : "fights";
  const tabAnchor = useTabBarAnchor(fighterId ?? "", tab);
  const selectTab = (next: ProfileTab, button: HTMLElement) => {
    tabAnchor.keep(button);
    const params = new URLSearchParams(location.search);
    params.set("tab", next);
    navigate({ search: `?${params}` }, { replace: true, state: location.state });
  };
  // Read with the fighter: the tab shows how many stories there are.
  const { data: news } = useApi<NewsPage>(fighterId ? newsUrl(fighterId) : null);
  const [showCancelled, setShowCancelled] = useRememberedState("profile:showCancelled", false);
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
          url: `${SITE_URL}/fighters/${fighter.id}`,
          ...(fighter.photo_url ? { image: fighter.photo_url } : {}),
        }
      : undefined,
  });

  const statModal = <CareerStatModal fighters={fighterId ? [{ id: fighterId, name: fighter?.name ?? "" }] : []} />;

  if (loading && !fighter) {
    return <>{statModal}<div role="status" className="appear-late flex h-full items-center justify-center text-sm text-zinc-400">Loading fighter…</div></>;
  }
  if (error && !fighter) {
    return <>{statModal}<div className="p-5"><RequestNotice onRetry={retry}>Couldn’t load this fighter. Please try again.</RequestNotice></div></>;
  }
  if (!fighter) {
    return <>{statModal}<div className="flex h-full items-center justify-center text-sm text-zinc-400">Fighter not found.</div></>;
  }

  const upcoming = fighter.history.filter((h) => h.upcoming);
  const past = fighter.pro_history ?? fighter.history.filter((h) => !h.upcoming);
  const allFights = [...upcoming, ...past].sort((a, b) => b.date.localeCompare(a.date));
  const bands = careerBands(allFights, fighter.roster_events);
  const moves = divisionMoves(fighter.history);
  const cancelled = showCancelled ? fighter.cancelled ?? [] : [];

  const done = fighter.history.filter((h) => !h.upcoming);
  const fightBonuses = done.filter((h) => h.bonuses?.fotn).length;
  const perfBonuses = done.filter((h) => h.bonuses?.perf).length;
  const perfAgainst = done.filter((h) => h.bonuses?.perf_against).length;
  const bio: [string, ReactNode][] = (
    [
      ["Height", fighter.height],
      ["Weight", fighter.weight],
      ["Reach", fighter.reach],
      ["Stance", fighter.stance],
      ["Age", fighter.age == null ? "" : String(fighter.age)],
      ["5-round fights", done.length ? String(done.filter((h) => h.scheduled_rounds === 5).length) : ""],
      ["Bonuses", fightBonuses || perfBonuses || perfAgainst ? <BonusTally fight={fightBonuses} perf={perfBonuses} against={perfAgainst} /> : ""],
      ["Born", [fighter.birthplace, fighter.country].filter(Boolean).join(", ")],
    ] as [string, ReactNode][]
  ).filter(([, v]) => v);
  const fought = fighter.history.some((fight) => !fight.upcoming);
  const wheels = <>
    {fighter.record_verified ? <RecordWheel key={`${fighter.id}-all`} history={fighter.pro_history} scope="all" record={fighter.record} /> : null}
    <RecordWheel key={`${fighter.id}-ufc`} history={fighter.history} scope="ufc" record={fighter.ufc_record} />
  </>;


  return (
    <>{statModal}
    <div ref={pageScroll} className="h-full overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] lg:overflow-hidden">
      <div className="flex flex-col gap-3 p-3 pb-8 lg:h-full lg:pb-3">
        {error ? <RequestNotice onRetry={retry}>Couldn’t refresh this profile. Showing the last loaded data.</RequestNotice> : null}
        {/* Wide windows split the profile: who they are and where they rank on
            the left, held in view, and every fight they've had on the right. */}
        {/* On a wide window the page itself never scrolls: each column is its
            own scroller, so reading one leaves the other exactly where it was. */}
        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(24rem,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div ref={mainScroll} className="flex min-w-0 flex-col gap-3 [&>*]:shrink-0 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-y-contain lg:pr-1 lg:[scrollbar-gutter:stable]">
        <section className={`${shell} @container px-4 py-4 @[30rem]:px-6 @[30rem]:py-5`}>
          <div className="flex flex-col gap-4 @[30rem]:gap-5">
            <div className="flex min-w-0 items-center gap-4 @[30rem]:gap-6">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <FighterPortrait src={fighter.photo_full_url} headshot={fighter.photo_url} name={fighter.name} size="profile" />
              </div>
              <div className="min-w-0 flex-1">
                {/* The flag is held to the last word of the name, so it never
                    wraps onto a line by itself. */}
                <h1 className="text-balance break-words text-xl font-semibold leading-tight tracking-tight text-zinc-950 @[30rem]:text-2xl @[56rem]:text-3xl">
                  {fighter.name}
                  {fighter.country_code || fighter.country ? <>{"\u00a0"}<Flag code={fighter.country_code} name={fighter.country} className="text-[0.8em]" /></> : null}
                </h1>
                {fighter.nickname ? <div className="mt-0.5 text-sm text-zinc-400">“{fighter.nickname}”</div> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm empty:hidden">
                  {/* With a verified history the records head their wheels below;
                      until then the pro record has no wheel, so it stays here. */}
                  {fighter.record_verified ? null : <span className="font-semibold tabular-nums text-zinc-900" title="Professional record"><span className="text-[10px] font-bold text-zinc-400">PRO</span> {fighter.record}</span>}
                  {fighter.ranking ? (
                    <span title="Current ranking from the source chosen on the Rankings page" className={`px-2.5 py-0.5 text-[11px] font-bold ${fighter.ranking.rank === "C" ? "bg-amber-100 text-belt" : fighter.ranking.rank === "IC" ? "bg-slate-100 text-belt-interim" : "bg-zinc-100 text-zinc-600"}`}>
                      {fighter.ranking.rank === "C" ? "Champion" : fighter.ranking.rank === "IC" ? "Interim champion" : `#${fighter.ranking.rank}`} · {fighter.ranking.division}
                    </span>
                  ) : null}
                </div>
                {/* Beside the portrait when the card is wide, under it when not. */}
                <BioGrid bio={bio} className="mt-4 hidden @[40rem]:grid" />
              </div>
            </div>
            <BioGrid bio={bio} className="@[40rem]:hidden" />
            {fighter.awards?.length ? <FighterAwards awards={fighter.awards} /> : null}
            {/* Both records at once, side by side while the card is wide
                enough and stacked when it is not. The professional wheel
                waits until that history is verified. */}
            <div className="hidden items-start justify-center gap-x-6 gap-y-5 border-t border-zinc-100 pt-3 empty:hidden sm:flex-wrap sm:gap-x-10 sm:pt-4 lg:flex">
              {wheels}
            </div>
          </div>
        </section>

        {/* On a narrow window the wheels leave the header for a panel of
            their own under it, above the tabs, whichever tab is open. */}
        <section className={`${shell} flex items-start justify-center gap-x-6 gap-y-5 px-4 py-4 sm:flex-wrap sm:gap-x-10 lg:hidden`}>
          {wheels}
        </section>

        {/* Statistics rank UFC bouts, so a fighter yet to have one — booked
            or only signed — has fights and news and nothing else. */}
        <ProfileTabs tabs={fought ? ["fights", "stats", "records", "news"] : ["fights", "news"]} current={tab} onSelect={selectTab} news={news?.total ?? null} className="lg:hidden" />

        {fought ? <div className={`${tab === "stats" ? "contents" : "hidden lg:contents"} [&>*]:shrink-0`}>
          <RankingHistory key={fighter.id} timeline={fighter.ranking_history} history={fighter.history} fighterId={fighter.id} />
          <FighterCareerStats fighterId={fighter.id} name={fighter.name} totals={fighter.career_stats} medians={fighter.division_medians} />
          {fighter.insights?.rounds ? <div className="grid grid-cols-2 gap-3">
            <RoundsPanel fighters={[fighter]} />
            <DecisionsPanel fighters={[fighter]} />
          </div> : null}
          <StrikesPanel fighters={[fighter]} />
          {fighter.antidoping?.length ? <FighterTests years={fighter.antidoping} /> : null}
        </div> : null}
        </div>

        <div ref={sideScroll} className={`${tab !== "stats" || !fought ? "flex" : "hidden lg:flex"} min-w-0 flex-col gap-3 [&>*]:shrink-0 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-y-contain lg:pr-1 lg:[scrollbar-gutter:stable]`}>
        <ProfileTabs tabs={fought ? ["fights", "records", "news"] : ["fights", "news"]} current={tab === "stats" ? "fights" : tab} onSelect={selectTab} news={news?.total ?? null} className="hidden lg:block" />

        {tab === "news" ? <FighterNews key={fighter.id} fighterId={fighter.id} name={fighter.name} first={news ?? null} /> : tab === "records" && fought ? <>
          <Records records={fighter.records ?? []} />
          <FighterStatistics fighterId={fighter.id} history={fighter.history} />
        </> : <section className={shell}>
          <PanelHeading title="Fights" subtitle={allFights.length.toLocaleString()}
            aside={fighter.cancelled?.length ? <CancelledSwitch count={fighter.cancelled.length} on={showCancelled} onChange={setShowCancelled} /> : null} />
          {!fighter.record_verified ? (
            <div className="px-4 pb-1 pt-3 text-xs text-zinc-500 sm:px-5">Outside-UFC history is still syncing; UFC bouts are shown now.</div>
          ) : null}
          <div className={BOUT_LIST}>
            {allFights.length || cancelled.length ? withCancelled([
              ...allFights.flatMap((row, index) => {
                const key = row.fight_id ?? `${row.date}-${row.opponent.name}-${index}`;
                return [
                  ...bands[index].map((band, bandIndex) => ({ date: band.date, node: <RosterBand key={`${key}-band-${bandIndex}`} band={band} /> })),
                  { date: row.date, node: <HistoryRowView key={key} row={row} fighterName={fighter.name} move={row.fight_id ? moves.get(row.fight_id) : undefined} /> },
                ];
              }),
            ], cancelled) : (
              <div className="px-5 py-6 text-sm text-zinc-400">No fights on record.</div>
            )}
          </div>
          {bands[allFights.length].map((band, index) => <RosterBand key={index} band={band} />)}
        </section>}
        </div>
        </div>
      </div>
    </div>
    </>
  );
}

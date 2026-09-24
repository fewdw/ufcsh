import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useApi, type FightContext, type HistoryRow, type Matchup, type MatchupSide, type Milestone } from "../api";
import { clockTimeWithZone, formatDateShortWithYear, formatMethod, inches, lastName, offsetLabel, venueClock } from "../format";
import { resultDot } from "../resultDots";
import { EYEBROW } from "../ui";
import { PANEL } from "./chartTokens";
import RequestNotice from "./RequestNotice";

type Side = "f1" | "f2";
type Point = { side: Side | null; body: ReactNode; key: string };

const LINK = "font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600";
const SEGMENT: Record<string, string> = { main: "Main card", prelims: "Prelims", early: "Early prelims" };

function Section({ title, points, note, empty }: { title: string; points: Point[]; note?: ReactNode; empty?: string }) {
  if (!points.length && !empty) return null;
  return (
    <section className="min-w-0 break-inside-avoid px-4 py-3 sm:px-5">
      <h3 className={`${EYEBROW} mb-1.5`}>{title}</h3>
      {points.length ? (
        <ul className="space-y-1.5">
          {points.map((point) => (
            <li key={point.key} className="flex gap-2 text-[13px] leading-5 text-zinc-700">
              <span aria-hidden="true" className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${point.side === "f1" ? "bg-f1" : point.side === "f2" ? "bg-f2" : "bg-zinc-300"}`} />
              <span className="min-w-0">{point.body}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-zinc-400">{empty}</p>}
      {note ? <p className="mt-2 text-[11px] leading-4 text-zinc-400">{note}</p> : null}
    </section>
  );
}

function FighterName({ side, fight }: { side: Side; fight: Matchup }) {
  const fighter = fight[side];
  const className = `font-semibold ${side === "f1" ? "text-f1-ink" : "text-f2-ink"}`;
  return fighter.profile_eligible ? <Link to={`/fighters/${fighter.id}`} className={`${className} hover:underline`}>{fighter.name}</Link> : <span className={className}>{fighter.name}</span>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const outcomeWord = (outcome: HistoryRow["outcome"]) => outcome === "win" ? "beat" : outcome === "loss" ? "lost to" : outcome === "draw" ? "drew with" : "had a no contest with";

function formPoints(fight: Matchup, side: Side, past: boolean): Point[] {
  const fighter: MatchupSide = fight[side];
  const name = <FighterName side={side} fight={fight} />;
  const points: Point[] = [];
  const recent = fighter.recent_history ?? [];
  const career = fighter.career_before;
  const record = fighter.complete_record_before?.text ?? fighter.ufc_record_before;
  if (!recent.length) {
    points.push({ side, key: `${side}-debut`, body: <>{name} has no earlier professional bouts on record.</> });
    return points;
  }
  const streak = fighter.streak;
  if (streak && streak.count >= 2 && (streak.outcome === "win" || streak.outcome === "loss")) {
    const finishes = recent.slice(0, streak.count).filter((row) => row.outcome === "win" && /KO|TKO|SUB/i.test(row.method ?? "")).length;
    points.push({ side, key: `${side}-streak`, body: <>{name}{record ? ` (${record})` : ""} {past ? "came in" : "comes in"} on a {streak.count}-fight {streak.outcome === "win" ? "winning" : "losing"} streak{streak.complete ? " across promotions" : " in the UFC"}{streak.outcome === "win" && finishes ? `, with ${finishes} finishes in the last ${recent.length}` : ""}.</> });
  } else {
    const last = recent[0];
    points.push({ side, key: `${side}-last`, body: <>{name}{record ? ` (${record})` : ""} {outcomeWord(last.outcome)} {last.opponent.name} last time out{last.method ? ` (${formatMethod(last.method, last.round, last.time)})` : ""}, {formatDateShortWithYear(last.date)}.</> });
  }
  const wins = recent.filter((row) => row.outcome === "win").length;
  const losses = recent.filter((row) => row.outcome === "loss").length;
  if (recent.length >= 3) {
    const finishes = recent.filter((row) => resultDot(row).kind === "finish" && row.outcome === "win").length;
    const stopped = recent.filter((row) => resultDot(row).kind === "finish" && row.outcome === "loss").length;
    points.push({ side, key: `${side}-five`, body: <>{wins}-{losses}{recent.length - wins - losses ? `-${recent.length - wins - losses}` : ""} in the last {recent.length}{finishes ? `, with ${plural(finishes, "finish")}` : ""}{stopped ? `; stopped ${plural(stopped, "time")}` : ""}.</> });
  }
  const days = fighter.ufc_days_since_before;
  if (days == null && fighter.ufc_record_before == null) {
    points.push({ side, key: `${side}-ufc-debut`, body: <>{name} {past ? "was making" : "makes"} a UFC debut.</> });
  } else if (days != null && days >= 365) {
    points.push({ side, key: `${side}-layoff`, body: <>{Math.round(days / 30.4)} months out of the UFC cage before this bout.</> });
  } else if (days != null && days <= 90) {
    points.push({ side, key: `${side}-quick`, body: <>A quick turnaround: {days} days since the last UFC bout.</> });
  }
  if (career?.champion || career?.interimChampion) {
    points.push({ side, key: `${side}-champ`, body: <>{past ? "Entered" : "Enters"} as the {career.interimChampion ? "interim " : ""}champion at {fight.weight_class}.</> });
  } else if (career?.formerChampion) {
    points.push({ side, key: `${side}-former`, body: <>A former UFC champion.</> });
  }
  if (career && career.titleFights > 0 && !career.champion && !career.interimChampion) {
    points.push({ side, key: `${side}-titles`, body: <>{career.titleWins} wins in {career.titleFights} UFC championship bouts.</> });
  }
  return points;
}

const NEEDS: Record<Milestone["needs"], string> = {
  win: "A win", finish: "A finish", ko: "A KO/TKO win", sub: "A submission win", decision: "A decision win", bout: "Taking this bout",
};

function milestonePoint(fight: Matchup, milestone: Milestone): Point | null {
  if (!milestone.next) return null;
  const name = lastName(fight[milestone.side].name);
  const holders = milestone.next.holders.join(", ");
  const where = milestone.scope === "UFC history" ? "in UFC history" : `at ${milestone.scope}`;
  const stat = milestone.label.replace(/^Most /, "").replace(/^./, (letter) => letter.toLowerCase());
  const action = milestone.next.outcome === "tie"
    ? <>tie {holders} for #{milestone.next.rank} in {stat} {where}</>
    : milestone.next.outcome === "clear"
      ? <>move {name} clear of {holders} into #{milestone.next.rank} for {stat} {where}</>
      : <>move {name} past {holders} into #{milestone.next.rank} for {stat} {where}</>;
  return {
    side: milestone.side, key: `m-${milestone.side}-${milestone.key}-${milestone.scope}`,
    body: <>{NEEDS[milestone.needs]} would {action} (now {milestone.value}).</>,
  };
}

function historyPoints(fight: Matchup): Point[] {
  const points: Point[] = [];
  const before = fight.head_to_head.filter((row) => !row.upcoming && row.date <= fight.event.date).sort((a, b) => a.date.localeCompare(b.date));
  const after = fight.head_to_head.filter((row) => row.date > fight.event.date);
  if (before.length) {
    points.push({
      side: null, key: "h2h",
      body: <>They have met {before.length === 1 ? "once" : plural(before.length, "time")} before: {before.map((row, index) => (
        <span key={row.fight_id}>{index ? "; " : ""}<Link to={`/fights/${row.fight_id}`} className={LINK}>{row.outcome === "win" ? lastName(fight.f1.name) : row.outcome === "loss" ? lastName(fight.f2.name) : row.outcome === "draw" ? "a draw" : "no contest"}{row.outcome === "win" || row.outcome === "loss" ? " won" : ""}{row.method ? ` by ${formatMethod(row.method, row.round, row.time)}` : ""}</Link> ({formatDateShortWithYear(row.date)})</span>
      ))}.</>,
    });
  } else {
    points.push({ side: null, key: "first", body: <>{fight.status === "past" ? "No earlier meetings in the recorded history." : "No previous meetings in the recorded history."}</> });
  }
  if (after.length) points.push({ side: null, key: "after", body: <>They met {plural(after.length, "more time")} after this bout.</> });
  const shared = fight.common_opponents
    .map((comparison) => ({
      ...comparison,
      f1_fights: comparison.f1_fights.filter((row) => !row.upcoming && row.date <= fight.event.date),
      f2_fights: comparison.f2_fights.filter((row) => !row.upcoming && row.date <= fight.event.date),
    }))
    .filter((comparison) => comparison.f1_fights.length && comparison.f2_fights.length);
  const describe = (rows: HistoryRow[]) => rows.map((row) => `${row.outcome === "win" ? "W" : row.outcome === "loss" ? "L" : row.outcome === "draw" ? "D" : "NC"}${row.method ? ` ${resultDot(row).shortMethod ?? row.method}` : ""}`).join(", ");
  for (const comparison of shared.slice(0, 5)) {
    points.push({
      side: null, key: `common-${comparison.opponent.id}`,
      body: <><Link to={`/fighters/${comparison.opponent.id}`} className={LINK}>{comparison.opponent.name}</Link>: {lastName(fight.f1.name)} {describe(comparison.f1_fights)} · {lastName(fight.f2.name)} {describe(comparison.f2_fights)}</>,
    });
  }
  if (shared.length > 5) points.push({ side: null, key: "common-more", body: <>{shared.length - 5} more common opponents on the Matchup tab.</> });
  return points;
}

/** Only differences large enough to matter; a one-inch reach gap is not a talking point. */
function differencePoints(fight: Matchup): Point[] {
  const points: Point[] = [];
  const a = fight.f1;
  const b = fight.f2;
  const who = (side: Side) => <FighterName side={side} fight={fight} />;
  if (a.age != null && b.age != null && Math.abs(a.age - b.age) >= 3) {
    const older: Side = a.age > b.age ? "f1" : "f2";
    points.push({ side: older, key: "age", body: <>{who(older)} is {Math.abs(a.age - b.age)} years older ({a.age} vs {b.age} on fight night).</> });
  }
  const reachA = inches(a.reach);
  const reachB = inches(b.reach);
  if (reachA && reachB && Math.abs(reachA - reachB) >= 2) {
    const longer: Side = reachA > reachB ? "f1" : "f2";
    points.push({ side: longer, key: "reach", body: <>{who(longer)} has a {Math.abs(reachA - reachB)}-inch reach advantage ({reachA}″ vs {reachB}″).</> });
  }
  const heightA = inches(a.height);
  const heightB = inches(b.height);
  if (heightA && heightB && Math.abs(heightA - heightB) >= 3) {
    const taller: Side = heightA > heightB ? "f1" : "f2";
    points.push({ side: taller, key: "height", body: <>{who(taller)} is {Math.abs(heightA - heightB)} inches taller.</> });
  }
  if (a.stance && b.stance && a.stance !== b.stance && /southpaw|orthodox|switch/i.test(`${a.stance}${b.stance}`)) {
    points.push({ side: null, key: "stance", body: <>Stances: {a.stance} ({lastName(a.name)}) vs {b.stance} ({lastName(b.name)}).</> });
  }
  const ca = a.career_before;
  const cb = b.career_before;
  if (ca && cb) {
    if (Math.abs(ca.bouts - cb.bouts) >= 5) {
      const more: Side = ca.bouts > cb.bouts ? "f1" : "f2";
      points.push({ side: more, key: "experience", body: <>{who(more)} has {Math.abs(ca.bouts - cb.bouts)} more UFC bouts ({ca.bouts} vs {cb.bouts}).</> });
    }
    const rate = (landed: number, seconds: number) => seconds > 0 ? landed / (seconds / 60) : null;
    const outA = ca.statBouts >= 3 ? rate(ca.sigLanded, ca.seconds) : null;
    const outB = cb.statBouts >= 3 ? rate(cb.sigLanded, cb.seconds) : null;
    if (outA != null && outB != null && Math.abs(outA - outB) >= 1) {
      const busier: Side = outA > outB ? "f1" : "f2";
      points.push({ side: busier, key: "output", body: <>{who(busier)} lands {Math.max(outA, outB).toFixed(1)} significant strikes a minute to {Math.min(outA, outB).toFixed(1)} (UFC bouts before this one).</> });
    }
    const tdA = ca.statBouts >= 3 && ca.seconds > 0 ? ca.takedowns / (ca.seconds / 900) : null;
    const tdB = cb.statBouts >= 3 && cb.seconds > 0 ? cb.takedowns / (cb.seconds / 900) : null;
    if (tdA != null && tdB != null && Math.abs(tdA - tdB) >= 1) {
      const wrestler: Side = tdA > tdB ? "f1" : "f2";
      points.push({ side: wrestler, key: "td", body: <>{who(wrestler)} averages {Math.max(tdA, tdB).toFixed(1)} takedowns per 15 minutes to {Math.min(tdA, tdB).toFixed(1)}.</> });
    }
    for (const [side, career] of [["f1", ca], ["f2", cb]] as const) {
      if (career.koLosses >= 2) points.push({ side, key: `ko-${side}`, body: <>{who(side)} has been stopped by strikes {plural(career.koLosses, "time")} in the UFC.</> });
      if (career.wins >= 4 && career.finishes / career.wins >= 0.7) points.push({ side, key: `fin-${side}`, body: <>{who(side)} has finished {career.finishes} of {career.wins} UFC wins.</> });
    }
  }
  const close1 = fight.odds?.f1.close;
  const close2 = fight.odds?.f2.close;
  const american = (line: string | null | undefined) => {
    const value = Number(String(line ?? "").replace(/[−–]/g, "-").replace(/[^0-9+\-.]/g, ""));
    return Number.isFinite(value) && value !== 0 ? value : null;
  };
  const l1 = american(close1);
  const l2 = american(close2);
  if (l1 != null && l2 != null) {
    const favorite: Side | null = l1 < l2 ? "f1" : l2 < l1 ? "f2" : null;
    if (favorite) {
      const line = favorite === "f1" ? close1! : close2!;
      const value = favorite === "f1" ? l1 : l2;
      const implied = value < 0 ? -value / (-value + 100) : 100 / (value + 100);
      const open = favorite === "f1" ? fight.odds?.f1.open : fight.odds?.f2.open;
      points.push({
        side: favorite, key: "market",
        body: <>{who(favorite)} {fight.status === "past" ? "closed as" : "is"} the {line} favorite ({Math.round(implied * 100)}% implied, vig included){open && open !== line ? `, opening at ${open}` : ""}.</>,
      });
    }
  }
  return points;
}

function stageAndOfficials(fight: Matchup, context: FightContext | null): Point[] {
  const points: Point[] = [];
  const venue = context?.venue ?? fight.event.venue;
  points.push({
    side: null, key: "venue",
    body: venue
      ? <><Link to={`/venues/${venue.slug}`} className={LINK}>{venue.name}</Link>{[venue.city, venue.country].filter(Boolean).length ? `, ${[venue.city, venue.country].filter(Boolean).join(", ")}` : ""}.</>
      : <>{fight.event.location || "Venue not yet announced"}{fight.event.location ? " (venue not yet recorded)." : "."}</>,
  });
  const event = context?.event;
  const at = event?.segment_starts_at ?? event?.starts_at ?? null;
  if (event && at && !context.complete) {
    const local = venueClock(at, event.time_zone);
    points.push({
      side: null, key: "time",
      body: <>{event.segment ? SEGMENT[event.segment] : "The card"} starts {clockTimeWithZone(at)} your time{local ? ` · ${local} at the venue (${offsetLabel(event.time_zone)})` : ""}. Bout times are estimates.</>,
    });
  }
  if (event?.broadcasters && Object.keys(event.broadcasters).length) {
    points.push({
      side: null, key: "broadcast",
      body: <>Broadcast: {Object.entries(event.broadcasters).map(([segment, name]) => `${SEGMENT[segment] ?? segment} on ${name}`).join(" · ")}{event.segment && event.broadcaster ? ` — this bout is on the ${SEGMENT[event.segment].toLowerCase()}` : ""}.</>,
    });
  }
  if (event?.attendance) {
    points.push({ side: null, key: "attendance", body: <>Attendance {event.attendance.toLocaleString("en-US")}{event.gate ? ` · gate ${event.gate}` : ""}.</> });
  }
  const referee = context?.officials.referee ?? fight.officials?.referee ?? null;
  points.push({
    side: null, key: "referee",
    body: referee
      ? <>Referee: {referee.slug ? <Link to={`/referees/${referee.slug}`} className={LINK}>{referee.name}</Link> : referee.name}{referee.assigned ? " (assigned by the promotion; can change on the night)" : ""}.</>
      : <>Referee: not yet confirmed.</>,
  });
  const judges = context?.officials.judges ?? [];
  points.push({
    side: null, key: "judges",
    body: judges.length
      ? <>Judges: {judges.map((judge, index) => <span key={`${judge.name}-${index}`}>{index ? ", " : ""}{judge.slug ? <Link to={`/judges/${judge.slug}`} className={LINK}>{judge.name}</Link> : judge.name}</span>)}.</>
      : <>Judges: {fight.status === "past" ? "not listed (only decisions name the judges)." : "named with the official result if it goes to the cards."}</>,
  });
  return points;
}

/**
 * The matchup in sentences: how each fighter arrives, what lies between them,
 * the differences worth a line, what has been reported, and where and before
 * whom it happens. Built for someone preparing a broadcast in minutes, not a
 * replacement for the panels it summarises — every line leads to its source.
 */
export default function FightContextPanel({ fight }: { fight: Matchup }) {
  const { data: context, error, retry } = useApi<FightContext>(`/api/fights/${fight.id}/context`);
  const current = context?.fight_id === fight.id ? context : null;
  const past = fight.status === "past";
  const milestones = (current?.milestones ?? [])
    .map((milestone) => milestonePoint(fight, milestone)).filter((point): point is Point => Boolean(point));
  // One line per statistic at most: the division reading is dropped when the
  // whole-UFC one says the same thing about the same count.
  const seen = new Set<string>();
  const distinctMilestones = milestones.filter((point) => {
    const id = point.key.replace(/-[^-]+$/, "");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 6);

  return (
    <section className={`${PANEL} @container overflow-hidden`}>
      <div className="border-b border-zinc-100 px-4 py-2.5 sm:px-5 sm:py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Context</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          {past ? "As things stood walking in" : "The bout at a glance"} · <span className="text-f1-ink">{lastName(fight.f1.name)}</span> in blue, <span className="text-f2-ink">{lastName(fight.f2.name)}</span> in red
        </p>
      </div>
      {error && !current ? <div className="px-4 pt-3 sm:px-5"><RequestNotice onRetry={retry}>Couldn’t load venue, officials and reporting. The rest is below.</RequestNotice></div> : null}
      <div className="divide-y divide-zinc-100 @[46rem]:grid @[46rem]:grid-cols-2 @[46rem]:divide-y-0 @[46rem]:[&>*]:border-b @[46rem]:[&>*]:border-zinc-100 @[46rem]:[&>*:nth-child(odd)]:border-r">
        <Section title="Form & milestones" points={[...formPoints(fight, "f1", past), ...formPoints(fight, "f2", past), ...distinctMilestones]}
          note={past ? "Records and runs are as they stood entering this bout." : "Milestones count UFC bouts only and include ties."} />
        <Section title="Between them" points={historyPoints(fight)} />
        <Section title="Differences that matter" points={differencePoints(fight)} empty="No large gaps in size, age, experience or output."
          note="Rates come from each fighter’s UFC bouts before this one, with official round totals." />
        <Section title="Where, when & who" points={stageAndOfficials(fight, current)}
          note={current?.venue ? null : !current && !error ? "Loading venue and officials…" : null} />
        <Section
          title="Reported developments"
          points={(current?.developments?.items ?? []).map((item, index) => ({ side: null, key: `dev-${index}`, body: item }))}
          empty={current ? "Nothing about this bout in the event’s article yet." : "Loading…"}
          note={current?.developments ? (
            <>From the event’s <a href={current.developments.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-zinc-700">{current.developments.source} article<ExternalLink className="h-2.5 w-2.5" aria-hidden="true" /></a>, which cites its reporting. Quotes appear only when a source carries them.</>
          ) : "We only show reporting we can link to."}
        />
      </div>
    </section>
  );
}

import type { ComparisonBlock, EventDetail, FighterBoard, FighterProfile, Matchup, MatchupSide } from "../api";
import { GRAPPLING_METRICS, profileText, STRIKING_METRICS, type ProfileMetric } from "../careerMetrics";
import { formatValue } from "../components/chartTokens";
import { clockTimeWithZone, formatDate, formatDateShortWithYear, formatMethod, inches, lastName } from "../format";
import { bestPrice } from "../methodOdds";
import { SITE_URL } from "../seo";
import type { CardGraphic, CompareRow, Corner, FighterGraphic, Footer, Photo, VersusGraphic } from "./render";

/**
 * From the data a page already holds to a graphic, according to what the
 * reader ticked. Every graphic states where its numbers come from and as of
 * when, so a screenshot cannot pass an old line off as today's.
 */

export type Kind = "matchup" | "result" | "fighter" | "event";
export type PhotoMode = "full" | "head" | "none";

export type Toggle = { id: string; label: string; group: string; on: boolean };

const METRICS: ProfileMetric[] = [...STRIKING_METRICS, ...GRAPPLING_METRICS];
const TOTALS = ["KD", "Sig. str.", "Sig. str. %", "Total str.", "Td", "Sub. att", "Ctrl"];
const TARGETS = ["Head", "Body", "Leg", "Distance", "Clinch", "Ground"];
const TOTAL_LABELS: Record<string, string> = {
  KD: "Knockdowns", "Sig. str.": "Significant strikes", "Sig. str. %": "Sig. strike accuracy", "Total str.": "Total strikes",
  Td: "Takedowns", "Sub. att": "Submission attempts", Ctrl: "Control time",
};
/** "Sal D'amato" as the source prints it reads "Sal D'Amato". */
const tidy = (name: string) => name.replace(/\b([DO])'([a-z])/g, (_, prefix: string, letter: string) => `${prefix}'${letter.toUpperCase()}`);
const host = SITE_URL.replace(/^https?:\/\//, "");

/** The choices each template offers, with sensible defaults switched on. */
export function togglesFor(kind: Kind, board?: FighterBoard | null): Toggle[] {
  const list: [string, string, string, boolean][] = [];
  if (kind === "matchup" || kind === "result") {
    list.push(["nickname", "Nicknames", "Fighters", false], ["ranking", "Rankings", "Fighters", true], ["records", "Records entering", "Fighters", true], ["form", "Last five", "Fighters", kind === "matchup"]);
  }
  if (kind === "matchup") {
    list.push(
      ["odds", "Moneyline", "Odds", true], ["open", "Opening line", "Odds", false],
      ["ko", "KO/TKO price", "Odds", false], ["sub", "Submission price", "Odds", false], ["dec", "Decision price", "Odds", false],
      ["age", "Age", "Tale of the tape", true], ["height", "Height", "Tale of the tape", true], ["reach", "Reach", "Tale of the tape", true],
      ["stance", "Stance", "Tale of the tape", false], ["bouts", "UFC bouts", "Tale of the tape", false], ["h2h", "Previous meetings", "Tale of the tape", false],
      ...METRICS.map((metric) => [`m:${metric.key}`, metric.label, "How they fight", ["slpm", "accuracy", "td", "control"].includes(metric.key)] as [string, string, string, boolean]),
      ["finish", "Finish rate", "How they fight", false],
    );
  }
  if (kind === "result") {
    list.push(["result", "Result", "Result", true], ["judges", "Judges’ scorecards", "Result", true], ["closing", "Closing odds", "Result", false]);
    for (const label of TOTALS) list.push([`t:${label}`, TOTAL_LABELS[label] ?? label, "Fight totals", ["KD", "Sig. str.", "Td", "Ctrl"].includes(label)]);
    for (const label of TARGETS) list.push([`s:${label}`, `${label} strikes`, "Where they landed", false]);
  }
  if (kind === "fighter") {
    list.push(
      ["nickname", "Nickname", "Identity", true], ["ranking", "Ranking", "Identity", true], ["record", "Pro record", "Identity", true],
      ["ufcRecord", "UFC record", "Identity", true], ["country", "Country", "Identity", false],
      ["height", "Height", "Tale of the tape", true], ["reach", "Reach", "Tale of the tape", true], ["age", "Age", "Tale of the tape", true], ["stance", "Stance", "Tale of the tape", false],
      ["form", "Last five", "Form", true],
    );
    const best = [...(board?.stats ?? [])].filter((stat) => !stat.unwanted).sort((a, b) => a.rank - b.rank || b.field - a.field).slice(0, 14);
    best.forEach((stat, index) => list.push([`stat:${stat.key}`, `#${stat.tied ? "T" : ""}${stat.rank} ${stat.label}`, "Rankings", index < 4]));
  }
  if (kind === "event") {
    list.push(["odds", "Moneylines", "Card", true], ["records", "Records", "Card", true], ["weight", "Weight classes", "Card", true],
      ["results", "Results (when fought)", "Card", true], ["venue", "Venue & start time", "Card", true], ["prelims", "Include prelims", "Card", false]);
  }
  return list.map(([id, label, group, on]) => ({ id, label, group, on }));
}

const on = (toggles: Toggle[], id: string) => toggles.some((toggle) => toggle.id === id && toggle.on);
const edge = (a: number | null, b: number | null, better: "high" | "low" = "high"): "f1" | "f2" | null =>
  a == null || b == null || a === b ? null : (better === "high" ? a > b : a < b) ? "f1" : "f2";

function rankBadge(side: MatchupSide | FighterProfile): string | null {
  const ranking = side.ranking;
  if (!ranking) return null;
  if (ranking.rank === "C") return `Champion · ${ranking.division}`;
  if (ranking.rank === "IC") return `Interim champion · ${ranking.division}`;
  return `#${ranking.rank} ${ranking.division}`;
}

function oddsTime(event: EventDetail | null | undefined, past: boolean): string {
  if (past || event?.odds_freshness?.final) return "Odds: closing line, BestFightOdds";
  const at = event?.odds_freshness?.updated_at;
  return `Odds as of ${at ? stamp(at) : "latest update"} · BestFightOdds`;
}

/** "Sep 24, 1:31 PM EDT" — the moment a price was read, in the reader's zone. */
function stamp(at: number): string {
  return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function footerFor(path: string, notes: string[]): Footer {
  return { url: `${host}${path}`, notes };
}

function corner(side: MatchupSide, toggles: Toggle[], photo: Photo, result: string | null): Corner {
  return {
    name: side.name,
    nickname: on(toggles, "nickname") ? side.nickname || null : null,
    photo,
    badge: on(toggles, "ranking") ? rankBadge(side) : null,
    lines: on(toggles, "records") ? [
      [side.complete_record_before?.text ? `${side.complete_record_before.text} pro` : null, side.ufc_record_before ? `${side.ufc_record_before} UFC` : null].filter(Boolean).join(" · "),
    ].filter(Boolean) : [],
    outcome: side.outcome,
    result,
    form: on(toggles, "form") ? [...(side.recent_history ?? [])].reverse().map((row) => row.outcome) : null,
  };
}

function titleOf(fight: Matchup): string {
  if (fight.title_type === "interim") return `Interim ${fight.weight_class} Title`;
  if (fight.title_type === "title") return `${fight.weight_class} Title`;
  return fight.weight_class;
}

export function buildMatchup(fight: Matchup, event: EventDetail | null, toggles: Toggle[], photos: [Photo, Photo]): VersusGraphic {
  const rows: CompareRow[] = [];
  const [a, b] = [fight.f1, fight.f2];
  if (on(toggles, "age") && (a.age != null || b.age != null)) rows.push({ label: "Age", f1: a.age != null ? String(a.age) : "—", f2: b.age != null ? String(b.age) : "—", edge: null });
  if (on(toggles, "height")) rows.push({ label: "Height", f1: a.height || "—", f2: b.height || "—", edge: edge(inches(a.height), inches(b.height)) });
  if (on(toggles, "reach")) rows.push({ label: "Reach", f1: a.reach || "—", f2: b.reach || "—", edge: edge(inches(a.reach), inches(b.reach)) });
  if (on(toggles, "stance")) rows.push({ label: "Stance", f1: a.stance || "—", f2: b.stance || "—", edge: null });
  if (on(toggles, "bouts")) rows.push({ label: "UFC bouts", f1: String(a.career_before?.bouts ?? 0), f2: String(b.career_before?.bouts ?? 0), edge: edge(a.career_before?.bouts ?? 0, b.career_before?.bouts ?? 0) });
  if (on(toggles, "h2h")) {
    const met = fight.head_to_head.filter((row) => !row.upcoming && row.date < fight.event.date);
    const wins = met.filter((row) => row.outcome === "win").length;
    const losses = met.filter((row) => row.outcome === "loss").length;
    rows.push({ label: "Previous meetings", f1: String(wins), f2: String(losses), edge: edge(wins, losses) });
  }
  const style: CompareRow[] = [];
  for (const metric of METRICS) {
    if (!on(toggles, `m:${metric.key}`)) continue;
    const va = a.career_before ? metric.value(a.career_before) : null;
    const vb = b.career_before ? metric.value(b.career_before) : null;
    const [ta, tb] = [profileText(va, metric.format), profileText(vb, metric.format)];
    // Equal as printed is equal: no edge for a difference nobody can see.
    style.push({ label: metric.label, f1: ta, f2: tb, edge: ta === tb ? null : edge(va, vb, metric.better) });
  }
  if (on(toggles, "finish")) {
    const rate = (c: MatchupSide["career_before"]) => c && c.wins ? (c.finishes / c.wins) * 100 : null;
    const ra = rate(a.career_before);
    const rb = rate(b.career_before);
    style.push({ label: "Finish rate", f1: ra == null ? "—" : `${Math.round(ra)}%`, f2: rb == null ? "—" : `${Math.round(rb)}%`, edge: edge(ra, rb) });
  }
  const odds: CompareRow[] = [];
  const props = fight.odds?.props;
  for (const [id, key, label] of [["ko", "ko", "KO/TKO"], ["sub", "submission", "Submission"], ["dec", "decision", "Decision"]] as const) {
    if (!on(toggles, id) || !props) continue;
    const pa = bestPrice(props.f1[key]);
    const pb = bestPrice(props.f2[key]);
    if (pa || pb) odds.push({ label: `By ${label}`, f1: pa?.line ?? "—", f2: pb?.line ?? "—", edge: null });
  }
  if (on(toggles, "open") && (fight.odds?.f1.open || fight.odds?.f2.open)) odds.unshift({ label: "Opened", f1: fight.odds?.f1.open ?? "—", f2: fight.odds?.f2.open ?? "—", edge: null });
  const past = fight.status === "past";
  const hasMoneyline = on(toggles, "odds") && (fight.odds?.f1.close || fight.odds?.f2.close);
  const anyOdds = hasMoneyline || odds.length;
  return {
    kind: "versus",
    eyebrow: `${fight.event.name}`,
    title: `${fight.f1.name} vs ${fight.f2.name}`,
    subtitle: [formatDate(fight.event.date), titleOf(fight), fight.scheduled_rounds ? `${fight.scheduled_rounds} rounds` : null, fight.event.venue?.name ?? fight.event.location].filter(Boolean).join(" · "),
    f1: corner(a, toggles, photos[0], null),
    f2: corner(b, toggles, photos[1], null),
    market: hasMoneyline ? { heading: past ? "Closing odds" : "Moneyline", f1: fight.odds?.f1.close ?? "—", f2: fight.odds?.f2.close ?? "—", note: null } : null,
    sections: [
      ...(rows.length ? [{ title: "Tale of the tape", rows }] : []),
      ...(style.length ? [{ title: "How they fight · UFC bouts before this one", rows: style }] : []),
      ...(odds.length ? [{ title: "Odds", rows: odds }] : []),
    ],
    footer: footerFor(`/fights/${fight.id}`, [
      `Records and rates as of ${formatDateShortWithYear(fight.event.date)} · UFCStats`,
      ...(anyOdds ? [oddsTime(event, past)] : []),
    ]),
  };
}

function totalsCell(block: ComparisonBlock | undefined, label: string): [string, string] | null {
  const index = block?.labels.findIndex((entry) => entry === label || entry.replace(/\.$/, "") === label.replace(/\.$/, "")) ?? -1;
  if (!block || index < 0) return null;
  return [block.f1[index] ?? "—", block.f2[index] ?? "—"];
}

const leading = (value: string) => { const number = Number(String(value).split(" ")[0].replace(/[^\d.]/g, "")); return Number.isFinite(number) ? number : null; };
const seconds = (value: string) => { const match = /^(\d+):(\d{2})$/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };

export function buildResult(fight: Matchup, toggles: Toggle[], photos: [Photo, Photo]): VersusGraphic {
  const detail = fight.detail;
  const method = formatMethod(fight.method, fight.round, fight.time);
  const winner = fight.f1.outcome === "win" ? "f1" : fight.f2.outcome === "win" ? "f2" : null;
  const resultText = (side: "f1" | "f2") => !on(toggles, "result") ? null
    : fight[side].outcome === "win" ? `Won · ${method}` : fight[side].outcome === "draw" ? "Draw" : fight[side].outcome === "nc" ? "No contest" : null;
  const totals: CompareRow[] = [];
  for (const label of TOTALS) {
    if (!on(toggles, `t:${label}`)) continue;
    const cell = totalsCell(detail?.totals, label);
    if (!cell) continue;
    const pretty = TOTAL_LABELS[label] ?? label;
    const compare = label === "Ctrl" ? edge(seconds(cell[0]), seconds(cell[1])) : edge(leading(cell[0]), leading(cell[1]));
    totals.push({ label: pretty, f1: cell[0], f2: cell[1], edge: compare });
  }
  const targets: CompareRow[] = [];
  for (const label of TARGETS) {
    if (!on(toggles, `s:${label}`)) continue;
    const cell = totalsCell(detail?.sigStrikes, label);
    if (cell) targets.push({ label, f1: cell[0], f2: cell[1], edge: edge(leading(cell[0]), leading(cell[1])) });
  }
  const judges = on(toggles, "judges") && detail?.judges?.length
    ? detail.judges.map((judge, index) => ({ name: judge.judge ? tidy(judge.judge) : `Judge ${index + 1}`, f1: judge.f1Score, f2: judge.f2Score }))
    : null;
  return {
    kind: "versus",
    eyebrow: `${fight.event.name} · Result`,
    title: winner ? `${fight[winner].name} def. ${fight[winner === "f1" ? "f2" : "f1"].name}` : `${fight.f1.name} vs ${fight.f2.name}`,
    subtitle: [formatDate(fight.event.date), titleOf(fight), method].filter(Boolean).join(" · "),
    f1: corner(fight.f1, toggles, photos[0], resultText("f1")),
    f2: corner(fight.f2, toggles, photos[1], resultText("f2")),
    market: on(toggles, "closing") && (fight.odds?.f1.close || fight.odds?.f2.close)
      ? { heading: "Closing odds", f1: fight.odds?.f1.close ?? "—", f2: fight.odds?.f2.close ?? "—", note: null } : null,
    sections: [
      ...(totals.length ? [{ title: "Fight totals", rows: totals }] : []),
      ...(targets.length ? [{ title: "Significant strikes by target", rows: targets }] : []),
    ],
    judges,
    footer: footerFor(`/fights/${fight.id}`, [
      "Official totals and scorecards · UFCStats",
      ...(on(toggles, "closing") ? ["Odds: closing line, BestFightOdds"] : []),
    ]),
  };
}

export function buildFighter(fighter: FighterProfile, board: FighterBoard | null, toggles: Toggle[], photo: Photo): FighterGraphic {
  const badges = [
    on(toggles, "ranking") ? rankBadge(fighter) : null,
    on(toggles, "record") ? `${fighter.record} pro` : null,
    on(toggles, "ufcRecord") ? `${fighter.ufc_record} UFC` : null,
    on(toggles, "country") ? fighter.country : null,
  ].filter((value): value is string => Boolean(value));
  const facts = [
    on(toggles, "height") && fighter.height ? { label: "Height", value: fighter.height } : null,
    on(toggles, "reach") && fighter.reach ? { label: "Reach", value: fighter.reach } : null,
    on(toggles, "age") && fighter.age != null ? { label: "Age", value: String(fighter.age) } : null,
    on(toggles, "stance") && fighter.stance ? { label: "Stance", value: fighter.stance } : null,
  ].filter((value): value is { label: string; value: string } => Boolean(value));
  const history = (fighter.pro_history ?? []).filter((row) => !row.upcoming).slice(0, 5);
  const stats = (board?.stats ?? []).filter((stat) => on(toggles, `stat:${stat.key}`))
    .sort((a, b) => a.rank - b.rank)
    .map((stat) => ({
      label: stat.label, value: formatValue(stat.value, stat.format), rank: `#${stat.tied ? "T" : ""}${stat.rank}`,
      detail: `of ${stat.field.toLocaleString("en-US")} · ${board?.scope === "ufc" ? "all UFC" : board?.scope_label}`,
    }));
  return {
    kind: "fighter",
    eyebrow: "Fighter profile",
    name: fighter.name,
    nickname: on(toggles, "nickname") ? fighter.nickname || null : null,
    photo,
    badges,
    facts,
    stats,
    form: on(toggles, "form") && history.length ? [...history].reverse().map((row) => ({ outcome: row.outcome, label: lastName(row.opponent.name) })) : null,
    footer: footerFor(`/fighters/${fighter.id}`, [
      `As of ${formatDate(new Date().toISOString().slice(0, 10))} · UFCStats, verified pro records`,
      ...(stats.length ? ["Rankings: competition rank among qualifying fighters; minimum samples apply"] : []),
    ]),
  };
}

export function buildEvent(event: EventDetail, toggles: Toggle[]): CardGraphic {
  const past = event.status === "past";
  const fights = event.fights.filter((fight) => on(toggles, "prelims") || fight.segment === "main" || (fight.segment == null && fight.ord < 5));
  const start = event.schedule?.main_card_at ?? event.schedule?.prelims_at ?? null;
  const segmentName = (segment: string | null) => segment === "main" ? "Main card" : segment === "prelims" ? "Prelims" : segment === "early" ? "Early prelims" : null;
  const anyOdds = on(toggles, "odds") && fights.some((fight) => fight.odds?.f1.close || fight.odds?.f2.close);
  return {
    kind: "card",
    eyebrow: on(toggles, "prelims") ? "Full card" : "Main card",
    title: event.name,
    subtitle: [
      formatDate(event.date),
      on(toggles, "venue") && start && !past ? clockTimeWithZone(start) : null,
      on(toggles, "venue") ? event.venue ? `${event.venue.name}, ${event.venue.city ?? ""}`.replace(/, $/, "") : event.location : null,
    ].filter(Boolean).join(" · "),
    rows: fights.map((fight) => {
      const done = Boolean(fight.method) && (fight.f1.outcome || fight.f2.outcome);
      return {
        f1: fight.f1.name, f2: fight.f2.name,
        f1Sub: on(toggles, "records") ? fight.f1.career_record ?? fight.f1.record : null,
        f2Sub: on(toggles, "records") ? fight.f2.career_record ?? fight.f2.record : null,
        f1Odds: on(toggles, "odds") ? fight.odds?.f1.close ?? null : null,
        f2Odds: on(toggles, "odds") ? fight.odds?.f2.close ?? null : null,
        meta: on(toggles, "weight") ? `${fight.title_type === "title" || fight.title_type === "interim" ? "Title · " : ""}${fight.weight_class}` : "",
        winner: on(toggles, "results") && done ? (fight.f1.outcome === "win" ? "f1" : fight.f2.outcome === "win" ? "f2" : null) : null,
        result: on(toggles, "results") && done ? formatMethod(fight.method, fight.round, fight.time).replace(/ · \d+:\d+$/, "") : null,
        group: on(toggles, "prelims") ? segmentName(fight.segment) : null,
      };
    }),
    footer: footerFor(`/events/${event.id}`, [
      on(toggles, "records") ? "Records: complete professional record · UFCStats, verified pro histories" : "Card · UFCStats and ufc.com",
      ...(anyOdds ? [past || event.odds_freshness?.final ? "Odds: closing line, BestFightOdds" : `Odds as of ${event.odds_freshness?.updated_at ? stamp(event.odds_freshness.updated_at) : "latest update"} · BestFightOdds`] : []),
    ]),
  };
}

export function photoUrl(side: { photo_url: string | null; photo_full_url?: string | null }, mode: PhotoMode): { url: string | null; kind: "full" | "head" } {
  if (mode === "none") return { url: null, kind: "head" };
  if (mode === "full" && side.photo_full_url) return { url: side.photo_full_url, kind: "full" };
  return { url: side.photo_url, kind: "head" };
}

import { completedScorecardRounds, parseCommunityScorecard } from "./community-scorecards.ts";
import { potentialMatchups, syncPotentialMatchups } from "./potential-matchups.ts";
import { db, getMeta, setMeta } from "./db.ts";
import { confirmedTitleResults, missingCurrentRankingHistory, relinkRankingHistory } from "./ranking-history.ts";
import { validateFightActions } from "./action-stats.ts";
import { americanLine, fightIndex, impliedProbability, professionalBouts } from "./fight-index.ts";
import { fighterNamed, hasUfcFight, ufcFightExistsSql } from "./fighter-identity.ts";
import { SEARCH_ALIASES } from "./search-aliases.ts";
import { normName } from "./util.ts";
import { noContestUnexplained } from "./no-contest.ts";
import { pageNamesFighter } from "./scrape/odds.ts";
import { syncCareerRecord } from "./career-records.ts";
import { hasCompleteJudgeRounds, mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";
import { importVerdictEvent } from "./verdict-import.ts";
import { repairJudgeNames } from "./repair-judge-names.ts";
import { mergedByHand, officialsIndex } from "./officials.ts";
import { venueIndex } from "./venues.ts";
import { rosterEventsByFighter, rosterMoveFighter, storedRosterMoves, syncRosterMoves, syncUfcSignings } from "./roster-moves.ts";
import { storedRosterHistory, validRosterDate } from "./roster-history.ts";
import { careerBands } from "./roster-timeline.ts";
import { feedStatus, newsAiOff, newsToJudge, syncNews } from "./news.ts";
import { judgeNews } from "./news-ai.ts";
import { NEWS_FEEDS } from "./scrape/news.ts";
import { ROSTER_ARTICLE, samePlace } from "./scrape/wikipedia.ts";
import {
  fighterNames,
  forgetUfcPage,
  syncEventDetail,
  syncEventSegments,
  syncFightDetail,
  syncFighterBirthDate,
  syncMethodOddsForEvent,
  syncOddsForFight,
  syncCatchWeights,
  syncFightOdds,
  syncPastFightOdds,
  syncRankings,
} from "./sync.ts";

/** The data-quality board behind /admin?tab=bugs. Checks only read; repair
 * actions re-run one item's sync and are refused unless the request is local. */

export type BugLink = { label: string; href: string; internal?: boolean };
export type BugItem = {
  key: string;
  title: string;
  subtitle?: string;
  date?: string;
  facts: [label: string, value: string][];
  links: BugLink[];
  actions: { id: BugActionId; label: string; target: string }[];
  /** Set by the check's grade, not by the item itself. */
  level?: BugLevel;
};
/** How much an open item matters right now: wrong or missing where readers are
 *  looking (critical), soon to be (must), a real gap nobody is waiting on
 *  (minor), or expected / cosmetic (ok). Graded per item, so the same gap
 *  climbs as its card approaches. */
export type BugLevel = "critical" | "must" | "minor" | "ok";
export const BUG_LEVELS: BugLevel[] = ["critical", "must", "minor", "ok"];
type Grade = BugLevel | ((item: BugItem) => BugLevel);
export type BugCheck = {
  id: string;
  group: "Accounts" | "Scorecards" | "Odds" | "Records" | "Fights & events" | "Venues & officials" | "Fighters";
  label: string;
  description: string;
  /** The worst level among its items; "ok" when there are none. */
  level: BugLevel;
  total: number;
  items: BugItem[];
};

const ITEM_LIMIT = 1000;
const UFCSTATS = "http://ufcstats.com";
const BFO = "https://www.bestfightodds.com";

const fightLinks = (id: string): BugLink[] => [
  { label: "Matchup", href: `/fights/${id}`, internal: true },
  { label: "UFCStats", href: `${UFCSTATS}/fight-details/${id}` },
];
const eventLink = (id: string): BugLink => ({ label: "Event", href: `/events/${id}`, internal: true });
const fighterLink = (id: string, name: string): BugLink => ({ label: name, href: `/fighters/${id}`, internal: true });
const bfoSearch = (name: string): BugLink => ({ label: `BFO search: ${name}`, href: `${BFO}/search?query=${encodeURIComponent(name)}` });
const sherdogSearch = (name: string): BugLink => ({
  label: "Sherdog search",
  href: `https://www.sherdog.com/stats/fightfinder?SearchTxt=${encodeURIComponent(name)}`,
});
const ago = (ms: number | null | undefined) => {
  if (!ms) return "never";
  const hours = (Date.now() - ms) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};
const recordText = (w: number, l: number, d: number) => `${w}-${l}${d ? `-${d}` : ""}`;

/** Whole days from today (UTC) to a date: 0 today, negative past, null undated. */
function daysFrom(date: string | undefined): number | null {
  const day = date ? Date.parse(`${date.slice(0, 10)}T00:00:00Z`) : NaN;
  if (!Number.isFinite(day)) return null;
  return Math.round((day - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}
/** Graded by how soon the card is: the first [within days, level] step that
 *  holds, nearest first. Undated items take `otherwise`. */
const ahead = (steps: [number, BugLevel][], otherwise: BugLevel = "ok") => (item: BugItem): BugLevel => {
  const days = daysFrom(item.date);
  return (days != null && steps.find(([within]) => days <= within)?.[1]) || otherwise;
};
/** Graded by how recently it happened. */
const recent = (steps: [number, BugLevel][], otherwise: BugLevel = "ok") => (item: BugItem): BugLevel => {
  const days = daysFrom(item.date);
  return (days != null && steps.find(([within]) => -days <= within)?.[1]) || otherwise;
};

function check(meta: Omit<BugCheck, "total" | "items" | "level"> & { grade: Grade }, items: BugItem[], itemLimit = ITEM_LIMIT): BugCheck {
  const { grade, ...rest } = meta;
  const rank = (item: BugItem) => BUG_LEVELS.indexOf(item.level!);
  // Worst first; a stable sort keeps each check's own order within a level.
  const graded = items
    .map((item) => ({ ...item, level: typeof grade === "string" ? grade : grade(item) }))
    .sort((a, b) => rank(a) - rank(b));
  return { ...rest, level: graded[0]?.level ?? "ok", total: graded.length, items: graded.slice(0, itemLimit) };
}

/** Fighters with a bout since the start of last year or one booked. */
function activeFighterIds(): Set<string> {
  const rows = db.prepare(`
    SELECT f.f1_id AS id FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', 'start of year', '-1 year') OR e.complete = 0
    UNION SELECT f.f2_id FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', 'start of year', '-1 year') OR e.complete = 0
  `).all() as { id: string }[];
  return new Set(rows.map((row) => row.id).filter(Boolean));
}

type FightRow = {
  id: string; event_id: string; event_name: string; date: string; complete: number;
  f1_id: string; f2_id: string; f1_name: string; f2_name: string; weight_class: string;
};
const FIGHT_COLUMNS = "f.id, f.event_id, e.name AS event_name, e.date, e.complete, f.f1_id, f.f2_id, f.f1_name, f.f2_name, f.weight_class";

function fightItem(fight: FightRow, extra: Partial<BugItem> = {}): BugItem {
  return {
    key: fight.id,
    title: `${fight.f1_name} vs ${fight.f2_name}`,
    subtitle: `${fight.event_name}${fight.weight_class ? ` · ${fight.weight_class}` : ""}`,
    date: fight.date,
    facts: extra.facts ?? [],
    links: [...fightLinks(fight.id), eventLink(fight.event_id), ...(extra.links ?? [])],
    actions: extra.actions ?? [],
  };
}

/** Both names each fighter answers to, when the career record adds one. */
function aliasFact(fight: FightRow): [string, string][] {
  const facts: [string, string][] = [];
  for (const [id, name] of [[fight.f1_id, fight.f1_name], [fight.f2_id, fight.f2_name]] as const) {
    const names = fighterNames(id, name);
    if (names.length > 1) facts.push([`${name} also known as`, names.slice(1).join(", ")]);
  }
  return facts;
}

function fighterBfoLinks(fight: FightRow): BugLink[] {
  const rows = db.prepare("SELECT id, name, bfo_url FROM fighters WHERE id IN (?, ?)").all(fight.f1_id, fight.f2_id) as
    { id: string; name: string; bfo_url: string | null }[];
  const links: BugLink[] = [];
  for (const row of rows) {
    if (row.bfo_url) links.push({ label: `BFO: ${row.name}`, href: row.bfo_url });
    for (const name of fighterNames(row.id, row.name)) links.push(bfoSearch(name));
  }
  return links;
}

// ---------------------------------------------------------------------------
// odds

function upcomingMoneyline(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, e.bfo_url, MAX(COALESCE(o.fetched_at, 0), COALESCE(o.checked_at, 0)) AS fetched_at, o.source_url,
      (SELECT COUNT(*) FROM fights g JOIN odds p ON p.fight_id = g.id WHERE g.event_id = f.event_id AND p.f1_close IS NOT NULL) AS card_priced
    FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 0 AND o.f1_close IS NULL
    ORDER BY e.date ASC, f.ord ASC
  `).all() as (FightRow & { bfo_url: string | null; fetched_at: number | null; source_url: string | null; card_priced: number })[];
  // A card no source has priced at all is waiting on the books, not on us,
  // until fight week.
  const unopened = new Set(rows.filter((fight) => !fight.card_priced).map((fight) => fight.id));
  const soon = ahead([[1, "critical"], [7, "must"], [21, "minor"]]);
  return check({
    id: "odds-upcoming-moneyline",
    group: "Odds",
    label: "Upcoming bouts without a moneyline",
    description: "Announced bouts with no price stored. Usually no book has posted a line yet; a card with no lines at all stays OK until fight week. FightOdds.io matches bouts by UFCStats id, so a bout it lists but we don't price is one it filed under another fighter. If a BestFightOdds board or fighter page lists the bout, the names don't match: check the aliases, then add a fix to the name matching.",
    grade: (item) => {
      const level = soon(item);
      return level === "minor" && unopened.has(item.key) ? "ok" : level;
    },
  }, rows.map((fight) => fightItem(fight, {
    facts: [["Last checked", ago(fight.fetched_at)], ["Card has lines", fight.card_priced ? "yes" : "not yet"], ...aliasFact(fight)],
    links: [
      ...(fight.bfo_url ? [{ label: "BFO event board", href: fight.bfo_url }] : []),
      ...fighterBfoLinks(fight),
    ],
    actions: [{ id: "odds", label: "Re-fetch odds", target: fight.id }],
  })));
}

function upcomingProps(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, e.bfo_url, e.bfo_checked_at, o.f1_close
    FROM fights f JOIN events e ON e.id = f.event_id
    LEFT JOIN method_odds m ON m.fight_id = f.id LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 0 AND m.fight_id IS NULL
    ORDER BY (o.f1_close IS NULL), e.date ASC, f.ord ASC
  `).all() as (FightRow & { bfo_url: string | null; bfo_checked_at: number | null; f1_close: string | null })[];
  return check({
    id: "odds-upcoming-props",
    group: "Odds",
    label: "Upcoming bouts without method props",
    description: "No KO, submission or decision prices. Props go up late, usually fight week. Bouts that already have a moneyline come first, because the board is more likely to have their props.",
    grade: ahead([[2, "must"], [7, "minor"]]),
  }, rows.map((fight) => fightItem(fight, {
    facts: [["Moneyline", fight.f1_close ? "yes" : "no"], ["Board last read", ago(fight.bfo_checked_at)], ...aliasFact(fight)],
    links: fight.bfo_url ? [{ label: "BFO event board", href: fight.bfo_url }] : [],
    actions: [{ id: "props", label: "Re-read board", target: fight.id }],
  })));
}

function pastMoneyline(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, e.bfo_url, MAX(COALESCE(o.fetched_at, 0), COALESCE(o.checked_at, 0)) AS fetched_at
    FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 1 AND e.date >= '2008-01-01' AND o.f1_close IS NULL
    ORDER BY e.date DESC, f.ord ASC
  `).all() as (FightRow & { bfo_url: string | null; fetched_at: number | null })[];
  return check({
    id: "odds-past-moneyline",
    group: "Odds",
    label: "Completed bouts without a closing line",
    description: "Completed UFC bouts since 2008 with no price, which leaves them out of Market stats. Late replacements often never got a line. The rest are usually a name mismatch on the fighter's BFO page.",
    grade: recent([[30, "must"], [730, "minor"]]),
  }, rows.map((fight) => fightItem(fight, {
    facts: [["Last checked", ago(fight.fetched_at)], ...aliasFact(fight)],
    links: [...(fight.bfo_url ? [{ label: "BFO event board", href: fight.bfo_url }] : []), ...fighterBfoLinks(fight)],
    actions: [{ id: "odds", label: "Re-fetch odds", target: fight.id }],
  })));
}

function pastProps(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, e.bfo_url, e.bfo_final_at
    FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN method_odds m ON m.fight_id = f.id
    WHERE e.complete = 1 AND e.date >= '2021-01-01' AND m.fight_id IS NULL
    ORDER BY e.date DESC, f.ord ASC
  `).all() as (FightRow & { bfo_url: string | null; bfo_final_at: number | null })[];
  return check({
    id: "odds-past-props",
    group: "Odds",
    label: "Completed bouts without method props (2021+)",
    description: "\"Board read in full\" means the event board was read after the card and had no props for this bout, so nothing is missing on our side. If the board wasn't read in full, the backfill hasn't reached the event yet.",
    grade: recent([[30, "minor"]]),
  }, rows.map((fight) => fightItem(fight, {
    facts: [["Board read in full", fight.bfo_final_at ? ago(fight.bfo_final_at) : "no"], ...aliasFact(fight)],
    links: fight.bfo_url ? [{ label: "BFO event board", href: fight.bfo_url }] : [],
    actions: [{ id: "props", label: "Re-read board", target: fight.id }],
  })));
}

const ROUND_FINISH = /^Fight ends in (TKO\/KO(?:\/DQ)?|submission) in round ([1-5])$/i;
const ROUND_METHOD = /^(.+) wins by (TKO\/KO|submission) in round ([1-5])$/i;

/** Props exist, but the board never posted a single per-round price, so the
 * Odds tab's "By round" table has nothing to show — the case the moneyline
 * and total-props checks above can't see, since a method_odds row is there. */
function oddsMissingByRound(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, e.bfo_url, m.markets_json, m.final, m.fetched_at
    FROM fights f JOIN events e ON e.id = f.event_id JOIN method_odds m ON m.fight_id = f.id
    WHERE (e.complete = 1 AND e.date >= '2021-01-01')
       -- Round prices are the last thing a book posts, so only flag an
       -- upcoming bout once it's in fight week; further out, missing them is normal.
       OR (e.complete = 0 AND e.date <= date('now', '+7 day'))
    ORDER BY e.date DESC, f.ord ASC
  `).all() as (FightRow & { bfo_url: string | null; markets_json: string; final: number; fetched_at: number })[];
  const items: BugItem[] = [];
  for (const fight of rows) {
    let additional: { label: string }[];
    try { additional = JSON.parse(fight.markets_json)?.additional ?? []; } catch { continue; }
    if (additional.some((q) => ROUND_FINISH.test(q.label) || ROUND_METHOD.test(q.label))) continue;
    items.push(fightItem(fight, {
      facts: [["Board read in full", fight.final ? "yes" : "no"], ["Fetched", ago(fight.fetched_at)]],
      links: fight.bfo_url ? [{ label: "BFO event board", href: fight.bfo_url }] : [],
      actions: [{ id: "props", label: "Re-read board", target: fight.id }],
    }));
  }
  return check({
    id: "odds-missing-by-round",
    group: "Odds",
    label: "Method props with no round-by-round breakdown",
    description: "Method props exist for this bout, but the board had no per-round KO/TKO or submission price, so the Odds tab's \"By round\" table is empty. For a bout more than a week out this is normal — round markets are usually the last thing a book posts — but for fight week or a completed bout it's worth a re-read.",
    grade: recent([[30, "minor"]]),
  }, items);
}

function suspiciousOdds(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, o.f1_open, o.f1_close, o.f2_open, o.f2_close, o.source_url
    FROM odds o JOIN fights f ON f.id = o.fight_id JOIN events e ON e.id = f.event_id
    WHERE o.f1_close IS NOT NULL OR o.f2_close IS NOT NULL
    ORDER BY e.date DESC
  `).all() as (FightRow & { f1_open: string | null; f1_close: string | null; f2_open: string | null; f2_close: string | null; source_url: string | null })[];
  const items: BugItem[] = [];
  for (const fight of rows) {
    const reasons: string[] = [];
    const lines = [fight.f1_open, fight.f1_close, fight.f2_open, fight.f2_close];
    if (lines.some((line) => line != null && (americanLine(line) == null || Math.abs(americanLine(line)!) < 100))) {
      reasons.push("a line isn't a valid American price");
    }
    const p1 = impliedProbability(americanLine(fight.f1_close));
    const p2 = impliedProbability(americanLine(fight.f2_close));
    if ((p1 == null) !== (p2 == null)) reasons.push("only one corner has a closing line");
    if (p1 != null && p2 != null) {
      const book = p1 + p2;
      // A single book prices both corners at 100–110%. Much less means the two
      // lines came from different moments or different bouts.
      if (book < 0.94 || book > 1.12) reasons.push(`both closes add up to ${(book * 100).toFixed(0)}% (normal is 100–110%)`);
      const o1 = impliedProbability(americanLine(fight.f1_open));
      if (o1 != null && Math.abs(o1 - p1) >= 0.4) reasons.push(`${fight.f1_name} moved ${fight.f1_open} → ${fight.f1_close}, possibly swapped corners`);
    }
    if (!reasons.length) continue;
    items.push(fightItem(fight, {
      facts: [
        ["Why", reasons.join("; ")],
        [fight.f1_name, `${fight.f1_open ?? "–"} → ${fight.f1_close ?? "–"}`],
        [fight.f2_name, `${fight.f2_open ?? "–"} → ${fight.f2_close ?? "–"}`],
      ],
      links: fight.source_url ? [{ label: "Odds source", href: fight.source_url }] : [],
      actions: [{ id: "odds", label: "Re-fetch odds", target: fight.id }],
    }));
  }
  return check({
    id: "odds-suspicious",
    group: "Odds",
    label: "Prices that don't add up",
    description: "Stored lines that contradict themselves: implied probabilities outside a normal book, one corner priced without the other, an unreadable price, or a huge open-to-close swing. Old range prices and mismatched mean charts can cause this. Re-fetch from the fighter pages to verify both corners; a large move alone can be legitimate.",
    grade: (item) => (daysFrom(item.date) ?? -Infinity) >= -30 ? "critical" : "must",
  }, items);
}

function wrongFighterPages(): BugCheck {
  const rows = db.prepare(`
    SELECT fr.id, fr.name, fr.bfo_url, fr.bfo_checked_at,
      (SELECT COUNT(*) FROM odds o JOIN fights f ON f.id = o.fight_id
        WHERE o.source_url = fr.bfo_url AND (f.f1_id = fr.id OR f.f2_id = fr.id)) AS lines
    FROM fighters fr WHERE fr.bfo_url IS NOT NULL AND fr.bfo_url != ''
  `).all() as { id: string; name: string; bfo_url: string; bfo_checked_at: number | null; lines: number }[];
  const items = rows
    .filter((row) => !pageNamesFighter(row.bfo_url, fighterNames(row.id, row.name)))
    // A wrong page that already supplied prices has put another bout's line on
    // this fighter's record; one that supplied nothing only costs coverage.
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name))
    .map((row): BugItem => ({
      key: row.id,
      title: row.name,
      subtitle: `Cached page: ${decodeURIComponent(row.bfo_url.split("/").at(-1) ?? "")}`,
      facts: [
        ["Lines stored from this page", String(row.lines)],
        ["Also known as", fighterNames(row.id, row.name).slice(1).join(", ") || "–"],
        ["Checked", ago(row.bfo_checked_at)],
      ],
      links: [fighterLink(row.id, row.name), { label: "Cached BFO page", href: row.bfo_url }, ...fighterNames(row.id, row.name).map(bfoSearch)],
      actions: [{ id: "clear-bfo", label: "Forget page", target: row.id }],
    }));
  return check({
    id: "odds-wrong-fighter-page",
    group: "Odds",
    label: "Odds page cached for the wrong fighter?",
    description: "The saved BestFightOdds page doesn't match the fighter's name or any alias (like \"Maicon Patricio\" saved for Patricio Pitbull). A wrong page means that fighter's past odds never match, or worse, get lines from another person's bouts. Pages that already supplied lines come first. Open the matchups to check them. Forgetting a page makes the next backfill look it up again.",
    grade: "must",
  }, items);
}

// ---------------------------------------------------------------------------
// records

function recordMismatch(active: Set<string>): BugCheck {
  const index = fightIndex();
  const rows = db.prepare(`
    SELECT fr.id, fr.name, fr.wins, fr.losses, fr.draws, cp.source_url, cp.source_name
    FROM fighters fr JOIN career_profiles cp ON cp.fighter_id = fr.id AND cp.status = 'verified'
  `).all() as { id: string; name: string; wins: number; losses: number; draws: number; source_url: string | null; source_name: string | null }[];
  // UFC bouts are the only part of a record both sources can see, so they are
  // the only part that can be checked. A UFCStats total that differs while
  // every UFC result agrees is a disagreement about regional bouts. Every such
  // case reviewed (2026-09-14, e.g. Carlos Ulberg 14-1 vs 15-1) was UFCStats
  // miscounting or not updating, so those are not listed.
  const disagreements = new Map<string, string[]>();
  const ufcResults = db.prepare(`
    SELECT side.fighter_id, e.date, side.outcome AS ours, b.outcome AS sherdog, side.opponent
    FROM (SELECT id, event_id, f1_id AS fighter_id, f1_outcome AS outcome, f2_name AS opponent FROM fights
          UNION ALL SELECT id, event_id, f2_id, f2_outcome, f1_name FROM fights) side
    JOIN events e ON e.id = side.event_id
    JOIN career_bouts b ON b.ufc_fight_id = side.id AND b.fighter_id = side.fighter_id
    WHERE e.complete = 1 AND side.outcome IS NOT NULL AND side.outcome != '' AND side.outcome != b.outcome
    ORDER BY e.date
  `).all() as { fighter_id: string; date: string; ours: string; sherdog: string; opponent: string }[];
  for (const result of ufcResults) {
    disagreements.set(result.fighter_id, [
      ...(disagreements.get(result.fighter_id) ?? []),
      `${result.date} vs ${result.opponent}: UFCStats ${result.ours}, Sherdog ${result.sherdog}`,
    ]);
  }
  const items: (BugItem & { weight: number })[] = [];
  for (const row of rows) {
    const career = index.fighters.get(row.id)?.career;
    const differing = disagreements.get(row.id);
    if (!career || !differing) continue;
    const diff = Math.abs(career.wins - row.wins) + Math.abs(career.losses - row.losses) + Math.abs(career.draws - row.draws);
    const fighter = index.fighters.get(row.id);
    items.push({
      key: row.id,
      title: row.name,
      subtitle: active.has(row.id) ? "Active" : "Inactive",
      date: fighter?.fights.at(-1)?.date,
      facts: [
        ["UFC results that differ", differing.join("; ")],
        ["Shown (Sherdog history)", `${recordText(career.wins, career.losses, career.draws)}${career.ncs ? ` (${career.ncs} NC)` : ""}`],
        ["UFCStats", recordText(row.wins, row.losses, row.draws)],
        ["UFC record here", fighter ? recordText(fighter.ufc.wins, fighter.ufc.losses, fighter.ufc.draws) : "–"],
      ],
      links: [
        fighterLink(row.id, row.name),
        { label: "UFCStats", href: `${UFCSTATS}/fighter-details/${row.id}` },
        ...(row.source_url ? [{ label: "Sherdog", href: row.source_url }] : []),
      ],
      actions: [{ id: "career", label: "Re-verify record", target: row.id }],
      weight: (active.has(row.id) ? 1000 : 0) + differing.length * 10 + diff,
    });
  }
  items.sort((a, b) => b.weight - a.weight || (b.date ?? "").localeCompare(a.date ?? ""));
  return check({
    id: "record-mismatch",
    group: "Records",
    label: "UFC results differ between sources",
    description: "A UFC bout in the verified Sherdog history has a different result than UFCStats (a win on one side, a no contest or loss on the other), so the record we show disagrees with the fight page. Usually an overturned result one source hasn't updated. Differences in the regional part of a record aren't listed: UFCStats can't see those bouts, and every case checked was UFCStats miscounting. Active fighters come first.",
    grade: (item) => item.subtitle === "Active" ? "must" : "minor",
  }, items.map(({ weight: _weight, ...item }) => item));
}

function rankedRecordGaps(): BugCheck {
  const rows = db.prepare(`
    SELECT r.ranking_type, r.division, r.rank, r.fighter_name, fr.id, cp.status
    FROM rankings r LEFT JOIN fighters fr ON fr.id = r.fighter_id
    LEFT JOIN career_profiles cp ON cp.fighter_id = fr.id
    WHERE fr.id IS NULL OR cp.status IS NULL OR cp.status != 'verified'
    ORDER BY r.ranking_type, r.division, r.div_pos
  `).all() as { ranking_type: string; division: string; rank: string; fighter_name: string; id: string | null; status: string | null }[];
  return check({
    id: "ranked-record-gaps",
    group: "Records",
    label: "Ranked fighters without a linked, verified history",
    description: "Top 15 records need linked fighter identities and verified professional histories. Missing links or histories can undercount meetings with current ranked opponents. Re-sync rankings for missing identities; re-verify linked fighters' histories.",
    grade: "must",
  }, rows.map((row) => ({
    key: `${row.ranking_type}:${row.division}:${row.rank}:${row.fighter_name}`,
    title: row.fighter_name,
    subtitle: `${row.ranking_type} · ${row.division} · ${row.rank}`,
    facts: [["History", row.id ? row.status ?? "never checked" : "fighter identity missing"]],
    links: [{ label: "Rankings", href: "/rankings", internal: true }, ...(row.id ? [fighterLink(row.id, row.fighter_name)] : [])],
    actions: row.id ? [{ id: "career", label: "Re-verify history", target: row.id }] : [],
  })));
}

function rankedHistoryGaps(): BugCheck {
  return check({
    id: "ranked-history-gaps",
    group: "Records",
    label: "Ranked fighters missing ranking data",
    description: "Current ranks must appear in the latest stored list for their source and division. Missing rows or fighter links leave profile charts and past matchup ranks incomplete. Re-reading rankings stores the current list and retries unmatched names.",
    grade: "must",
  }, missingCurrentRankingHistory().map(row => ({
    key: `${row.ranking_type}:${row.division}:${row.rank}:${row.fighter_name}`,
    title: row.fighter_name,
    subtitle: `${row.ranking_type} · ${row.division} · ${row.rank}`,
    facts: [["Latest stored list", row.as_of ?? "none"], ["Missing", row.fighter_id ? "linked ranking entry" : "fighter identity"]],
    links: [{ label: "Rankings", href: "/rankings", internal: true }, ...(row.fighter_id ? [fighterLink(row.fighter_id, row.fighter_name)] : [])],
    actions: [{ id: "rankings", label: "Re-read rankings", target: "all" }],
  })));
}

function titleRankingEvidenceGaps(): BugCheck {
  const confirmed = new Set(confirmedTitleResults().map(result => result.id));
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.title_type, f.f1_outcome, f.f2_outcome, e.wiki_title, e.wiki_checked_at,
      f1.id AS linked_f1, f2.id AS linked_f2
    FROM fights f JOIN events e ON e.id = f.event_id
    LEFT JOIN fighters f1 ON f1.id = f.f1_id LEFT JOIN fighters f2 ON f2.id = f.f2_id
    WHERE f.title_fight = 1 AND f.title_type IN ('title', '') AND e.date <= date('now')
      AND e.date > (SELECT MIN(date) FROM (SELECT MAX(date) AS date FROM ranking_history GROUP BY ranking_type))
      AND (f.f1_outcome = 'win' OR f.f2_outcome = 'win')
      AND CASE WHEN f.f1_outcome = 'win' THEN f.f1_weight_miss ELSE f.f2_weight_miss END IS NULL
  `).all() as (FightRow & { title_type: string; f1_outcome: string | null; f2_outcome: string | null;
    wiki_title: string | null; wiki_checked_at: number | null; linked_f1: string | null; linked_f2: string | null })[];
  return check({
    id: "title-ranking-evidence",
    group: "Records",
    label: "Title results awaiting ranking confirmation",
    description: "An early champion update needs an identified undisputed title bout, linked fighters, matching win/loss outcomes and a successful weigh-in read after the event date. Missing evidence keeps the official ranking in place. A winner who missed weight is never promoted. Re-read the fight, event or weigh-ins to fill the gap.",
    grade: "must",
  }, rows.filter(row => !confirmed.has(row.id)).map(row => ({
    key: row.id,
    title: `${row.f1_name} vs ${row.f2_name}`,
    subtitle: `${row.event_name} · ${row.date}`,
    facts: [["Title type", row.title_type || "unknown"], ["Outcomes", `${row.f1_outcome ?? "unknown"} / ${row.f2_outcome ?? "unknown"}`],
      ["Fighter identities", row.linked_f1 && row.linked_f2 && row.f1_id !== row.f2_id ? "linked" : "missing or conflicting"],
      ["Weigh-ins", row.wiki_title && row.wiki_checked_at && row.wiki_checked_at >= Date.parse(row.date) ? "read" : "not confirmed"]],
    links: [{ label: "Fight", href: `/fights/${row.id}`, internal: true }],
    actions: [{ id: "detail", label: "Re-read fight", target: row.id },
      { id: "event", label: "Re-read event", target: row.event_id },
      { id: "wiki", label: "Re-read weigh-ins", target: row.event_id }],
  })));
}

function rankingHistoryGaps(): BugCheck {
  const rows = db.prepare(`
    SELECT fighter_name, division, MIN(date) AS first, MAX(date) AS last, COUNT(*) AS lists
    FROM ranking_history WHERE fighter_id = '' GROUP BY fighter_name, division ORDER BY last DESC
  `).all() as { fighter_name: string; division: string; first: string; last: string; lists: number }[];
  const backfill = getMeta("ranking_history_backfill");
  // Lists change most weeks; three weeks without a new one means the sync
  // or ufc.com's page has broken, and every card since shows today's ranks.
  const newest = (db.prepare("SELECT MAX(date) AS date FROM ranking_history").get() as { date: string | null }).date;
  const stale = newest != null && Date.now() - Date.parse(`${newest}T00:00:00Z`) > 21 * 86_400_000;
  const relink = { id: "ranking-history" as const, label: "Link and load again", target: "all" };
  return check({
    id: "ranking-history",
    group: "Records",
    label: "Past rankings incomplete",
    description: "Past matchups show the rank each fighter held going in, and profiles chart it, from a list stored each time the rankings sync sees ufc.com's change. A ranked name without a fighter loses that rank everywhere; an unfinished backfill leaves weeks since June 2026 out. Linking retries every unmatched name (add a spelling to ARCHIVE_NAMES in ranking-history.ts if it still misses); loading again re-reads Wayback on the next sync pass.",
    grade: (item) => item.key === "backfill" ? "minor" : "must",
  }, [
    ...(stale ? [{
      key: "stale",
      title: "No new rankings list in three weeks",
      facts: [["Newest list", newest!], ["Last sync error", getMeta("last_sync_error") || "none"]] as [string, string][],
      links: [{ label: "ufc.com rankings", href: "https://www.ufc.com/rankings" }],
      actions: [],
    }] : []),
    ...(backfill === "done" ? [] : [{
      key: "backfill",
      title: "Past rankings still loading",
      facts: [["Stage", backfill === "archive" ? "archive loaded, Wayback pending" : "not started"]] as [string, string][],
      links: [],
      actions: [relink],
    }]),
    ...rows.map((row) => ({
      key: `${row.fighter_name}:${row.division}`,
      title: row.fighter_name,
      subtitle: `${row.division} · ${row.first} to ${row.last}`,
      facts: [["Lists", String(row.lists)]] as [string, string][],
      links: [{ label: "Rankings", href: "/rankings", internal: true }],
      actions: [relink],
    })),
  ]);
}

function unverifiedRecords(active: Set<string>): BugCheck {
  const rows = db.prepare(`
    SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, cp.status, cp.error, cp.source_url, cp.checked_at
    FROM fighters fr LEFT JOIN career_profiles cp ON cp.fighter_id = fr.id
    WHERE (cp.status IS NULL OR cp.status != 'verified')
      AND EXISTS (SELECT 1 FROM fights f WHERE f.f1_id = fr.id OR f.f2_id = fr.id)
  `).all() as { id: string; name: string; nickname: string; wins: number; losses: number; draws: number; status: string | null; error: string | null; source_url: string | null; checked_at: number | null }[];
  // A fighter on a card in the next two weeks is about to be looked up by
  // everyone reading that card.
  const booked = new Map((db.prepare(`
    SELECT f.f1_id AS id, MIN(e.date) AS date FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 0 AND e.date >= date('now', '-1 day') AND e.date <= date('now', '+14 day') GROUP BY f.f1_id
    UNION ALL SELECT f.f2_id, MIN(e.date) FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 0 AND e.date >= date('now', '-1 day') AND e.date <= date('now', '+14 day') GROUP BY f.f2_id
  `).all() as { id: string; date: string }[]).map((row) => [row.id, row.date]));
  const statusOrder: Record<string, number> = { error: 0, ambiguous: 1, not_found: 2, pending: 3 };
  const items = rows
    .filter((row) => active.has(row.id))
    .sort((a, b) => (statusOrder[a.status ?? "pending"] ?? 4) - (statusOrder[b.status ?? "pending"] ?? 4) || a.name.localeCompare(b.name))
    .map((row): BugItem => ({
      key: row.id,
      title: row.name,
      subtitle: row.nickname ? `"${row.nickname}"` : undefined,
      date: booked.get(row.id),
      facts: [
        ...(booked.has(row.id) ? [["Booked", `fights ${booked.get(row.id)}`] as [string, string]] : []),
        ["Status", row.status ?? "never checked"],
        ...(row.error ? [["Reason", row.error] as [string, string]] : []),
        ["Shown instead (UFCStats)", recordText(row.wins, row.losses, row.draws)],
        ["Checked", ago(row.checked_at)],
      ],
      links: [
        fighterLink(row.id, row.name),
        { label: "UFCStats", href: `${UFCSTATS}/fighter-details/${row.id}` },
        ...(row.source_url ? [{ label: "Sherdog candidate", href: row.source_url }] : []),
        sherdogSearch(row.name),
      ],
      actions: [{ id: "career", label: "Retry verification", target: row.id }],
    }));
  return check({
    id: "record-unverified",
    group: "Records",
    label: "Active fighters without a verified history",
    description: "No Sherdog history could be tied to the fighter, so their profile shows only the UFCStats record: no outside-UFC bouts and no Road to UFC numbers. \"Ambiguous\" means candidates were found but none matched the UFC bouts closely enough.",
    grade: (item) => booked.has(item.key) ? "critical" : "must",
  }, items);
}

function unlinkedUfcBouts(): BugCheck {
  const rows = db.prepare(`
    SELECT b.fighter_id, fr.name, b.date, b.opponent_name, b.event_name, b.event_url, b.outcome, b.method, cp.source_url
    FROM career_bouts b JOIN fighters fr ON fr.id = b.fighter_id
    LEFT JOIN career_profiles cp ON cp.fighter_id = b.fighter_id
    WHERE b.is_ufc = 1 AND b.ufc_fight_id IS NULL
      AND b.event_name NOT LIKE '%Road to UFC%' AND b.event_name NOT LIKE '%Contender Series%'
      AND b.event_name NOT LIKE '%Ultimate Fighter%'
      -- UFCStats starts at UFC 2, so UFC 1 rows can never link.
      AND b.event_name NOT LIKE 'UFC 1 -%'
    ORDER BY b.date DESC
  `).all() as { fighter_id: string; name: string; date: string; opponent_name: string; event_name: string; event_url: string | null; outcome: string; method: string; source_url: string | null }[];
  const onDate = db.prepare(`
    SELECT f.id, f.f1_name, f.f2_name FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND abs(julianday(e.date) - julianday(?)) <= 2
  `);
  return check({
    id: "ufc-bout-unlinked",
    group: "Records",
    label: "Sherdog UFC bouts with no matching UFCStats fight",
    description: "Sherdog lists a UFC bout that isn't linked to any of our fights. It might be under a different opponent spelling, a bout UFCStats doesn't have, or a history row given to the wrong fighter. A candidate bout on the same date usually points to a name mismatch.",
    grade: "minor",
  }, rows.map((row): BugItem => {
    const nearby = onDate.all(row.fighter_id, row.fighter_id, row.date) as { id: string; f1_name: string; f2_name: string }[];
    return {
      key: `${row.fighter_id}:${row.date}:${row.opponent_name}`,
      title: `${row.name} vs ${row.opponent_name}`,
      subtitle: row.event_name,
      date: row.date,
      facts: [
        ["Sherdog result", `${row.outcome}${row.method ? ` · ${row.method}` : ""}`],
        ["Our bout on that date", nearby.map((f) => `${f.f1_name} vs ${f.f2_name}`).join("; ") || "none"],
      ],
      links: [
        fighterLink(row.fighter_id, row.name),
        ...nearby.map((f) => ({ label: "Candidate matchup", href: `/fights/${f.id}`, internal: true })),
        ...(row.source_url ? [{ label: "Sherdog", href: row.source_url }] : []),
        ...(row.event_url ? [{ label: "Sherdog event", href: row.event_url }] : []),
      ],
      actions: [{ id: "career", label: "Re-verify record", target: row.fighter_id }],
    };
  }));
}

function unexplainedNoContests(): BugCheck {
  const rows = db.prepare(`
    SELECT b.method, COUNT(*) AS bouts, MIN(b.fighter_id) AS fighter_id
    FROM career_bouts b WHERE b.outcome = 'nc' AND b.method IS NOT NULL GROUP BY b.method
  `).all() as { method: string; bouts: number; fighter_id: string }[];
  const name = db.prepare("SELECT name FROM fighters WHERE id = ?");
  return check({
    id: "nc-reason-unknown",
    group: "Records",
    label: "No contests with no short reason",
    description: "Compact results (Last five, rankings) shorten a no contest's method to a few words, like \"Groin strike\" or \"Result overturned\". These methods name a cause no rule in server/src/no-contest.ts recognises, so they show only the NC mark. Add a rule if the cause can be said plainly.",
    grade: "minor",
  }, rows.filter((row) => noContestUnexplained(row.method)).map((row): BugItem => {
    const fighter = (name.get(row.fighter_id) as { name: string } | undefined)?.name ?? row.fighter_id;
    return {
      key: row.method,
      title: row.method,
      facts: [["Bouts", String(row.bouts)]],
      links: [fighterLink(row.fighter_id, fighter)],
      actions: [],
    };
  }));
}

function fightsMissingFromHistory(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, side.fighter_id, side.name, cp.source_url
    FROM fights f JOIN events e ON e.id = f.event_id
    JOIN (SELECT id, f1_id AS fighter_id, f1_name AS name FROM fights UNION ALL SELECT id, f2_id, f2_name FROM fights) side ON side.id = f.id
    JOIN career_profiles cp ON cp.fighter_id = side.fighter_id AND cp.status = 'verified'
    WHERE e.complete = 1 AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM career_bouts b WHERE b.ufc_fight_id = f.id AND b.fighter_id = side.fighter_id)
    ORDER BY e.date DESC
  `).all() as (FightRow & { fighter_id: string; name: string; source_url: string | null })[];
  return check({
    id: "ufc-fight-missing-from-history",
    group: "Records",
    label: "UFC fights missing from a verified history",
    description: "A completed UFC fight is missing from the fighter's verified Sherdog history, so their career record is short by one. Sherdog may not have added a recent result yet, or the reconciliation missed the row.",
    grade: "must",
  }, rows.map((row) => ({
    ...fightItem(row, {
      facts: [["Missing from", row.name]],
      links: [fighterLink(row.fighter_id, row.name), ...(row.source_url ? [{ label: "Sherdog", href: row.source_url }] : [])],
      actions: [{ id: "career", label: `Re-verify ${row.name}`, target: row.fighter_id }],
    }),
    key: `${row.id}:${row.fighter_id}`,
  })));
}

function duplicateFighters(): BugCheck {
  // Only profiles a reader can reach: booked or fought, or signed. A stray
  // UFCStats directory entry with no bout has no page and is never searched,
  // so it can't be confused with the one that does (often that same signee).
  const rows = db.prepare(`
    WITH visible AS (SELECT * FROM fighters fr WHERE fr.signee = 1 OR ${ufcFightExistsSql("fr.id", "f")})
    SELECT fr.id, fr.name, fr.norm_name, fr.wins, fr.losses, fr.draws, fr.weight,
           (SELECT MAX(e.date) FROM fights f JOIN events e ON e.id = f.event_id WHERE f.f1_id = fr.id OR f.f2_id = fr.id) AS last_fight
    FROM visible fr
    WHERE fr.norm_name IN (SELECT norm_name FROM visible GROUP BY norm_name HAVING COUNT(*) > 1)
    ORDER BY fr.norm_name, last_fight DESC
  `).all() as { id: string; name: string; norm_name: string; wins: number; losses: number; draws: number; weight: string; last_fight: string | null }[];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.norm_name, [...(groups.get(row.norm_name) ?? []), row]);
  return check({
    id: "duplicate-fighter-names",
    group: "Fighters",
    label: "Different fighters with the same name",
    description: "More than one fighter with a profile (booked, fought or signed) goes by this name. Usually they really are different people, but name-only matching (odds, rankings, search) can pick the wrong one. Check that each record and weight looks like a separate person.",
    grade: "ok",
  }, [...groups.values()].map((group): BugItem => ({
    key: group[0].norm_name,
    title: group[0].name,
    subtitle: `${group.length} fighters`,
    facts: group.map((row) => [row.id, `${recordText(row.wins, row.losses, row.draws)} · ${row.weight || "?"} · last ${row.last_fight ?? "never fought"}`]),
    links: group.flatMap((row) => [
      { label: `Profile ${row.id.slice(0, 6)}`, href: `/fighters/${row.id}`, internal: true },
      { label: `UFCStats ${row.id.slice(0, 6)}`, href: `${UFCSTATS}/fighter-details/${row.id}` },
    ]),
    actions: [],
  })));
}

function sharedCareerProfiles(): BugCheck {
  const rows = db.prepare(`
    WITH shown AS (
      -- A UFCStats page with no UFC bout (a booking that fell through) is no
      -- profile anyone sees; the signee stays the one shown until they fight.
      SELECT cp.source_url, fr.id, fr.name, fr.signee FROM career_profiles cp JOIN fighters fr ON fr.id = cp.fighter_id
      WHERE cp.status = 'verified' AND (fr.signee = 1 OR ${ufcFightExistsSql("fr.id", "f")}))
    SELECT * FROM shown WHERE source_url IN (SELECT source_url FROM shown GROUP BY source_url HAVING COUNT(*) > 1)
    ORDER BY source_url, signee, name
  `).all() as { source_url: string; id: string; name: string; signee: number }[];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.source_url, [...(groups.get(row.source_url) ?? []), row]);
  return check({
    id: "career-shared-source",
    group: "Fighters",
    label: "One person with two profiles",
    description: "Two fighters were verified against the same Sherdog page, so they are one person with two profiles, usually a signee whose Wikipedia name differs from UFCStats' (Joseph / Joe). Their opponents can't be linked to either. Re-read the roster moves to drop the signee; if the names don't match, extend the name matching in server/src/roster-moves.ts.",
    grade: "minor",
  }, [...groups.entries()].map(([url, group]): BugItem => ({
    key: url,
    title: group.map((row) => row.name).join(" / "),
    subtitle: `${group.length} profiles`,
    facts: group.map((row) => [row.name, row.signee ? "signee" : "UFCStats"]),
    links: [...group.map((row) => fighterLink(row.id, row.name)), { label: "Sherdog", href: url }],
    actions: group.some((row) => row.signee) ? [{ id: "roster-moves", label: "Re-read roster moves", target: "wikipedia" }] : [],
  })));
}

function searchAliasMisses(): BugCheck {
  // The same fighters search indexes: those with a UFC bout.
  const counts = new Map((db.prepare(`
    SELECT fr.norm_name, COUNT(*) AS n FROM fighters fr WHERE ${ufcFightExistsSql("fr.id", "f")} GROUP BY fr.norm_name
  `).all() as { norm_name: string; n: number }[]).map((row) => [row.norm_name, row.n]));
  return check({
    id: "search-alias-misses",
    group: "Fighters",
    label: "Search aliases that miss",
    description: "A name in server/src/search-aliases.ts no longer matches exactly one fighter with a UFC bout, so its aliases find nobody or more than one fighter. Fix the name in the file.",
    grade: "minor",
  }, Object.keys(SEARCH_ALIASES).flatMap((name): BugItem[] => {
    const found = counts.get(normName(name)) ?? 0;
    return found === 1 ? [] : [{
      key: name,
      title: name,
      subtitle: found ? `${found} fighters share this name` : "No fighter with this name",
      facts: [["Aliases", SEARCH_ALIASES[name].join(", ")]],
      links: [],
      actions: [],
    }];
  }));
}

// ---------------------------------------------------------------------------
// fights, events, fighters

function decisionsWithoutJudges(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.method, f.detail_fetched_at
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.method LIKE '%DEC' AND (f.detail_json IS NULL OR f.detail_json NOT LIKE '%"judges":[{%')
      -- UFCStats has no scorecards for 2002 and earlier, so nothing there is fixable.
      AND e.date >= '2003-01-01'
    ORDER BY e.date DESC
  `).all() as (FightRow & { method: string; detail_fetched_at: number | null })[];
  return check({
    id: "decision-no-judges",
    group: "Fights & events",
    label: "Decisions without judges' scorecards",
    description: "The bout went to the judges but no scorecards are stored, so it's missing from the judges' room and the scorecard panel. Bouts from 2002 and earlier are skipped, since UFCStats never had their scorecards. For recent bouts, re-fetching usually fixes it.",
    grade: recent([[3, "must"], [365, "minor"]]),
  }, rows.map((fight) => fightItem(fight, {
    facts: [["Method", fight.method], ["Detail fetched", ago(fight.detail_fetched_at)]],
    actions: [{ id: "detail", label: "Re-fetch fight detail", target: fight.id }],
  })));
}

function decisionsWithoutJudgeRounds(): BugCheck {
  const candidates = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.method, f.detail_json, f.judge_rounds_json, f.verdict_checked_at
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.method LIKE '%DEC' AND e.date >= '2003-01-01'
    ORDER BY e.date DESC
  `).all() as (FightRow & { method: string; detail_json: string | null; judge_rounds_json: string | null; verdict_checked_at: number | null })[];
  const rows = candidates.filter(fight => {
    if (!fight.judge_rounds_json) return true;
    try {
      const detail = fight.detail_json ? JSON.parse(fight.detail_json) : null;
      const imported = JSON.parse(fight.judge_rounds_json);
      return !hasCompleteJudgeRounds(Array.isArray(detail?.judges) ? detail.judges : [],
        Array.isArray(imported?.judges) ? imported.judges : []);
    } catch { return true; }
  });
  return check({
    id: "decision-no-judge-rounds",
    group: "Scorecards",
    label: "Official cards missing round scores",
    description: "Decisions since 2003 where one or more official cards still lack round scores. The Verdict and MMA Decisions imports match the event date and both fighter names, then verify each judge's final total before attaching rounds.",
    grade: recent([[7, "minor"]]),
  }, rows.map(fight => fightItem(fight, {
    facts: [["Official totals", fight.detail_json?.includes('"judges"') ? "yes" : "no"], ["Verdict checked", ago(fight.verdict_checked_at)]],
    links: [{ label: "Verdict events", href: "https://verdictmma.com/events" }],
  })));
}

function fightsWithoutCommunityScores(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.method, f.round, f.verdict_checked_at
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND (f.method LIKE '%DEC' OR CAST(f.round AS INTEGER) > 1)
      AND (f.community_score_json IS NULL OR json_valid(f.community_score_json) = 0)
    ORDER BY e.date DESC
  `).all() as (FightRow & { method: string; round: string | null; verdict_checked_at: number | null })[];
  return check({
    id: "fight-no-community-scores",
    group: "Scorecards",
    label: "Fights missing community scorecards",
    description: "Completed bouts with at least one scoreable round but no imported community aggregate. Imported counts and averages stay separate from user profiles and are weighted with new ufc.sh cards at read time.",
    grade: recent([[7, "minor"]]),
  }, rows.map(fight => fightItem(fight, {
    facts: [["Method", fight.method ?? "unknown"], ["Rounds reached", fight.round ?? "unknown"], ["Verdict checked", ago(fight.verdict_checked_at)]],
    links: [{ label: "Verdict events", href: "https://verdictmma.com/events" }],
  })));
}

function invalidCommunityScores(): BugCheck {
  const rows = db.prepare(`SELECT ${FIGHT_COLUMNS}, f.method, f.round, f.community_score_json
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.community_score_json IS NOT NULL ORDER BY e.date DESC`)
    .all() as (FightRow & { method: string; round: string | null; community_score_json: string })[];
  const invalid = rows.filter(fight => !parseCommunityScorecard(fight.community_score_json, completedScorecardRounds(fight)));
  return check({
    id: "fight-invalid-community-scores", group: "Scorecards", label: "Community scorecards with incompatible rounds or averages",
    description: "Stored source aggregates must cover exactly the bout's completed rounds, with consecutive rounds and totals consistent with their round averages. Incompatible aggregates are excluded from displayed averages until the source is corrected.",
    grade: recent([[7, "minor"]]),
  }, invalid.map(fight => {
    let source: any = null;
    try { source = JSON.parse(fight.community_score_json); } catch { /* malformed source */ }
    const matched = typeof source?.sourceUrl === "string"
      ? source.sourceUrl.match(/^https:\/\/verdictmma\.com\/event\/(\d+)\/fight\/\d+$/) : null;
    return fightItem(fight, {
      facts: [["Completed rounds", String(completedScorecardRounds(fight))],
        ["Source rounds", Array.isArray(source?.rounds) ? String(source.rounds.length) : "invalid"]],
      links: matched ? [{ label: "Stored scorecard", href: source.sourceUrl }] : [],
      actions: matched ? [{ id: "verdict", label: "Re-read source scorecards", target: `card:${matched[1]}` }] : [],
    });
  }));
}

function verdictImportErrors(): BugCheck {
  const fights = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.verdict_error, f.verdict_checked_at
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.verdict_error IS NOT NULL ORDER BY e.date DESC
  `).all() as (FightRow & { verdict_error: string; verdict_checked_at: number | null })[];
  const cards = db.prepare(`SELECT verdict_id, date, checked_at, error FROM verdict_events
    WHERE error IS NOT NULL ORDER BY verdict_id DESC`).all() as { verdict_id: number; date: string | null; checked_at: number; error: string }[];
  return check({
    id: "verdict-import-errors",
    group: "Scorecards",
    label: "Verdict reads that failed",
    description: "The last read of these Verdict pages failed: the page didn't load, didn't parse, or named other fighters. The background pass retries on its schedule; a retry here reads the card again now.",
    grade: recent([[7, "must"], [365, "minor"]]),
  }, [
    ...fights.map(fight => fightItem(fight, {
      facts: [["Error", fight.verdict_error], ["Verdict checked", ago(fight.verdict_checked_at)]],
      actions: [{ id: "verdict", label: "Retry Verdict", target: fight.id }],
    })),
    ...cards.map(card => ({
      key: `verdict-${card.verdict_id}`,
      title: `Verdict card ${card.verdict_id}`,
      date: card.date ?? undefined,
      facts: [["Error", card.error], ["Tried", ago(card.checked_at)]] as [string, string][],
      links: [{ label: "Verdict card", href: `https://verdictmma.com/event/${card.verdict_id}` }],
      actions: [{ id: "verdict" as const, label: "Retry Verdict", target: `card:${card.verdict_id}` }],
    })),
  ]);
}

function untrustworthyFightStats(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.round, f.f1_str, f.f2_str, f.f1_td, f.f2_td, f.f1_kd, f.f2_kd, f.f1_sub, f.f2_sub,
      f.detail_json, f.detail_fetched_at
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.detail_json IS NOT NULL
      AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
    ORDER BY e.date DESC
  `).all() as (FightRow & { detail_fetched_at: number | null; detail_json: string })[];
  const items = rows.flatMap((fight) => {
    const issues = validateFightActions(fight);
    return issues.length ? [fightItem(fight, {
      facts: [["Problem", issues.join("; ")], ["Detail fetched", ago(fight.detail_fetched_at)]],
      actions: [{ id: "event", label: "Re-fetch event", target: fight.event_id }, { id: "detail", label: "Re-fetch fight detail", target: fight.id }],
    })] : [];
  });
  return check({
    id: "fight-stats-untrustworthy",
    group: "Fights & events",
    label: "Stored stats that contradict the source",
    description: "The stored fight page disagrees with the card's summary row, or its per-round tables stop short of the round the bout ended in — the shape of a page read while the bout was still being fought. Re-fetching the event and then the fight detail settles both.",
    grade: "critical",
  }, items);
}

/** Missing samples remain visible here rather than silently becoming zero rates. */
function careerStatGaps(): BugCheck {
  const items = fightIndex().fights.flatMap(fight => {
    const gaps = new Set<string>();
    if (fight.elapsed == null) gaps.add("Fight time");
    for (const side of fight.sides) {
      if (side.actions.significantStrikes?.attempted == null) gaps.add("Significant strike attempts");
      if (side.actions.takedowns?.attempted == null) gaps.add("Takedown attempts");
      if (!side.actions.knockdowns) gaps.add("Knockdowns");
      if (!side.actions.submissions) gaps.add("Submission attempts");
    }
    if (fight.sides.some(side => side.actions.control) && fight.sides.some(side => !side.actions.control)) gaps.add("Paired control time");
    return gaps.size ? [fightItem({ ...fight.row, event_name: fight.eventName, date: fight.date }, {
      facts: [["Missing samples", [...gaps].join("; ")]],
      actions: [{ id: "event", label: "Re-fetch event", target: fight.eventId }, { id: "detail", label: "Re-fetch fight detail", target: fight.id }],
    })] : [];
  }).reverse();
  return check({
    id: "career-stat-gaps", group: "Fighters", label: "Career statistics missing samples",
    description: "Completed bouts missing attempt counts, recorded actions or fight time. Those samples are excluded from the corresponding career averages. Re-fetch the event and fight detail when the source has the data; some older bouts never recorded every statistic.",
    grade: "minor",
  }, items);
}

function upcomingWithoutSegment(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, e.ufc_slug, e.segments_fetched_at
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 0 AND f.segment IS NULL
      -- ufc.com only splits a card close to the event, so earlier than a week out
      -- a missing segment is a problem only when the rest of the card is placed.
      AND (e.date <= date('now', '+7 day')
        OR EXISTS (SELECT 1 FROM fights o WHERE o.event_id = f.event_id AND o.segment IS NOT NULL))
    ORDER BY e.date ASC, f.ord ASC
  `).all() as (FightRow & { ufc_slug: string | null; segments_fetched_at: number | null })[];
  return check({
    id: "upcoming-no-segment",
    group: "Fights & events",
    label: "Upcoming bouts not placed on a broadcast",
    description: "The bout isn't placed under early prelims, prelims or main card, so it has no estimated start time. Usually ufc.com hasn't listed it yet (a new booking), or its names differ from UFCStats.",
    grade: ahead([[3, "must"], [14, "minor"]]),
  }, rows.map((fight) => fightItem(fight, {
    facts: [["ufc.com slug", fight.ufc_slug ?? "none"], ["Segments read", ago(fight.segments_fetched_at)]],
    links: fight.ufc_slug ? [{ label: "ufc.com event", href: `https://www.ufc.com/event/${fight.ufc_slug}` }] : [],
    actions: fight.ufc_slug ? [{ id: "segments", label: "Re-read ufc.com card", target: fight.event_id }] : [],
  })));
}

function staleEvents(): BugCheck {
  const rows = db.prepare(`
    SELECT e.id, e.name, e.date, e.detail_fetched_at,
      (SELECT COUNT(*) FROM fights f WHERE f.event_id = e.id) AS bouts,
      (SELECT COUNT(*) FROM fights f WHERE f.event_id = e.id AND f.f1_outcome IS NULL AND f.f2_outcome IS NULL AND f.method IS NULL) AS open
    FROM events e
    WHERE (e.complete = 0 AND e.date < date('now', '-2 day'))
       OR (e.complete = 1 AND EXISTS (SELECT 1 FROM fights f WHERE f.event_id = e.id AND f.f1_outcome IS NULL AND f.f2_outcome IS NULL AND f.method IS NULL))
       OR NOT EXISTS (SELECT 1 FROM fights f WHERE f.event_id = e.id)
       OR (e.complete = 0 AND e.date >= date('now') AND COALESCE(e.detail_fetched_at, 0) < ?)
    ORDER BY e.date DESC
  `).all(Date.now() - 60 * 60_000) as { id: string; name: string; date: string; detail_fetched_at: number | null; bouts: number; open: number }[];
  const fresh = new Set(rows.filter((event) => !event.bouts && (event.detail_fetched_at ?? 0) > Date.now() - 86_400_000).map((event) => event.id));
  return check({
    id: "event-stale",
    group: "Fights & events",
    label: "Events with missing results, no bouts or a stale card",
    description: "A past event still isn't marked complete, a completed event has bouts without a result, an event has no bouts at all, or an upcoming card hasn't been read from UFCStats in over an hour.",
    grade: (item) => {
      const days = daysFrom(item.date) ?? 0;
      // A card announced weeks out, freshly read, that UFCStats lists no bouts for yet.
      if (days > 21 && fresh.has(item.key)) return "ok";
      return Math.abs(days) <= 7 ? "critical" : days > 7 ? "minor" : "must";
    },
  }, rows.map((event): BugItem => ({
    key: event.id,
    title: event.name,
    date: event.date,
    facts: [["Bouts", String(event.bouts)], ["Without result", String(event.open)], ["Detail fetched", ago(event.detail_fetched_at)]],
    links: [eventLink(event.id), { label: "UFCStats", href: `${UFCSTATS}/event-details/${event.id}` }],
    actions: [{ id: "event", label: "Re-fetch event", target: event.id }],
  })));
}

function eventsWithoutWiki(): BugCheck {
  const rows = db.prepare(`
    SELECT id, name, date, wiki_checked_at FROM events
    WHERE complete = 1 AND wiki_title IS NULL AND wiki_checked_at IS NOT NULL
    ORDER BY date DESC
  `).all() as { id: string; name: string; date: string; wiki_checked_at: number }[];
  return check({
    id: "event-no-wiki",
    group: "Fights & events",
    label: "Events with no Wikipedia article found",
    description: "No Wikipedia article was found, so this event's missed weigh-ins are unknown (not the same as \"everyone made weight\"). Usually a Fight Night whose article has a different title. Re-checking queues it for the next background pass.",
    grade: recent([[90, "minor"]]),
  }, rows.map((event): BugItem => ({
    key: event.id,
    title: event.name,
    date: event.date,
    facts: [["Checked", ago(event.wiki_checked_at)]],
    links: [
      eventLink(event.id),
      { label: "Wikipedia search", href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(event.name)}` },
    ],
    actions: [{ id: "wiki", label: "Queue re-check", target: event.id }],
  })));
}

const DIVISION_LIMITS: Record<string, number> = {
  Strawweight: 115, Flyweight: 125, Bantamweight: 135, Featherweight: 145,
  Lightweight: 155, Welterweight: 170, Middleweight: 185, "Light Heavyweight": 205, Heavyweight: 265,
};

function weightMissesUnderLimit(): BugCheck {
  const rows = db.prepare(`
    SELECT f.id, f.event_id, f.f1_name, f.f2_name, f.weight_class, f.f1_weight_miss, f.f2_weight_miss,
      e.name AS event_name, e.date, e.wiki_title
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.f1_weight_miss IS NOT NULL OR f.f2_weight_miss IS NOT NULL
    ORDER BY e.date DESC
  `).all() as { id: string; event_id: string; f1_name: string; f2_name: string; weight_class: string;
    f1_weight_miss: string | null; f2_weight_miss: string | null; event_name: string; date: string; wiki_title: string | null }[];
  const items = rows.flatMap((fight) => {
    const limit = DIVISION_LIMITS[fight.weight_class.replace(/^Women's /, "")];
    return ([[fight.f1_name, fight.f1_weight_miss], [fight.f2_name, fight.f2_weight_miss]] as const)
      .filter(([, pounds]) => limit != null && pounds && Number(pounds) <= limit)
      .map(([name, pounds]): BugItem => ({
        key: `${fight.id}:${name}`,
        title: `${name}: ${pounds} lb at ${fight.weight_class}`,
        subtitle: `${fight.f1_name} vs ${fight.f2_name} · ${fight.event_name}`,
        date: fight.date,
        facts: [["Recorded weight", `${pounds} lb`], ["Division limit", `${limit} lb`]],
        links: [
          ...fightLinks(fight.id),
          ...(fight.wiki_title ? [{ label: "Event article", href: `https://en.wikipedia.org/wiki/${encodeURIComponent(fight.wiki_title.replace(/ /g, "_"))}` }] : []),
        ],
        actions: [{ id: "wiki", label: "Re-read weigh-ins", target: fight.event_id }],
      }));
  });
  return check({
    id: "weight-miss-under-limit",
    group: "Fights & events",
    label: "Missed weight at or under the division limit",
    description: "A fighter is marked as missing weight at a weight that makes the bout's division. Usually the article's sentence was about someone else (a namesake, or another bout on the card); sometimes the bout really moved up a division after the miss. Re-reading queues the event's weigh-ins for the next background pass.",
    grade: "minor",
  }, items);
}

function catchweightsWithoutLimit(): BugCheck {
  const rows = db.prepare(`
    SELECT f.id, f.event_id, f.f1_name, f.f2_name, f.catch_weight_checked_at, e.name AS event_name, e.date, e.wiki_title
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.weight_class = 'Catch Weight' AND f.catch_weight IS NULL
    ORDER BY e.date DESC
  `).all() as { id: string; event_id: string; f1_name: string; f2_name: string; catch_weight_checked_at: number | null; event_name: string; date: string; wiki_title: string | null }[];
  return check({
    id: "catchweight-no-limit",
    group: "Fights & events",
    label: "Catchweight bouts without their weight",
    description: "Catchweight bouts whose agreed limit is unknown, so profiles say \"Catch Weight\" without the pounds. It is read from the event's Wikipedia results table, then from either fighter's record table; a bout neither mentions stays here. Re-checking reads both again now.",
    grade: ahead([[7, "minor"]]),
  }, rows.map((fight): BugItem => ({
    key: fight.id,
    title: `${fight.f1_name} vs ${fight.f2_name}`,
    subtitle: fight.event_name,
    date: fight.date,
    facts: [["Checked", ago(fight.catch_weight_checked_at)], ["Article", fight.wiki_title ?? "none found"]],
    links: [
      ...fightLinks(fight.id),
      eventLink(fight.event_id),
      ...(fight.wiki_title ? [{ label: "Event article", href: `https://en.wikipedia.org/wiki/${encodeURIComponent(fight.wiki_title.replace(/ /g, "_"))}` }] : []),
      { label: `Wikipedia: ${fight.f1_name}`, href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(fight.f1_name)}` },
    ],
    actions: [{ id: "catchweight", label: "Re-check now", target: fight.id }],
  })));
}

function replacementsUnnamed(): BugCheck {
  const rows = db.prepare(`
    SELECT f.id, f.event_id, e.name AS event_name, e.date, e.wiki_title, f.f1_name AS name, f.f1_replaced AS replaced
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.f1_replaced = '' OR f.f1_replaced NOT LIKE '% %' OR (f.f1_short_notice = 1 AND f.f1_replaced IS NULL)
    UNION ALL
    SELECT f.id, f.event_id, e.name, e.date, e.wiki_title, f.f2_name, f.f2_replaced
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.f2_replaced = '' OR f.f2_replaced NOT LIKE '% %' OR (f.f2_short_notice = 1 AND f.f2_replaced IS NULL)
    ORDER BY date DESC
  `).all() as { id: string; event_id: string; event_name: string; date: string; wiki_title: string | null; name: string; replaced: string }[];
  return check({
    id: "replacement-unnamed",
    group: "Fights & events",
    label: "Replacements without the fighter they replaced",
    description: "The event article says this fighter came in as a replacement or on short notice, but not in a way we could read whom they replaced in full, so the matchup says \"Late replacement\", \"Took this fight on short notice\" or a surname alone. Read from the article's Background prose (boutChanges in scrape/wikipedia.ts); re-reading picks up a later edit.",
    grade: ahead([[7, "minor"]]),
  }, rows.map((row): BugItem => ({
    key: `${row.id}:${row.name}`,
    title: row.name,
    subtitle: row.event_name,
    date: row.date,
    facts: [["Replaced", row.replaced || "not said"]],
    links: [
      ...fightLinks(row.id),
      ...(row.wiki_title ? [{ label: "Event article", href: `https://en.wikipedia.org/wiki/${encodeURIComponent(row.wiki_title.replace(/ /g, "_"))}` }] : []),
    ],
    actions: [{ id: "article", label: "Re-read event article", target: row.event_id }],
  })));
}

function replacedWithoutProfile(): BugCheck {
  const rows = (db.prepare(`
    SELECT f.id, f.event_id, e.name AS event_name, e.date, f.weight_class, f.f1_name AS name, f.f1_replaced AS replaced, f.f1_replaced_id AS replaced_id
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.f1_replaced LIKE '% %'
    UNION ALL
    SELECT f.id, f.event_id, e.name, e.date, f.weight_class, f.f2_name, f.f2_replaced, f.f2_replaced_id
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.f2_replaced LIKE '% %'
    ORDER BY date DESC
  `).all() as { id: string; event_id: string; event_name: string; date: string; weight_class: string; name: string; replaced: string; replaced_id: string | null }[])
    .filter((row) => { const id = row.replaced_id || fighterNamed(row.replaced, row.weight_class, row.date); return !id || !hasUfcFight(id); });
  return check({
    id: "replaced-no-profile",
    group: "Fights & events",
    label: "Replaced fighters without a profile",
    description: "The fighter a replacement took the place of has no UFC profile we can link, so their name shows without a link. Often right (they never fought in the UFC); otherwise the article spells them differently from UFCStats.",
    grade: ahead([[14, "minor"]]),
  }, rows.map((row): BugItem => ({
    key: `${row.id}:${row.name}`,
    title: row.replaced,
    subtitle: `Replaced by ${row.name} · ${row.event_name}`,
    date: row.date,
    facts: [["Matched fighter", row.replaced_id ? "no UFC bouts" : "none"]],
    links: fightLinks(row.id),
    actions: [{ id: "article", label: "Re-read event article", target: row.event_id }],
  })));
}

function replacementsWithoutNotice(): BugCheck {
  const rows = db.prepare(`
    SELECT f.id, f.event_id, e.name AS event_name, e.date, e.wiki_title, f.f1_name AS name, f.f1_replaced AS replaced
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.f1_replaced IS NOT NULL AND f.f1_notice IS NULL
    UNION ALL
    SELECT f.id, f.event_id, e.name, e.date, e.wiki_title, f.f2_name, f.f2_replaced
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.f2_replaced IS NOT NULL AND f.f2_notice IS NULL
    ORDER BY date DESC
  `).all() as { id: string; event_id: string; event_name: string; date: string; wiki_title: string | null; name: string; replaced: string }[];
  return check({
    id: "replacement-no-notice",
    group: "Fights & events",
    label: "Replacements without their days' notice",
    description: "A replacement whose notice the event article doesn't state, so the matchup says \"Replaced X\" (or \"on short notice\") without how many days. Stated notice (\"on 10 days' notice\", \"less than two weeks before\", \"during fight week\") is read with the article; the rest wait for another source.",
    grade: ahead([[14, "minor"]]),
  }, rows.map((row): BugItem => ({
    key: `${row.id}:${row.name}`,
    title: row.name,
    subtitle: row.event_name,
    date: row.date,
    facts: [["Replaced", row.replaced || "not named"]],
    links: [
      ...fightLinks(row.id),
      ...(row.wiki_title ? [{ label: "Event article", href: `https://en.wikipedia.org/wiki/${encodeURIComponent(row.wiki_title.replace(/ /g, "_"))}` }] : []),
    ],
    actions: [{ id: "article", label: "Re-read event article", target: row.event_id }],
  })));
}

function fighterGaps(active: Set<string>): BugCheck {
  const rows = db.prepare(`
    SELECT id, name, photo_url, photo_checked_at, birth_date, birth_fetched_at, country, height, reach, stance
    FROM fighters ORDER BY name
  `).all() as { id: string; name: string; photo_url: string | null; photo_checked_at: number | null; birth_date: string; birth_fetched_at: number | null; country: string | null; height: string; reach: string; stance: string }[];
  const blank = (value: string | null) => !value || value === "--";
  const items: BugItem[] = [];
  for (const row of rows) {
    if (!active.has(row.id)) continue;
    const missing = [
      !row.photo_url && "photo",
      blank(row.birth_date) && "birth date",
      blank(row.country) && "country",
      blank(row.height) && "height",
      blank(row.reach) && "reach",
      blank(row.stance) && "stance",
    ].filter((field): field is string => Boolean(field));
    if (!missing.length) continue;
    items.push({
      key: row.id,
      title: row.name,
      facts: [["Missing", missing.join(", ")], ["Photo checked", ago(row.photo_checked_at)], ["Birth date checked", ago(row.birth_fetched_at)]],
      links: [
        fighterLink(row.id, row.name),
        { label: "UFCStats", href: `${UFCSTATS}/fighter-details/${row.id}` },
        { label: "ufc.com search", href: `https://www.ufc.com/athletes/all?search=${encodeURIComponent(row.name)}` },
      ],
      actions: blank(row.birth_date) ? [{ id: "birth", label: "Re-fetch birth date", target: row.id }] : [],
    });
  }
  return check({
    id: "fighter-profile-gaps",
    group: "Fighters",
    label: "Active fighters with profile gaps",
    description: "Fighters with a bout since the start of last year, or one booked, who are missing a photo, birth date (which drives age), country, height, reach or stance.",
    grade: "minor",
  }, items);
}


// ---------------------------------------------------------------------------
// venues, broadcasts and officials

type EventVenueRow = {
  id: string; name: string; date: string; complete: number; location: string; ufc_slug: string | null;
  venue_id: number | null; wiki_venue: string | null; wiki_title: string | null;
  venue_checked_at: number | null; wiki_info_checked_at: number | null; segments_fetched_at: number | null;
};

function venueLinks(event: EventVenueRow): BugLink[] {
  return [
    eventLink(event.id),
    ...(event.ufc_slug ? [{ label: "ufc.com event", href: `https://www.ufc.com/event/${event.ufc_slug}` }] : []),
    event.wiki_title
      ? { label: "Wikipedia", href: `https://en.wikipedia.org/wiki/${encodeURIComponent(event.wiki_title.replace(/ /g, "_"))}` }
      : { label: "Wikipedia search", href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(event.name)}` },
  ];
}

const venueActions = (event: EventVenueRow): BugItem["actions"] => [
  ...(event.ufc_slug ? [{ id: "segments" as const, label: "Re-read ufc.com card", target: event.id }] : []),
  { id: "article" as const, label: "Re-read event article", target: event.id },
];

const VENUE_COLUMNS = `id, name, date, complete, location, ufc_slug, venue_id, wiki_venue, wiki_title,
  venue_checked_at, wiki_info_checked_at, segments_fetched_at`;

function eventsWithoutVenue(): BugCheck {
  const rows = db.prepare(`
    SELECT ${VENUE_COLUMNS} FROM events
    WHERE venue_id IS NULL AND wiki_venue IS NULL
      AND (complete = 1 OR date <= date('now', '+60 day'))
      -- Not yet looked at is a backfill still running, not a gap: every source
      -- this card has must have been read before its silence counts.
      AND (ufc_slug IS NULL OR venue_checked_at IS NOT NULL)
      AND (wiki_title IS NULL OR wiki_info_checked_at IS NOT NULL)
      -- The article is looked for only in the last six weeks before a card.
      AND (complete = 1 OR wiki_info_checked_at IS NOT NULL)
      AND (ufc_slug IS NOT NULL OR wiki_title IS NOT NULL OR wiki_checked_at IS NOT NULL)
    ORDER BY date DESC
  `).all() as EventVenueRow[];
  return check({
    id: "event-no-venue",
    group: "Venues & officials",
    label: "Events with no venue",
    description: "Neither the promotion's live-card feed nor the event's Wikipedia article named a venue, so the event has no venue page and matchups show only the city. Pre-2011 cards have no ufc.com page; their venue can only come from Wikipedia.",
    grade: (item) => { const days = daysFrom(item.date); return days != null && days >= -30 && days <= 14 ? "must" : "minor"; },
  }, rows.map((event): BugItem => ({
    key: event.id,
    title: event.name,
    subtitle: event.location,
    date: event.date,
    facts: [
      ["ufc.com slug", event.ufc_slug ?? "none (card predates ufc.com's archive or was never matched)"],
      ["Feed read", ago(event.venue_checked_at)],
      ["Article read", ago(event.wiki_info_checked_at)],
      ["Article", event.wiki_title ?? "not found"],
    ],
    links: venueLinks(event),
    actions: venueActions(event),
  })));
}

const placeKey = (text: string | null | undefined) =>
  (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** The promotion's feed or the event article placing a card in another city
 *  than UFCStats does: the page matched to the card was another event's. */
function venueInWrongCity(): BugCheck {
  const rows = db.prepare(`
    SELECT ${VENUE_COLUMNS}, venue_name, venue_city, wiki_city FROM events
    WHERE (venue_id IS NOT NULL AND venue_city IS NOT NULL) OR wiki_city IS NOT NULL ORDER BY date DESC
  `).all() as (EventVenueRow & { venue_name: string | null; venue_city: string | null; wiki_city: string | null })[];
  const feedWrong = (event: typeof rows[number]) => {
    const feed = placeKey(event.venue_city);
    const listed = event.location.split(",").map(placeKey);
    return Boolean(event.venue_id && feed && listed[0] && !listed.includes(feed));
  };
  const items = rows.flatMap((event): BugItem[] => {
    const base = { title: event.name, subtitle: event.location, date: event.date, links: venueLinks(event) };
    return [
      ...(feedWrong(event) ? [{
        ...base, key: event.id,
        facts: [["Feed venue", `${event.venue_name ?? "?"}, ${event.venue_city}`], ["ufc.com slug", event.ufc_slug ?? "none"]] as [string, string][],
        actions: [...venueActions(event).filter((action) => action.id === "segments"), { id: "forget-ufc" as const, label: "Forget ufc.com page", target: event.id }],
      }] : []),
      ...(!samePlace(event.wiki_city, event.location) ? [{
        ...base, key: `${event.id}:article`,
        facts: [["Article venue", `${event.wiki_venue ?? "?"}, ${event.wiki_city}`], ["Article", event.wiki_title ?? "?"]] as [string, string][],
        actions: venueActions(event).filter((action) => action.id === "article"),
      }] : []),
    ];
  });
  return check({
    id: "venue-wrong-city",
    group: "Venues & officials",
    label: "Venue in a different city from the card",
    description: "The promotion's feed or the event's Wikipedia article names a venue in another city than UFCStats gives for the card, so the page matched to it belongs to another event and its venue (and, from the feed, broadcasters and start times) are wrong. Re-reading the card rejects a page whose bouts or city aren't ours; a ufc.com page that lists no bouts has to be forgotten, after which the archive offers the card its own page.",
    grade: "must",
  }, items);
}

function venuesFromWikipediaOnly(): BugCheck {
  const rows = db.prepare(`
    SELECT ${VENUE_COLUMNS} FROM events WHERE venue_id IS NULL AND wiki_venue IS NOT NULL ORDER BY date DESC
  `).all() as EventVenueRow[];
  const index = venueIndex();
  // A name some other card already ties to the promotion's venue id is settled.
  const official = new Set((db.prepare("SELECT id FROM events WHERE venue_id IS NOT NULL").all() as { id: string }[]).map((row) => row.id));
  const unlinked = rows.filter((event) => !index.byEvent.get(event.id)?.events.some((card) => official.has(card.id)));
  return check({
    id: "venue-wikipedia-only",
    group: "Venues & officials",
    label: "Venues known only from Wikipedia",
    description: "The venue name comes from the event article alone, and no other card links that name to the promotion's venue id, so a renamed arena (Staples Center / Crypto.com Arena) can show as two venues. Cards whose name another card already ties to the id are left out. Re-reading the ufc.com card usually attaches the id; otherwise the name may need an alias.",
    grade: "ok",
  }, unlinked.map((event): BugItem => {
    const venue = index.byEvent.get(event.id);
    return {
      key: event.id,
      title: event.name,
      subtitle: `${event.wiki_venue} · ${event.location}`,
      date: event.date,
      facts: [["Grouped under", venue ? `${venue.name} (${venue.events.length} cards)` : "no venue"], ["ufc.com slug", event.ufc_slug ?? "none"]],
      links: [...venueLinks(event), ...(venue ? [{ label: `Venue: ${venue.name}`, href: `/venues/${venue.slug}`, internal: true }] : [])],
      actions: venueActions(event),
    };
  }));
}

function upcomingWithoutBroadcast(): BugCheck {
  const rows = db.prepare(`
    SELECT ${VENUE_COLUMNS}, broadcast_json FROM events
    WHERE complete = 0 AND date >= date('now', '-1 day') AND date <= date('now', '+14 day') AND broadcast_json IS NULL
    ORDER BY date ASC
  `).all() as (EventVenueRow & { broadcast_json: string | null })[];
  return check({
    id: "upcoming-no-broadcast",
    group: "Venues & officials",
    label: "Upcoming cards without a broadcaster",
    description: "Nothing says where this card airs. The promotion's feed usually names broadcasters in fight week; before that this is expected.",
    grade: ahead([[1, "must"], [7, "minor"]]),
  }, rows.map((event): BugItem => ({
    key: event.id, title: event.name, date: event.date,
    facts: [["Feed read", ago(event.venue_checked_at)], ["ufc.com slug", event.ufc_slug ?? "none"]],
    links: venueLinks(event),
    actions: event.ufc_slug ? [{ id: "segments", label: "Re-read ufc.com card", target: event.id }] : [],
  })));
}

function upcomingWithoutReporting(): BugCheck {
  const rows = db.prepare(`
    SELECT ${VENUE_COLUMNS} FROM events
    WHERE complete = 0 AND date >= date('now', '-1 day') AND date <= date('now', '+21 day')
      AND wiki_info_checked_at IS NOT NULL AND wiki_title IS NULL
    ORDER BY date ASC
  `).all() as EventVenueRow[];
  return check({
    id: "upcoming-no-article",
    group: "Venues & officials",
    label: "Upcoming cards with no event article",
    description: "No Wikipedia article was found, so the card has no venue name from the night, attendance or gate yet. A new card's article often appears a few weeks out.",
    grade: ahead([[7, "minor"]]),
  }, rows.map((event): BugItem => ({
    key: event.id, title: event.name, date: event.date,
    facts: [["Article", event.wiki_title ?? "not found"], ["Article read", ago(event.wiki_info_checked_at)]],
    links: venueLinks(event),
    actions: [{ id: "article", label: "Re-read event article", target: event.id }],
  })));
}

function fightsWithoutReferee(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.detail_fetched_at FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND f.detail_json IS NOT NULL
      AND COALESCE(json_extract(f.detail_json, '$.methodInfo.Referee'), '') = ''
    ORDER BY e.date DESC
  `).all() as (FightRow & { detail_fetched_at: number | null })[];
  return check({
    id: "fight-no-referee",
    group: "Venues & officials",
    label: "Completed bouts with no referee",
    description: "The official result page names no referee, so the bout is missing from every referee's record. Some early cards genuinely never recorded one.",
    grade: recent([[7, "minor"]]),
  }, rows.map((fight) => fightItem(fight, {
    facts: [["Detail fetched", ago(fight.detail_fetched_at)]],
    actions: [{ id: "detail", label: "Re-fetch fight detail", target: fight.id }],
  })));
}

function upcomingWithoutReferee(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, e.ufc_slug FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 0 AND e.date >= date('now', '-1 day') AND e.date <= date('now', '+2 day')
      AND f.f1_outcome IS NULL AND f.f2_outcome IS NULL AND f.referee_assigned IS NULL
    ORDER BY e.date ASC, f.ord ASC
  `).all() as (FightRow & { ufc_slug: string | null })[];
  return check({
    id: "upcoming-no-referee",
    group: "Venues & officials",
    label: "Fight-week bouts with no referee assigned",
    description: "The promotion usually assigns referees in its feed shortly before the card. Until then matchups show no referee.",
    grade: ahead([[0, "minor"]]),
  }, rows.map((fight) => fightItem(fight, {
    actions: fight.ufc_slug ? [{ id: "segments", label: "Re-read ufc.com card", target: fight.event_id }] : [],
  })));
}

function unnamedJudges(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS}, f.detail_json, f.judge_rounds_json FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.detail_json LIKE '%"judges"%'
      AND EXISTS (SELECT 1 FROM json_each(json_extract(f.detail_json, '$.judges')) j
        WHERE COALESCE(TRIM(json_extract(j.value, '$.judge')), '') = '')
    ORDER BY e.date DESC
  `).all() as (FightRow & { detail_json: string; judge_rounds_json: string | null })[];
  const unresolved = rows.filter(fight => {
    const official = JSON.parse(fight.detail_json).judges as JudgeCard[];
    let imported: JudgeCard[] = [];
    try { imported = JSON.parse(fight.judge_rounds_json ?? "{}").judges ?? []; } catch { /* malformed source remains a gap */ }
    return mergeJudgeRounds(official, Array.isArray(imported) ? imported : []).some(card => !card.judge?.trim());
  });
  return check({
    id: "judge-unnamed",
    group: "Venues & officials",
    label: "Scorecards with an unnamed judge",
    description: "The official card gives a score but no judge's name, so it counts toward the panel but toward no judge's profile. Common on early cards; MMA Decisions sometimes names them.",
    grade: "ok",
  }, unresolved.map((fight) => fightItem(fight, {
    links: [{ label: "MMA Decisions search", href: `http://mmadecisions.com/search.jsp?s=${encodeURIComponent(fight.f1_name.split(" ").at(-1) ?? "")}` }],
    actions: [
      ...(fight.judge_rounds_json?.includes("https://mmadecisions.com/decision/")
        ? [{ id: "judge-names" as const, label: "Recover judge names", target: fight.id }] : []),
      { id: "detail", label: "Re-fetch fight detail", target: fight.id },
    ],
  })));
}

type OfficialIdentity = ReturnType<typeof officialsIndex>["judges"] extends Map<string, infer V> ? V : never;

/** People the name matcher may have split: same surname, different first
 * names, careers that overlap. Merging is a decision for a person. */
function possibleDuplicateOfficials(): BugCheck {
  const index = officialsIndex();
  const items: BugItem[] = [];
  for (const [role, table] of [["judge", index.judges], ["referee", index.referees]] as const) {
    const bySurname = new Map<string, OfficialIdentity[]>();
    for (const identity of table.values()) {
      const surname = identity.key.split(" ").slice(1).join(" ");
      if (!surname) continue;
      bySurname.set(surname, [...(bySurname.get(surname) ?? []), identity]);
    }
    for (const group of bySurname.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        const firstA = a.key.split(" ")[0];
        const firstB = b.key.split(" ")[0];
        // An initial, or one first name starting the other, is the usual shape of one person listed twice.
        if (firstA[0] !== firstB[0]) continue;
        items.push({
          key: `${role}:${a.slug}:${b.slug}`,
          title: `${a.name} / ${b.name}`,
          subtitle: `Possible duplicate ${role}`,
          facts: [
            [a.name, `${a.fights.length} bouts · ${a.fights.at(-1)?.fight.date ?? "?"} to ${a.fights[0]?.fight.date ?? "?"}`],
            [b.name, `${b.fights.length} bouts · ${b.fights.at(-1)?.fight.date ?? "?"} to ${b.fights[0]?.fight.date ?? "?"}`],
            ["To merge", "add the pair to ALIASES or NICKNAMES in server/src/officials.ts"],
          ],
          links: [
            { label: a.name, href: `/${role === "judge" ? "judges" : "referees"}/${a.slug}`, internal: true },
            { label: b.name, href: `/${role === "judge" ? "judges" : "referees"}/${b.slug}`, internal: true },
          ],
          actions: [],
        });
      }
    }
  }
  return check({
    id: "official-possible-duplicate",
    group: "Venues & officials",
    label: "Officials who may be one person",
    description: "Two profiles share a surname and a first initial but were kept apart because their first names are not known variants of each other. If they are the same official, merge them so their records combine.",
    grade: "ok",
  }, items);
}

/** Spellings the matcher did merge, so an administrator can confirm them. */
function mergedOfficialSpellings(): BugCheck {
  const index = officialsIndex();
  const items: BugItem[] = [];
  for (const [role, table] of [["judge", index.judges], ["referee", index.referees]] as const) {
    for (const identity of table.values()) {
      const spellings = new Map<string, number>();
      for (const officiated of identity.fights) {
        const names = role === "referee" ? [officiated.referee] : officiated.cards.filter((card) => card.key === identity.key).map((card) => card.judge);
        for (const name of names) if (name) spellings.set(name, (spellings.get(name) ?? 0) + 1);
      }
      // Spellings merged by hand in officials.ts were already reviewed.
      if ([...spellings.keys()].filter((name) => !mergedByHand(name)).length < 2) continue;
      items.push({
        key: `${role}:${identity.slug}`,
        title: identity.name,
        subtitle: `${role === "judge" ? "Judge" : "Referee"} · ${identity.fights.length} bouts`,
        facts: [...spellings].sort((a, b) => b[1] - a[1]).map(([name, n]) => [name, `${n} ${n === 1 ? "bout" : "bouts"}`] as [string, string]),
        links: [{ label: "Profile", href: `/${role === "judge" ? "judges" : "referees"}/${identity.slug}`, internal: true }],
        actions: [],
      });
    }
  }
  return check({
    id: "official-merged-spellings",
    group: "Venues & officials",
    label: "Official names merged from several spellings",
    description: "These spellings were treated as one person (a short first name, a joined surname particle, a title). Review that each group really is one official; a wrong merge mixes two records.",
    grade: "ok",
  }, items);
}
function rosterHistoryGaps(): BugCheck {
  const items: BugItem[] = [];
  for (const event of storedRosterHistory()) {
    const fighterId = rosterMoveFighter(event.name);
    const missing = [!validRosterDate(event.date) && "valid date", !/^https:\/\//.test(event.source_url) && "source",
      !fighterId && "unambiguous profile"].filter(Boolean);
    if (!missing.length) continue;
    items.push({ key: `${event.name}:${event.date}:${event.kind}`, title: event.name,
      subtitle: `Roster timeline · missing ${missing.join(", ")}`,
      facts: [["Date", event.date], ["Change", event.kind], ["Reason", event.reason ?? "Not reported"]],
      links: [...(fighterId ? [fighterLink(fighterId, event.name)] : []),
        ...(/^https:\/\//.test(event.source_url) ? [{ label: "Report", href: event.source_url }] : [])],
      actions: [{ id: "roster-moves", label: "Re-read roster reports", target: "roster" }],
    });
  }
  const index = fightIndex();
  const reports = rosterEventsByFighter();
  const missingLabel = { signing_date: "exact signing date", departure_date: "departure date", departure_reason: "departure reason" };
  for (const fighter of index.fighters.values()) {
    const bouts = professionalBouts(index, fighter.id).reverse();
    const rows = bouts.map(bout => ({
      date: bout.date, event_name: bout.eventName, promotion: bout.isUfc ? "ufc" as const : "outside" as const,
      fight_id: bout.ufcFightId, title_type: bout.ufcFightId ? index.byId.get(bout.ufcFightId)?.titleType ?? null : null,
      upcoming: false, outcome: bout.outcome,
    }));
    const bands = careerBands(rows, reports.get(fighter.id));
    for (const [slot, entries] of bands.entries()) {
      for (const band of entries) {
        if (!band.unknown?.length) continue;
        const older = bouts[slot], newer = bouts[slot - 1];
        const facts: BugItem["facts"] = [["Band", band.label], ["Missing", band.unknown.map(field => missingLabel[field]).join(", ")]];
        if (band.date) facts.push([band.observed ? "First observed" : "Reported change", band.date]);
        if (older) facts.push(["Previous fight", `${older.date} · ${older.opponentName} · ${older.eventName}`]);
        if (newer) facts.push(["Next fight", `${newer.date} · ${newer.opponentName} · ${newer.eventName}`]);
        const links: BugLink[] = [fighterLink(fighter.id, fighter.name)];
        if (band.source_url) links.push({ label: "Roster report", href: band.source_url });
        const proof = band.signing ? newer : older;
        if (proof?.ufcFightId) links.push(...fightLinks(proof.ufcFightId));
        const source = db.prepare("SELECT source_url FROM career_profiles WHERE fighter_id = ? AND status = 'verified'").get(fighter.id) as { source_url: string | null } | undefined;
        if (source?.source_url) links.push({ label: "Professional history", href: source.source_url });
        items.push({ key: `gap:${fighter.id}:${band.signing ? "signed" : "left"}:${band.date ?? newer?.date ?? older?.date ?? "undated"}`,
          title: fighter.name, subtitle: `${band.label} · unknown ${band.unknown.map(field => missingLabel[field]).join(", ")}`,
          facts, links, actions: [],
        });
      }
    }
  }
  return check({ id: "roster-history", group: "Fighters", label: "UFC roster timeline evidence",
    description: "Manual research backlog for unknown signing/return dates, unconfirmed departure dates/reasons, observed-only roster changes, and incomplete source reports. Every item links to the profile and available bout/source evidence. Recruitment appearances alone never establish a signing. Add a verified dated report and source in server/src/roster-history.ts or retained roster_history metadata; the corresponding gap disappears on refresh. Re-read current roster reports to repair source fields. All timeline gaps remain searchable; the list loads in pages.",
    grade: "minor" }, items, Infinity);
}

function rosterMovesUnread(): BugCheck {
  const wiki: BugLink = { label: "Wikipedia", href: `https://en.wikipedia.org/wiki/${encodeURIComponent(ROSTER_ARTICLE.replaceAll(" ", "_"))}` };
  const reread = { id: "roster-moves" as const, label: "Re-read Wikipedia", target: "roster" };
  const synced = Number(getMeta("roster_moves_synced_at")) || null;
  const items: BugItem[] = [];
  if (!synced || Date.now() - synced > 24 * 3_600_000) items.push({
    key: "sync",
    title: synced ? "Not read in over a day" : "Never read",
    facts: [["Last read", ago(synced)], ["Last tried", ago(Number(getMeta("roster_moves_checked_at")) || null)]],
    links: [wiki],
    actions: [reread],
  });
  const { signed, cut } = storedRosterMoves();
  for (const [list, moves] of [["Signed", signed], ["Cut", cut]] as const) {
    for (const move of moves) {
      // Anyone cut has fought for the UFC, so a release without a profile
      // is almost always a name spelled differently from UFCStats.
      const missing = [!move.date && "date", !move.division && "division", !move.record && "record", !move.country && "country",
        list === "Cut" && !rosterMoveFighter(move.name) && "profile", list === "Cut" && !move.reason && "reason"].filter(Boolean);
      if (missing.length) items.push({
        key: `${list}:${move.name}`,
        title: move.name,
        subtitle: `${list} · missing ${missing.join(", ")}`,
        facts: [["Date", move.date ?? "unread"], ["Division", move.division ?? "unread"], ["Record", move.record ?? "unread"]],
        links: [wiki, { label: "UFCStats search", href: `${UFCSTATS}/statistics/fighters/search?query=${encodeURIComponent(move.name.split(" ").at(-1) ?? move.name)}` }],
        actions: [reread],
      });
    }
  }
  // ufc.com's newest profiles are read every 5 minutes: an hour without a
  // read means its search page changed or turned us away, and signings are
  // only reported once Wikipedia has them.
  const signingsRead = Number(getMeta("ufc_signings_synced_at")) || null;
  if (!signingsRead || Date.now() - signingsRead > 3_600_000) items.push({
    key: "ufc-signings",
    title: signingsRead ? "ufc.com's newest athletes not read in over an hour" : "ufc.com's newest athletes never read",
    facts: [["Last read", ago(signingsRead)], ["Last tried", ago(Number(getMeta("ufc_signings_checked_at")) || null)]],
    links: [{ label: "ufc.com newest athletes", href: "https://www.ufc.com/search?type=athletes&query=" }],
    actions: [{ id: "roster-moves", label: "Read again", target: "ufc" }],
  });
  // ufc.com: a markup change would leave every status unread, and a fighter
  // whose page can't be found is never watched for leaving.
  const statuses = db.prepare("SELECT COUNT(*) AS checked, COUNT(status) AS read FROM ufc_status WHERE checked_at > ?").get(Date.now() - 24 * 3_600_000) as { checked: number; read: number };
  if (statuses.checked >= 20 && statuses.read < statuses.checked / 2) items.push({
    key: "ufc-status",
    title: "ufc.com statuses mostly unreadable",
    facts: [["Read in the last day", `${statuses.read} of ${statuses.checked}`]],
    links: [{ label: "ufc.com athletes", href: "https://www.ufc.com/athletes/all" }],
    actions: [],
  });
  const unfound = db.prepare(`SELECT s.fighter_id, fr.name, s.checked_at FROM ufc_status s JOIN fighters fr ON fr.id = s.fighter_id
    WHERE s.status IS NULL ORDER BY fr.name`).all() as { fighter_id: string; name: string; checked_at: number }[];
  for (const fighter of unfound) items.push({
    key: `ufc:${fighter.fighter_id}`,
    title: fighter.name,
    subtitle: "No ufc.com page found, so a departure can't be seen",
    facts: [["Last tried", ago(fighter.checked_at)]],
    links: [fighterLink(fighter.fighter_id, fighter.name), { label: "ufc.com search", href: `https://www.ufc.com/search?query=${encodeURIComponent(fighter.name)}` }],
    actions: [{ id: "ufc-status", label: "Look again", target: fighter.fighter_id }],
  });
  return check({
    id: "roster-moves",
    group: "Fighters",
    label: "Signings and releases not read",
    description: "The /roster page lists Wikipedia's recent signings and releases (checked every 10 minutes), ufc.com's newest athlete profiles (every 5 minutes: a signing shows before anyone writes it up), plus fighters whose ufc.com page turned from Active to Not Fighting (each recent fighter read twice a day). A stale read means the article couldn't be reached or its tables changed shape (the last good read stays up). A row missing a field was written in a form the reader doesn't understand; a release with no profile is usually a name spelled differently from UFCStats.",
    grade: (item) => item.key === "sync" || item.key === "ufc-status" || item.key === "ufc-signings" ? "must" : item.key.startsWith("ufc:") ? "ok" : "minor",
  }, items);
}
function potentialMatchupGaps(): BugCheck {
  const items: BugItem[] = [];
  for (const [source, label, url] of [["fightodds", "FightOdds.io", "https://fightodds.io"],
    ["bestfightodds", "BestFightOdds", "https://www.bestfightodds.com/events/future-events-197"]]) {
    const readAt = Number(getMeta(`potential_${source}_read_at`)) || null;
    if (!readAt || Date.now() - readAt > 30 * 60_000) items.push({
      key: `board:${source}`, title: `${label} potential matchups are stale`,
      subtitle: getMeta(`potential_${source}_error`) || undefined,
      facts: [["Last read", ago(readAt)]], links: [{ label: "Future fights", href: url }],
      actions: [{ id: "potential-odds", label: "Re-read boards", target: "all" }],
    });
  }
  for (const row of potentialMatchups()) {
    const missing = [row.f1_id, row.f2_id].some(id => !id || !db.prepare("SELECT 1 FROM fighters WHERE id = ?").get(id));
    if (!missing) continue;
    items.push({ key: row.id, title: `${row.f1_name} vs ${row.f2_name}`, facts: [["Problem", "Fighter identity missing from archive"]],
      links: [{ label: "Odds source", href: JSON.parse(row.odds_json).source_url }],
      actions: [{ id: "potential-odds", label: "Re-read board", target: "all" }],
    });
  }
  return check({ id: "odds-potential-matchups", group: "Odds", label: "Potential matchup coverage",
    description: "The BestFightOdds and FightOdds.io future boards supply unconfirmed matchup prices at startup and every five minutes. Stale reads preserve the last snapshot. Missing fighter identities leave career comparisons incomplete; re-reading retries identity matching.",
    grade: item => item.key.startsWith("board:") ? "must" : "minor",
  }, items);
}

/** FightOdds.io prices upcoming bouts every five minutes. Unread for half an
 *  hour, lines fall back to BestFightOdds' slower pass: the app's API moved,
 *  rebuilt the queries it accepts, or started asking for its bot check. */
function fightOddsUnread(): BugCheck {
  const readAt = Number(getMeta("fightodds_read_at")) || null;
  const items: BugItem[] = readAt && Date.now() - readAt < 30 * 60_000 ? [] : [{
    key: "fightodds",
    title: "FightOdds.io",
    subtitle: getMeta("fightodds_error") || "Never read",
    facts: [["Last read", ago(readAt)], ["Last tried", ago(Number(getMeta("fightodds_tried_at")) || null)]],
    links: [{ label: "FightOdds.io", href: "https://fightodds.io" }],
    actions: [],
  }];
  return check({
    id: "odds-fightodds-unread",
    group: "Odds",
    label: "FightOdds.io not read",
    description: "Upcoming moneylines come from FightOdds.io's event boards every five minutes, matched by UFCStats id; BestFightOdds fills anything they miss every few hours. While FightOdds.io is unread, lines only move at BestFightOdds' pace. Check the error. \"Unknown query\" (HTTP 403) means FightOdds.io rebuilt its app: it only answers its app's own query texts, so copy the new ones into server/src/scrape/fightodds-queries.ts. Otherwise: a changed field, or the API now requiring its Cloudflare Turnstile token.",
    grade: "must",
  }, items);
}

function newsFeedsUnread(): BugCheck {
  const items: BugItem[] = [];
  for (const feed of NEWS_FEEDS) {
    const status = feedStatus(feed.source);
    if (status?.ok_at && Date.now() - status.ok_at < 2 * 3_600_000) continue;
    items.push({
      key: feed.source,
      title: feed.source,
      subtitle: status?.error ?? "Never read",
      facts: [["Last read", ago(status?.ok_at ?? null)], ["Last tried", ago(status?.tried_at ?? null)]],
      links: [{ label: "Feed", href: feed.url }],
      actions: [{ id: "news", label: "Read again", target: "all" }],
    });
  }
  return check({
    id: "news-feeds",
    group: "Fights & events",
    label: "News outlets not read",
    description: "The /news page reads each outlet's feed every ten minutes (ESPN, MMA Junkie, UFC.com, Yahoo, CBS, talkSPORT and MMA News through Google News, which they allow; the rest directly). An outlet unread for two hours drops out of the page until it is read again: its feed moved, changed shape or turned us away.",
    grade: "minor",
  }, items);
}

export function bugReport(): { generated_at: number; sync: { last_tick_at: string | null; last_sync_error: string | null }; checks: BugCheck[] } {
  const active = activeFighterIds();
  // Most important first within each group: wrong data on screen, then data
  // that will cause wrong data, then gaps on upcoming cards, then history.
  const checks = [
    decisionsWithoutJudgeRounds(),
    fightsWithoutCommunityScores(),
    invalidCommunityScores(),
    verdictImportErrors(),
    suspiciousOdds(),
    wrongFighterPages(),
    fightOddsUnread(),
    potentialMatchupGaps(),
    upcomingMoneyline(),
    pastMoneyline(),
    upcomingProps(),
    pastProps(),
    oddsMissingByRound(),
    unverifiedRecords(active),
    rankedRecordGaps(),
    rankedHistoryGaps(),
    rankingHistoryGaps(),
    titleRankingEvidenceGaps(),
    fightsMissingFromHistory(),
    unlinkedUfcBouts(),
    unexplainedNoContests(),
    recordMismatch(active),
    staleEvents(),
    untrustworthyFightStats(),
    careerStatGaps(),
    upcomingWithoutSegment(),
    decisionsWithoutJudges(),
    eventsWithoutWiki(),
    weightMissesUnderLimit(),
    catchweightsWithoutLimit(),
    replacementsUnnamed(),
    replacementsWithoutNotice(),
    replacedWithoutProfile(),
    venueInWrongCity(),
    eventsWithoutVenue(),
    venuesFromWikipediaOnly(),
    upcomingWithoutBroadcast(),
    upcomingWithoutReferee(),
    upcomingWithoutReporting(),
    fightsWithoutReferee(),
    unnamedJudges(),
    possibleDuplicateOfficials(),
    mergedOfficialSpellings(),
    fighterGaps(active),
    duplicateFighters(),
    sharedCareerProfiles(),
    searchAliasMisses(),
    rosterMovesUnread(),
    rosterHistoryGaps(),
    newsFeedsUnread(),
    newsUnjudged(),
  ];
  return {
    generated_at: Date.now(),
    sync: { last_tick_at: getMeta("last_tick_at"), last_sync_error: getMeta("last_sync_error") },
    checks,
  };
}

/** /news: Gemini reads each new story within ten minutes. Stories unread for
 *  two hours mean it's failing: out of credit, a changed API, a bad answer. */
function newsUnjudged(): BugCheck {
  const items: BugItem[] = [];
  const unread = process.env.GEMINI_API_KEY && !newsAiOff() ? newsToJudge().pending.filter((story) => Date.now() - story.published_at > 2 * 3_600_000) : [];
  if (unread.length) {
    items.push({
      key: "gemini",
      title: `${unread.length} ${unread.length === 1 ? "story" : "stories"} not read by Gemini`,
      subtitle: getMeta("news_ai_error") || "Waiting for the next pass",
      facts: [["Last read", ago(Number(getMeta("news_ai_at")) || null)], ["Tokens used", Number(getMeta("news_ai_tokens") ?? 0).toLocaleString("en-US")]],
      links: [{ label: "AI Studio", href: "https://aistudio.google.com/usage" }],
      actions: [{ id: "news-ai", label: "Read now", target: "all" }],
    });
  }
  return check({
    id: "news-ai",
    group: "Fights & events",
    label: "News not read by Gemini",
    description: "Every ten minutes Gemini reads the new /news stories: it drops what isn't news (ads, betting codes, galleries, streams), folds a story into another outlet's report of the same news, and summarizes the article (not for ESPN, MMA Junkie and the other outlets read through Google News, whose links can't be followed from the server unless another outlet ran it too). An unread story shows as the feeds built it.",
    grade: "minor",
  }, items);
}

export type BugActionId = "potential-odds" | "odds" | "props" | "career" | "detail" | "segments" | "event" | "clear-bfo" | "birth" | "wiki" | "article" | "catchweight" | "forget-ufc" | "verdict" | "roster-moves" | "ufc-status" | "news" | "news-ai" | "ranking-history" | "rankings" | "judge-names";

/** Runs one repair and says in a sentence what it found. */
export async function runBugAction(action: string, target: string): Promise<{ ok: boolean; message: string }> {
  const fight = () => db.prepare(`
    SELECT f.id, f.event_id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, e.date
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
  `).get(target) as { id: string; event_id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string; date: string } | undefined;

  switch (action) {
    case "judge-names": return repairJudgeNames(target);
    case "potential-odds": {
      const result = await syncPotentialMatchups({ props: true });
      return { ok: result.failed < 2, message: `${potentialMatchups().length} potential matchups with odds.${result.failed ? ` ${result.failed} source(s) could not be read; stored prices were kept.` : ""}` };
    }
    case "odds": {
      const row = fight();
      if (!row) return { ok: false, message: "Fight not found." };
      let stored = false;
      try {
        // FightOdds.io's boards first: they hold the freshest upcoming lines.
        if (row.date >= new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) await syncFightOdds().catch(() => null);
        const fresh = db.prepare("SELECT 1 FROM odds WHERE fight_id = ? AND f1_close IS NOT NULL AND fetched_at > ?").get(row.id, Date.now() - 60_000);
        stored = Boolean(fresh) || await syncOddsForFight(row);
        // A completed bout BestFightOdds never priced: FightOdds.io's board for the date.
        if (!stored && row.date < new Date().toISOString().slice(0, 10)) stored = await syncPastFightOdds(row.event_id) > 0;
      } catch (err) {
        return { ok: false, message: `Couldn't reach the odds source (${String(err)}). Nothing was changed.` };
      }
      const props = await syncMethodOddsForEvent(row.event_id, row.id);
      const odds = db.prepare("SELECT f1_close, f2_close FROM odds WHERE fight_id = ?").get(row.id) as { f1_close: string | null; f2_close: string | null } | undefined;
      // The event board can fill a line the fighter pages never had.
      return {
        ok: stored || Boolean(odds?.f1_close),
        message: odds?.f1_close
          ? `Stored ${row.f1_name} ${odds.f1_close} / ${row.f2_name} ${odds.f2_close}${props.fights ? ", plus props" : ""}.`
          : `No line found for this pairing on the source${props.fights ? ", but props were stored" : ""}.`,
      };
    }
    case "props": {
      const row = fight();
      if (!row) return { ok: false, message: "Fight not found." };
      if (row.date >= new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) {
        await syncFightOdds({ props: true }).catch(() => null);
        if (db.prepare("SELECT 1 FROM method_odds WHERE fight_id = ? AND fetched_at > ?").get(row.id, Date.now() - 60_000)) {
          return { ok: true, message: "Props stored from FightOdds.io." };
        }
      }
      const result = await syncMethodOddsForEvent(row.event_id, row.id);
      return { ok: result.fights > 0, message: result.fights ? "Props stored." : result.failed ? "The board couldn't be read." : "The board has no props for this bout." };
    }
    case "career": {
      const verified = await syncCareerRecord(target);
      const row = db.prepare("SELECT status, error FROM career_profiles WHERE fighter_id = ?").get(target) as { status: string; error: string } | undefined;
      return { ok: verified, message: verified ? "History verified and re-stored." : `Still ${row?.status ?? "unverified"}${row?.error ? `: ${row.error}` : ""}.` };
    }
    case "verdict": {
      const ids = target.startsWith("card:") ? [Number(target.slice(5))]
        : (db.prepare("SELECT verdict_id FROM verdict_events WHERE event_id = (SELECT event_id FROM fights WHERE id = ?)").all(target) as { verdict_id: number }[]).map(row => row.verdict_id);
      if (!ids.length) return { ok: false, message: "No Verdict card is matched to this event." };
      for (const id of ids) await importVerdictEvent(id, "recent");
      const error = target.startsWith("card:")
        ? (db.prepare("SELECT error FROM verdict_events WHERE verdict_id = ?").get(ids[0]) as { error: string | null } | undefined)?.error
        : (db.prepare("SELECT verdict_error AS error FROM fights WHERE id = ?").get(target) as { error: string | null } | undefined)?.error;
      return { ok: !error, message: error ? `Still failing: ${error}` : "Read again without errors." };
    }
    case "detail":
      await syncFightDetail(target);
      return { ok: true, message: "Fight detail re-fetched." };
    case "segments": {
      await syncEventSegments(target);
      const row = db.prepare("SELECT ufc_slug FROM events WHERE id = ?").get(target) as { ufc_slug: string | null } | undefined;
      return { ok: true, message: row?.ufc_slug ? "ufc.com card re-read." : "That page was another event's; forgotten. The archive offers this card its own page on its next pass." };
    }
    case "forget-ufc":
      forgetUfcPage(target);
      return { ok: true, message: "Forgotten, with everything read from it. The archive offers this card its own page on its next pass." };
    case "event":
      await syncEventDetail(target);
      return { ok: true, message: "Event re-fetched." };
    case "ufc-status":
      db.prepare("UPDATE ufc_status SET url = NULL, checked_at = 0 WHERE fighter_id = ?").run(target);
      return { ok: true, message: "Queued; ufc.com is searched again on the next pass." };
    case "news":
      await syncNews();
      return { ok: true, message: "Read every outlet again." };
    case "news-ai":
      if (!process.env.GEMINI_API_KEY) return { ok: false, message: "GEMINI_API_KEY isn't set." };
      if (newsAiOff()) return { ok: false, message: "Gemini is switched off on the Health tab." };
      // Flex can take minutes: the pass runs on, its outcome on this board.
      void judgeNews();
      return { ok: true, message: "Gemini is reading; reload the board in a few minutes." };
    case "roster-moves": {
      try {
        if (target === "ufc") {
          await syncUfcSignings();
          return { ok: true, message: "Read ufc.com's newest athletes." };
        }
        await syncRosterMoves();
      } catch (err) {
        return { ok: false, message: `Couldn't read it (${String(err)}). The last good list stays up.` };
      }
      const { signed, cut } = storedRosterMoves();
      return { ok: true, message: `Read ${signed.length} signings and ${cut.length} releases.` };
    }
    case "rankings": {
      await syncRankings();
      const linked = relinkRankingHistory();
      return { ok: true, message: `Re-read current rankings and linked ${linked} ranked rows.` };
    }
    case "ranking-history": {
      const linked = relinkRankingHistory();
      // The sync worker owns the backfill; clearing its clock retries it next pass.
      setMeta("ranking_history_tried_at", "0");
      return { ok: true, message: `Linked ${linked} ranked rows. Wayback is re-read on the next sync pass if anything is missing.` };
    }
    case "birth":
      await syncFighterBirthDate(target);
      return { ok: true, message: "Birth date re-fetched." };
    case "clear-bfo":
      db.prepare("UPDATE fighters SET bfo_url = NULL, bfo_checked_at = NULL WHERE id = ?").run(target);
      return { ok: true, message: "Forgotten. The next odds backfill looks the page up again." };
    case "article":
      db.prepare("UPDATE events SET wiki_info_checked_at = NULL WHERE id = ?").run(target);
      return { ok: true, message: "Queued: the event article is re-read on the next background pass." };
    case "wiki":
      db.prepare("UPDATE events SET wiki_checked_at = NULL WHERE id = ?").run(target);
      return { ok: true, message: "Queued for the next weigh-in pass." };
    case "catchweight": {
      const result = await syncCatchWeights(1, [target]);
      const row = db.prepare("SELECT catch_weight FROM fights WHERE id = ?").get(target) as { catch_weight: number | null } | undefined;
      if (result.failed) return { ok: false, message: "Wikipedia couldn't be reached. Nothing was changed." };
      return { ok: row?.catch_weight != null, message: row?.catch_weight != null ? `Stored ${row.catch_weight} lb.` : "Neither the event article nor either fighter's record table gives a weight." };
    }
    default:
      return { ok: false, message: `Unknown action ${action}.` };
  }
}

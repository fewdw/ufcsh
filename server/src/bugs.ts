import { db, getMeta } from "./db.ts";
import { validateFightActions } from "./action-stats.ts";
import { americanLine, fightIndex, impliedProbability } from "./fight-index.ts";
import { pageNamesFighter } from "./scrape/odds.ts";
import { syncCareerRecord } from "./career-records.ts";
import { hasCompleteJudgeRounds } from "./judge-scorecards.ts";
import { officialsIndex } from "./officials.ts";
import { venueIndex } from "./venues.ts";
import {
  fighterNames,
  syncEventDetail,
  syncEventSegments,
  syncFightDetail,
  syncFighterBirthDate,
  syncMethodOddsForEvent,
  syncOddsForFight,
  syncCatchWeights,
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
};
export type BugCheck = {
  id: string;
  group: "Scorecards" | "Odds" | "Records" | "Fights & events" | "Venues & officials" | "Fighters";
  label: string;
  description: string;
  severity: "high" | "medium" | "low";
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

function check(meta: Omit<BugCheck, "total" | "items">, items: BugItem[]): BugCheck {
  return { ...meta, total: items.length, items: items.slice(0, ITEM_LIMIT) };
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
    SELECT ${FIGHT_COLUMNS}, e.bfo_url, MAX(COALESCE(o.fetched_at, 0), COALESCE(o.checked_at, 0)) AS fetched_at, o.source_url
    FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 0 AND o.f1_close IS NULL
    ORDER BY e.date ASC, f.ord ASC
  `).all() as (FightRow & { bfo_url: string | null; fetched_at: number | null; source_url: string | null })[];
  return check({
    id: "odds-upcoming-moneyline",
    group: "Odds",
    label: "Upcoming bouts without a moneyline",
    description: "Announced bouts with no price stored. Usually the source hasn't posted a line yet. If the event board or a fighter page already lists the bout, the names don't match. Check the aliases, then add a fix to the name matching.",
    severity: "high",
  }, rows.map((fight) => fightItem(fight, {
    facts: [["Last checked", ago(fight.fetched_at)], ...aliasFact(fight)],
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
    severity: "medium",
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
    description: "Completed UFC bouts since 2008 with no price, which leaves them out of Market stats and the Labs odds filters. Late replacements often never got a line. The rest are usually a name mismatch on the fighter's BFO page.",
    severity: "medium",
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
    severity: "low",
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
    severity: "low",
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
      actions: [],
    }));
  }
  return check({
    id: "odds-suspicious",
    group: "Odds",
    label: "Prices that don't add up",
    description: "Stored lines that contradict themselves: implied probabilities far outside a normal 100–110% book, one corner priced without the other, an unreadable price, or a huge open-to-close swing. Known cause: BestFightOdds shows each side's closing range across sportsbooks, and we store the top of it (the best price). When the books disagree, the two best prices add up to under 100%. Every case checked on 2026-09-13 matched the source exactly, and the midpoints of the ranges added up to 102–107%, so these are not scraping errors.",
    severity: "high",
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
    severity: "high",
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
    severity: "medium",
  }, items.map(({ weight: _weight, ...item }) => item));
}

function unverifiedRecords(active: Set<string>): BugCheck {
  const rows = db.prepare(`
    SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, cp.status, cp.error, cp.source_url, cp.checked_at
    FROM fighters fr LEFT JOIN career_profiles cp ON cp.fighter_id = fr.id
    WHERE (cp.status IS NULL OR cp.status != 'verified')
      AND EXISTS (SELECT 1 FROM fights f WHERE f.f1_id = fr.id OR f.f2_id = fr.id)
  `).all() as { id: string; name: string; nickname: string; wins: number; losses: number; draws: number; status: string | null; error: string | null; source_url: string | null; checked_at: number | null }[];
  const statusOrder: Record<string, number> = { error: 0, ambiguous: 1, not_found: 2, pending: 3 };
  const items = rows
    .filter((row) => active.has(row.id))
    .sort((a, b) => (statusOrder[a.status ?? "pending"] ?? 4) - (statusOrder[b.status ?? "pending"] ?? 4) || a.name.localeCompare(b.name))
    .map((row): BugItem => ({
      key: row.id,
      title: row.name,
      subtitle: row.nickname ? `"${row.nickname}"` : undefined,
      facts: [
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
    severity: "high",
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
    severity: "medium",
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
    severity: "medium",
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
  const rows = db.prepare(`
    SELECT fr.id, fr.name, fr.norm_name, fr.wins, fr.losses, fr.draws, fr.weight,
           (SELECT MAX(e.date) FROM fights f JOIN events e ON e.id = f.event_id WHERE f.f1_id = fr.id OR f.f2_id = fr.id) AS last_fight
    FROM fighters fr
    WHERE fr.norm_name IN (SELECT norm_name FROM fighters GROUP BY norm_name HAVING COUNT(*) > 1)
    ORDER BY fr.norm_name, last_fight DESC
  `).all() as { id: string; name: string; norm_name: string; wins: number; losses: number; draws: number; weight: string; last_fight: string | null }[];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.norm_name, [...(groups.get(row.norm_name) ?? []), row]);
  return check({
    id: "duplicate-fighter-names",
    group: "Fighters",
    label: "Different fighters with the same name",
    description: "UFCStats has more than one fighter under this name. Usually they really are different people, but name-only matching (odds, rankings, search) can pick the wrong one. Check that each record and weight looks like a separate person.",
    severity: "low",
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
    severity: "low",
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
    severity: "medium",
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
    severity: "low",
  }, rows.map(fight => fightItem(fight, {
    facts: [["Method", fight.method ?? "unknown"], ["Rounds reached", fight.round ?? "unknown"], ["Verdict checked", ago(fight.verdict_checked_at)]],
    links: [{ label: "Verdict events", href: "https://verdictmma.com/events" }],
  })));
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
    severity: "high",
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
    severity: "medium",
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
    ORDER BY e.date DESC
  `).all() as { id: string; name: string; date: string; detail_fetched_at: number | null; bouts: number; open: number }[];
  return check({
    id: "event-stale",
    group: "Fights & events",
    label: "Events with missing results or no bouts",
    description: "Either a past event still isn't marked complete, a completed event has bouts without a result, or an event has no bouts at all.",
    severity: "high",
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
    severity: "low",
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
    severity: "low",
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
    description: "Fighters with a bout since the start of last year, or one booked, who are missing a photo, birth date (which drives age and Labs age filters), country, height, reach or stance.",
    severity: "medium",
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
      AND (ufc_slug IS NOT NULL OR wiki_title IS NOT NULL OR wiki_checked_at IS NOT NULL)
    ORDER BY date DESC
  `).all() as EventVenueRow[];
  return check({
    id: "event-no-venue",
    group: "Venues & officials",
    label: "Events with no venue",
    description: "Neither the promotion's live-card feed nor the event's Wikipedia article named a venue, so the event has no venue page and matchups show only the city. Pre-2011 cards have no ufc.com page; their venue can only come from Wikipedia.",
    severity: "medium",
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

function venuesFromWikipediaOnly(): BugCheck {
  const rows = db.prepare(`
    SELECT ${VENUE_COLUMNS} FROM events WHERE venue_id IS NULL AND wiki_venue IS NOT NULL ORDER BY date DESC
  `).all() as EventVenueRow[];
  const index = venueIndex();
  return check({
    id: "venue-wikipedia-only",
    group: "Venues & officials",
    label: "Venues known only from Wikipedia",
    description: "The venue name comes from the event article alone. When no other card links that name to the promotion's venue id, a renamed arena (Staples Center / Crypto.com Arena) can show as two venues. Re-reading the ufc.com card usually attaches the id; otherwise the name may need an alias.",
    severity: "low",
  }, rows.map((event): BugItem => {
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
    severity: "low",
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
    severity: "low",
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
    severity: "low",
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
    severity: "low",
  }, rows.map((fight) => fightItem(fight, {
    actions: fight.ufc_slug ? [{ id: "segments", label: "Re-read ufc.com card", target: fight.event_id }] : [],
  })));
}

function unnamedJudges(): BugCheck {
  const rows = db.prepare(`
    SELECT ${FIGHT_COLUMNS} FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.detail_json LIKE '%"judges"%'
      AND EXISTS (SELECT 1 FROM json_each(json_extract(f.detail_json, '$.judges')) j
        WHERE COALESCE(TRIM(json_extract(j.value, '$.judge')), '') = '')
    ORDER BY e.date DESC
  `).all() as FightRow[];
  return check({
    id: "judge-unnamed",
    group: "Venues & officials",
    label: "Scorecards with an unnamed judge",
    description: "The official card gives a score but no judge's name, so it counts toward the panel but toward no judge's profile. Common on early cards; MMA Decisions sometimes names them.",
    severity: "low",
  }, rows.map((fight) => fightItem(fight, {
    links: [{ label: "MMA Decisions search", href: `http://mmadecisions.com/search.jsp?s=${encodeURIComponent(fight.f1_name.split(" ").at(-1) ?? "")}` }],
    actions: [{ id: "detail", label: "Re-fetch fight detail", target: fight.id }],
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
    severity: "low",
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
      if (spellings.size < 2) continue;
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
    severity: "low",
  }, items);
}
// ---------------------------------------------------------------------------

export function bugReport(): { generated_at: number; sync: { last_tick_at: string | null; last_sync_error: string | null }; checks: BugCheck[] } {
  const active = activeFighterIds();
  // Most important first within each group: wrong data on screen, then data
  // that will cause wrong data, then gaps on upcoming cards, then history.
  const checks = [
    decisionsWithoutJudgeRounds(),
    fightsWithoutCommunityScores(),
    suspiciousOdds(),
    wrongFighterPages(),
    upcomingMoneyline(),
    pastMoneyline(),
    upcomingProps(),
    pastProps(),
    oddsMissingByRound(),
    unverifiedRecords(active),
    fightsMissingFromHistory(),
    unlinkedUfcBouts(),
    recordMismatch(active),
    staleEvents(),
    untrustworthyFightStats(),
    upcomingWithoutSegment(),
    decisionsWithoutJudges(),
    eventsWithoutWiki(),
    catchweightsWithoutLimit(),
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
  ];
  return {
    generated_at: Date.now(),
    sync: { last_tick_at: getMeta("last_tick_at"), last_sync_error: getMeta("last_sync_error") },
    checks,
  };
}

export type BugActionId = "odds" | "props" | "career" | "detail" | "segments" | "event" | "clear-bfo" | "birth" | "wiki" | "article" | "catchweight";

/** Runs one repair and says in a sentence what it found. */
export async function runBugAction(action: string, target: string): Promise<{ ok: boolean; message: string }> {
  const fight = () => db.prepare(`
    SELECT f.id, f.event_id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, e.date
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
  `).get(target) as { id: string; event_id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string; date: string } | undefined;

  switch (action) {
    case "odds": {
      const row = fight();
      if (!row) return { ok: false, message: "Fight not found." };
      let stored: boolean;
      try {
        stored = await syncOddsForFight(row);
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
      const result = await syncMethodOddsForEvent(row.event_id, row.id);
      return { ok: result.fights > 0, message: result.fights ? "Props stored." : result.failed ? "The board couldn't be read." : "The board has no props for this bout." };
    }
    case "career": {
      const verified = await syncCareerRecord(target);
      const row = db.prepare("SELECT status, error FROM career_profiles WHERE fighter_id = ?").get(target) as { status: string; error: string } | undefined;
      return { ok: verified, message: verified ? "History verified and re-stored." : `Still ${row?.status ?? "unverified"}${row?.error ? `: ${row.error}` : ""}.` };
    }
    case "detail":
      await syncFightDetail(target);
      return { ok: true, message: "Fight detail re-fetched." };
    case "segments":
      await syncEventSegments(target);
      return { ok: true, message: "ufc.com card re-read." };
    case "event":
      await syncEventDetail(target);
      return { ok: true, message: "Event re-fetched." };
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

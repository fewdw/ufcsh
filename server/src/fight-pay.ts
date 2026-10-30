import { createHash } from "node:crypto";
import { db, prepared, getMeta, setMeta } from "./db.ts";
import { fightIndex } from "./fight-index.ts";
import { SEARCH_ALIASES } from "./search-aliases.ts";
import { PURSE_REPORTS, type PurseReport } from "./purse-reports-data.ts";
import { eventSection, fetchArticleByTitle } from "./scrape/wikipedia.ts";
import {
  BONUS_LABELS, PAY_REPORT_DAYS, articleSection, mmaPayoutPosts, placeName, postCommission, postsForCard, readPurses,
  sectionCitation, usd, wikipediaBonuses, wikipediaPurses,
  type BonusKind, type Corner, type PayBout, type PayoutPost, type Purse, type SourceLink,
} from "./scrape/payouts.ts";
import { log } from "./util.ts";

/** What each fighter was paid for a bout, as far as anyone published it.
 *
 *  Reported: the purse a commission disclosed (show money and win bonus) and
 *  post-fight bonus amounts. Estimated, and labelled so: fight-week
 *  (Promotional Guidelines Compliance) pay from UFC's published tiers, only
 *  for the Venum era (April 2021 on), whose schedule is known. Nothing else
 *  is guessed: a purse no commission disclosed stays unknown, and Admin →
 *  Bugs lists every card with one. */

export type PaySource = SourceLink & { commission: string | null; caveat: string | null; cited: SourceLink | null; archive?: SourceLink };
type StoredPurse = Purse & { source: number; also: string | null };
type StoredBonus = { kind: BonusKind; amount: number | null; note: string | null };
export type StoredPay = {
  purse?: { sources: PaySource[]; f1?: StoredPurse; f2?: StoredPurse };
  bonuses?: { source: SourceLink & { cited: SourceLink | null }; f1: StoredBonus[]; f2: StoredBonus[] };
};
export type PayIssues = { unread: string[]; conflicts: string[]; bonusNotes: string[]; failed: string[] };

const WIKI = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
const FINISH = /^(?:KO\/TKO|SUB)$/;

type CardFight = PayBout & { method: string | null };

function cardOf(eventId: string): CardFight[] {
  const rows = prepared(`SELECT id, f1_name, f2_name, f1_outcome, f2_outcome, method FROM fights WHERE event_id = ?`)
    .all(eventId) as { id: string; f1_name: string; f2_name: string; f1_outcome: string | null; f2_outcome: string | null; method: string | null }[];
  return rows.map((row) => ({
    id: row.id, f1: row.f1_name, f2: row.f2_name, f1Outcome: row.f1_outcome, f2Outcome: row.f2_outcome, method: row.method,
    f1Aliases: SEARCH_ALIASES[row.f1_name], f2Aliases: SEARCH_ALIASES[row.f2_name],
  }));
}

/** One card's pay from its Wikipedia article and MMA Payout's posts, per
 *  bout, and what in them could not be read. Pure, so the archive tests can
 *  run every card. */
export function cardPay(
  card: CardFight[],
  article: { title: string; text: string } | null,
  posts: PayoutPost[] | null,
  date: string,
  reports: PurseReport[] = PURSE_REPORTS,
): { pay: Map<string, StoredPay>; issues: PayIssues } {
  const pay = new Map<string, StoredPay>(card.map((bout) => [bout.id, {}]));
  const issues: PayIssues = { unread: [], conflicts: [], bonusNotes: [], failed: [] };
  const sources: PaySource[] = [];
  // A later source fills a corner nobody has yet; where one has, it is kept
  // and the other figure recorded beside it.
  const addPurse = (bout: PayBout, corner: Corner, theirs: Purse, index: number) => {
    const entry = pay.get(bout.id)!;
    const ours = entry.purse?.[corner];
    if (!ours) entry.purse = { ...entry.purse, sources, [corner]: { ...theirs, source: index, also: null } };
    else if (ours.total !== theirs.total) {
      const label = sources[index].label;
      ours.also = [ours.also, `${label} lists ${usd(theirs.total)}`].filter(Boolean).join("; ");
      issues.conflicts.push(`${bout[corner]}: ${sources[ours.source].label} ${usd(ours.total)}, ${label} ${usd(theirs.total)}`);
    }
  };

  const wiki = article ? wikipediaPurses(article.text, card) : null;
  if (wiki && wiki.purses.size) {
    sources.push({ label: "Wikipedia", url: `${WIKI(article!.title)}#Reported_payout`, commission: wiki.commission, caveat: wiki.caveat, cited: wiki.citation });
    for (const [id, corners] of wiki.purses) {
      pay.get(id)!.purse = { sources, ...Object.fromEntries(Object.entries(corners).map(([corner, purse]) => [corner, { ...purse, source: 0, also: null }])) };
    }
  }
  if (wiki) issues.unread.push(...wiki.unread.map((row) => `Wikipedia payout: ${row}`));

  // Reviewed public reports fill historical gaps without depending on archive
  // availability. Match the date, stable bout id AND both fighter names.
  for (const report of reports) {
    if (report.date !== date || !report.rows.some((row) => card.some((bout) => bout.id === row.id))) continue;
    const rows = report.rows.filter((row) => card.some((bout) => bout.id === row.id && bout.f1 === row.fighters[0] && bout.f2 === row.fighters[1]));
    issues.unread.push(...report.rows.filter((row) => !rows.includes(row)).map((row) => `${report.source.label} row no longer matches: ${row.fighters.join(" vs. ")}`));
    if (!rows.length) continue;
    const index = sources.push({ ...report.source, commission: report.commission, caveat: null, cited: null }) - 1;
    issues.unread.push(...report.unread.map((row) => `${report.source.label} salaries: ${row}`));
    for (const row of rows) {
      const bout = card.find((b) => b.id === row.id)!;
      for (const [i, corner] of (["f1", "f2"] as const).entries()) {
        if (row.purses[i]) addPurse(bout, corner, row.purses[i], index);
      }
    }
  }

  for (const salaries of postsForCard(posts ?? [], date, card)) {
    const read = readPurses(salaries.text.split("\n"), card, new Map(), "unclear");
    issues.unread.push(...read.unread.map((row) => `MMA Payout salaries: ${row}`));
    // A winner's lone amount there may be show money only: never shown, and
    // reported only where Wikipedia has nothing for that corner.
    for (const [key, row] of read.unclear) {
      const [id, corner] = key.split(":") as [string, Corner];
      if (!pay.get(id)?.purse?.[corner]) issues.unread.push(`MMA Payout salaries: ${row} (doesn't say whether the win bonus is included)`);
    }
    if (read.purses.size) {
      const index = sources.push({ label: "MMA Payout", url: salaries.link, commission: postCommission(salaries.text), caveat: null, cited: null }) - 1;
      for (const [id, corners] of read.purses) {
        const bout = card.find((b) => b.id === id)!;
        for (const corner of ["f1", "f2"] as const) {
          if (corners[corner]) addPurse(bout, corner, corners[corner], index);
        }
      }
    }
  }

  const bonuses = article ? wikipediaBonuses(article.text) : null;
  if (bonuses) {
    const source = { label: "Wikipedia", url: `${WIKI(article!.title)}#Bonus_awards`,
      cited: sectionCitation(articleSection(article!.text, /^Bonus awards?$/i) ?? "", article!.text) };
    const awarded = new Map<string, StoredBonus[]>();
    const give = (id: string, corner: Corner, bonus: StoredBonus) => awarded.set(`${id}:${corner}`, [...awarded.get(`${id}:${corner}`) ?? [], bonus]);
    for (const award of bonuses.awards) {
      for (const name of award.names) {
        const at = placeName(name, card);
        if (!at) { issues.unread.push(`Bonus award: ${BONUS_LABELS[award.kind]}, ${name}`); continue; }
        give(at.bout.id, at.corner, { kind: award.kind, amount: award.amount, note: award.note });
        if (award.amount == null && award.note) issues.bonusNotes.push(`${at.bout[at.corner]} (${BONUS_LABELS[award.kind]}): ${award.note}`);
      }
    }
    if (bonuses.finish) {
      const excepted = bonuses.finish.except.map((name) => placeName(name, card)).filter(Boolean);
      for (const bout of card) {
        const corner = bout.f1Outcome === "win" ? "f1" : bout.f2Outcome === "win" ? "f2" : null;
        if (!corner || !FINISH.test(bout.method ?? "")) continue;
        const theirs = awarded.get(`${bout.id}:${corner}`) ?? [];
        const fightOfTheNight = [...awarded.get(`${bout.id}:f1`) ?? [], ...awarded.get(`${bout.id}:f2`) ?? []].some((b) => b.kind === "fotn");
        if (fightOfTheNight || theirs.some((b) => b.kind !== "fotn")) continue;
        if (excepted.some((at) => at!.bout.id === bout.id && at!.corner === corner)) continue;
        give(bout.id, corner, { kind: "finish", amount: bonuses.finish.amount, note: null });
      }
    }
    for (const bout of card) {
      const f1 = awarded.get(`${bout.id}:f1`) ?? [];
      const f2 = awarded.get(`${bout.id}:f2`) ?? [];
      if (f1.length || f2.length) pay.get(bout.id)!.bonuses = { source, f1, f2 };
    }
  }

  return { pay, issues };
}

let running = false;
const REPORTS_VERSION = createHash("sha256").update(JSON.stringify(PURSE_REPORTS)).digest("hex");
type PayEvent = { id: string; name: string; date: string; wiki_title: string | null };

export function pendingFightPayEvents(limit: number, now = Date.now()): PayEvent[] {
  const cutoff = new Date(now - PAY_REPORT_DAYS * 86_400_000).toISOString().slice(0, 10);
  return db.prepare(`SELECT id, name, date, wiki_title FROM events WHERE complete = 1
    AND (pay_checked_at IS NULL OR (date >= ? AND pay_checked_at < ?))
    ORDER BY date DESC LIMIT ?`).all(cutoff, now - 86_400_000, limit) as PayEvent[];
}

/** Reads each finished card's pay: every card once, newest first, and the
 *  last 180 days' cards again each day, since commissions disclose and
 *  Wikipedia catches up days or weeks after the event. */
export async function syncFightPay(limit = 20, eventIds?: string[]): Promise<{ read: number; failed: number }> {
  const total = { read: 0, failed: 0 };
  if (running) return total;
  running = true;
  try {
    // A bundle update must reach old cards already marked as read. Leave their
    // existing pay intact until the ordinary read succeeds; failures retry.
    if (getMeta("fight_pay_reports_version") !== REPORTS_VERSION) {
      const dates = [...new Set(PURSE_REPORTS.map((report) => report.date))];
      db.prepare(`UPDATE events SET pay_checked_at = NULL WHERE complete = 1 AND date IN (${dates.map(() => "?").join(",")})`).run(...dates);
      setMeta("fight_pay_reports_version", REPORTS_VERSION);
    }
    const events = (eventIds?.length
      ? db.prepare(`SELECT id, name, date, wiki_title FROM events WHERE id IN (${eventIds.map(() => "?").join(",")})`).all(...eventIds)
      : pendingFightPayEvents(limit)) as PayEvent[];
    if (!events.length) return total;
    const dates = events.map((event) => event.date).sort();
    const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
    let posts: PayoutPost[] | null = null;
    let postsError: string | null = null;
    if (dates.at(-1)! >= "2008-01-01") {
      try {
        posts = await mmaPayoutPosts(shift(dates[0] < "2008-01-01" ? "2008-01-01" : dates[0], -3), shift(dates.at(-1)!, PAY_REPORT_DAYS));
      } catch (err) {
        postsError = String(err);
        log("mma payout posts failed:", postsError);
      }
    }
    const storeFight = db.prepare("UPDATE fights SET pay_json = ? WHERE id = ?");
    const storeEvent = db.prepare("UPDATE events SET pay_checked_at = ?, pay_issues_json = ? WHERE id = ?");
    for (const event of events) {
      let article: { title: string; text: string } | null = null;
      try {
        const text = event.wiki_title ? await fetchArticleByTitle(event.wiki_title) : null;
        const section = text ? eventSection(text, event.date) : null;
        article = section ? { title: event.wiki_title!, text: section } : null;
      } catch (err) {
        total.failed++;
        log(`fight pay failed [${event.name}]:`, String(err));
        continue;
      }
      const { pay, issues } = cardPay(cardOf(event.id), article, posts, event.date);
      if (postsError && event.date >= "2008-01-01") issues.failed.push(`MMA Payout could not be read: ${postsError}`);
      const stored = (entry: StoredPay) => entry.purse || entry.bonuses ? JSON.stringify(entry) : null;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [id, entry] of pay) storeFight.run(stored(entry), id);
        const anyIssue = Object.values(issues).some((list) => list.length);
        storeEvent.run(Date.now(), anyIssue ? JSON.stringify(issues) : null, event.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      total.read++;
    }
    if (total.read || total.failed) log(`fight pay: ${total.read} cards read, ${total.failed} failed`);
    return total;
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Compliance pay estimate

/** The Venum deal's scale took effect on April 1, 2021 (first worn April 10). */
export const VENUM_START = "2021-04-01";
/** UFC's Promotional Guidelines Compliance tiers under Venum, by the
 *  athlete's bout count including this one (UFC, plus Zuffa-era WEC and
 *  Strikeforce), as UFC published them in 2021 and reported since. */
const VENUM_TIERS: [maxBouts: number, amount: number, label: string][] = [
  [3, 4_000, "1–3 bouts"], [5, 4_500, "4–5 bouts"], [10, 6_000, "6–10 bouts"],
  [15, 11_000, "11–15 bouts"], [20, 16_000, "16–20 bouts"], [Infinity, 21_000, "21+ bouts"],
];
export const COMPLIANCE_SOURCE: SourceLink = {
  label: "ESPN: UFC's Venum pay scale",
  url: "https://www.espn.com/mma/story/_/id/31176357/ufc-new-venum-uniform-deal-gives-fighters-slight-pay-bump",
};
/** Zuffa bought the WEC in December 2006 and Strikeforce in March 2011;
 *  only bouts under its ownership count toward the tiers. */
const ZUFFA_WEC = "2007-01-01";
const ZUFFA_STRIKEFORCE = "2011-03-12";

export type ComplianceRole = "champion" | "challenger" | null;
export function complianceTier(bouts: number, role: ComplianceRole): { amount: number; tier: string } {
  if (role === "champion") return { amount: 42_000, tier: "Champion" };
  if (role === "challenger") return { amount: 32_000, tier: "Title challenger" };
  const [, amount, tier] = VENUM_TIERS.find(([max]) => bouts <= max)!;
  return { amount, tier };
}

export type ComplianceEstimate = {
  amount: number; tier: string; bouts: number; ufc: number; wec: number; strikeforce: number; role: ComplianceRole;
};
type EstimateFight = {
  id: string; event_date: string; weight_class: string | null; ord: number | string | null; title_fight: number; title_type: string | null;
  f1_id: string | null; f2_id: string | null;
};

/** The tier this bout most likely paid, or why it can't be estimated. */
export function complianceEstimate(fighterId: string | null, fight: EstimateFight): { estimate: ComplianceEstimate | null; gap: string | null } {
  if (fight.event_date < VENUM_START) return { estimate: null, gap: null };
  if (!fighterId) return { estimate: null, gap: "Fighter not linked to a profile" };
  if (fight.title_fight && fight.title_type === "interim") return { estimate: null, gap: "Interim title bouts are not estimated" };
  const career = prepared("SELECT status FROM career_profiles WHERE fighter_id = ?").get(fighterId) as { status: string } | undefined;
  if (career?.status !== "verified") return { estimate: null, gap: "Professional record not verified, so WEC and Strikeforce bouts can't be counted" };
  const { ufc } = prepared(`SELECT COUNT(*) AS ufc FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ?1 OR f.f2_id = ?1) AND (f.id = ?2 OR (e.complete = 1 AND e.date < ?3))`)
    .get(fighterId, fight.id, fight.event_date) as { ufc: number };
  const { wec, strikeforce } = prepared(`SELECT
      SUM(event_name LIKE 'WEC%' AND date >= ?2) AS wec, SUM(event_name LIKE 'Strikeforce%' AND date >= ?3) AS strikeforce
    FROM career_bouts WHERE fighter_id = ?1 AND date < ?4`)
    .get(fighterId, ZUFFA_WEC, ZUFFA_STRIKEFORCE, fight.event_date) as { wec: number | null; strikeforce: number | null };
  let role: ComplianceRole = null;
  if (fight.title_fight && fight.title_type === "title") {
    // Champion and challenger pay, when the champion defends. Reports of a
    // vacant title bout disagree on which rate each side was paid.
    const holders = fightIndex().holdersBefore(fight.weight_class ?? "", fight.event_date, Number(fight.ord) || 0);
    if (!holders.undisputed || ![fight.f1_id, fight.f2_id].includes(holders.undisputed)) return { estimate: null, gap: "Vacant title bouts are not estimated" };
    role = holders.undisputed === fighterId ? "champion" : "challenger";
  }
  const bouts = ufc + (wec ?? 0) + (strikeforce ?? 0);
  return { estimate: { ...complianceTier(bouts, role), bouts, ufc, wec: wec ?? 0, strikeforce: strikeforce ?? 0, role }, gap: null };
}

// ---------------------------------------------------------------------------
// The matchup's answer

export type FightPaySide = {
  purse: (Purse & { source: number; also: string | null }) | null;
  bonuses: { label: string; amount: number | null; note: string | null }[];
  /** Always an estimate: no source publishes it reliably per bout. */
  compliance: ComplianceEstimate | null;
  /** Why fight-week pay isn't estimated for a Venum-era bout. */
  compliance_gap: string | null;
};
export type FightPay = {
  f1: FightPaySide; f2: FightPaySide;
  purse_sources: PaySource[];
  bonus_source: (SourceLink & { cited: SourceLink | null }) | null;
  /** The published tier schedule the estimate reads. */
  compliance_source: SourceLink | null;
  /** Whether this card's sources have been read yet. */
  read: boolean;
};

export function storedPay(json: string | null | undefined): StoredPay | null {
  if (!json) return null;
  try { return JSON.parse(json) as StoredPay; } catch { return null; }
}

/** A finished bout's pay for the matchup, or null when nothing is known. */
export function fightPay(fight: EstimateFight & { pay_json: string | null; event_id: string }): FightPay | null {
  const stored = storedPay(fight.pay_json);
  const read = (prepared("SELECT pay_checked_at FROM events WHERE id = ?").get(fight.event_id) as { pay_checked_at: number | null } | undefined)?.pay_checked_at != null;
  const side = (corner: Corner): FightPaySide => {
    const { estimate, gap } = complianceEstimate(fight[`${corner}_id`], fight);
    return {
      purse: stored?.purse?.[corner] ?? null,
      bonuses: (stored?.bonuses?.[corner] ?? []).map((bonus) => ({ label: BONUS_LABELS[bonus.kind], amount: bonus.amount, note: bonus.note })),
      compliance: estimate,
      compliance_gap: gap,
    };
  };
  const f1 = side("f1");
  const f2 = side("f2");
  // The card's sources, only those this bout's purses came from or are compared with.
  const sources = stored?.purse?.sources ?? [];
  const used = sources.map((source, i) => [f1, f2].some((s) => s.purse?.source === i || s.purse?.also?.includes(`${source.label} lists `)));
  const index = used.map((_, i) => used.slice(0, i).filter(Boolean).length);
  for (const s of [f1, f2]) if (s.purse) s.purse = { ...s.purse, source: index[s.purse.source] };
  const known = (s: FightPaySide) => s.purse || s.bonuses.length || s.compliance;
  if (!known(f1) && !known(f2)) return null;
  return {
    f1, f2,
    purse_sources: sources.filter((_, i) => used[i]),
    bonus_source: stored?.bonuses?.source ?? null,
    compliance_source: f1.compliance || f2.compliance ? COMPLIANCE_SOURCE : null,
    read,
  };
}

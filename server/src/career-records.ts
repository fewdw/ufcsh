import { db } from "./db.ts";
import { daysBetween, log, normName } from "./util.ts";
import {
  scrapeSherdogProfile,
  searchSherdogFighters,
  type SherdogBout,
  type SherdogCandidate,
  type SherdogProfile,
} from "./scrape/sherdog.ts";

const DAY = 86_400_000;
const SOURCE = "sherdog";

export type LocalFighter = {
  id: string;
  name: string;
  nickname: string;
  birth_date: string;
  wins: number;
  losses: number;
  draws: number;
};

export type KnownUfcBout = { id: string; date: string; opponent: string };

export type ReconciledBout = SherdogBout & { isUfc: boolean; ufcFightId: string | null };

function tokens(name: string): string {
  return normName(name).split(" ").filter(Boolean).sort().join(" ");
}

function sourceName(name: string): string {
  return normName(name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\./g, ""));
}

function withoutSuffix(name: string): string {
  return name.replace(/\s+(?:jr|sr|ii|iii|iv)\.?$/i, "").trim();
}

/**
 * The names one person can be filed under. UFCStats often files a fighter by
 * the name they fight as, where the source keeps the legal surname: "Patricio
 * Pitbull" is Sherdog's Patricio Freire, nickname "Pitbull". So a candidate
 * answers to their own name and to that name with the nickname standing in for
 * either half of it — never to the nickname alone, which is not an identity.
 */
export function nameAliases(name: string, nickname = ""): string[] {
  const parts = normName(name).split(" ").filter(Boolean);
  const nick = normName(nickname);
  if (!nick || nick === normName(name) || parts.length < 2) return [name];
  return [name, `${parts[0]} ${nick}`, `${nick} ${parts[parts.length - 1]}`];
}

/** Allows harmless first/last ordering differences, but never fuzzy spelling.
 *  A source nickname, when given, lets the ring name match as well. */
export function samePersonName(a: string, b: string, bNickname = ""): boolean {
  const left = sourceName(a);
  return nameAliases(b, bNickname).some((alias) => {
    const right = sourceName(alias);
    const leftBase = withoutSuffix(left);
    const rightBase = withoutSuffix(right);
    if (leftBase !== left && rightBase !== right && left !== right) return false;
    return leftBase === rightBase || tokens(leftBase) === tokens(rightBase);
  });
}

function looksLikeUfcEvent(name: string): boolean {
  // Unrelated promotions that happen to abbreviate to UFC.
  if (/^UFC (?:Venezuela|- Universal Fight Combat)\b/i.test(name.trim())) return false;
  return /^(?:UFC\b|The Ultimate Fighter\b|Dana White(?:'s)? (?:Tuesday Night )?Contender Series\b)/i.test(name.trim());
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

/**
 * Looser than samePersonName, and only ever used together with a date: one
 * name's words all appear in the other ("Maheshate" / "Maheshate Hayisaer",
 * "Felix Mitchell" / "Felix Lee Mitchell"), or the surname agrees — allowing
 * one typo in a long one — while the first names agree on their start
 * ("Josh" / "Joshua", "Costas" / "Constantinos", "Alberta" / "Alberto").
 */
export function similarOpponentName(a: string, b: string): boolean {
  if (samePersonName(a, b)) return true;
  const left = withoutSuffix(sourceName(a)).split(" ").filter(Boolean);
  const right = withoutSuffix(sourceName(b)).split(" ").filter(Boolean);
  if (!left.length || !right.length) return false;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.every((token) => long.includes(token)) && short.join("").length >= 5) return true;
  if (left.length < 2 || right.length < 2) return false;
  const lastA = left[left.length - 1];
  const lastB = right[right.length - 1];
  const surname = lastA === lastB || (Math.min(lastA.length, lastB.length) >= 5 && oneEditApart(lastA, lastB));
  return surname && left[0].slice(0, 2) === right[0].slice(0, 2);
}

/** The same name allowing one letter's difference in a long word
 *  ("Mehemmedeli" / "Mehemmedali"). Only ever trusted beside a birth date. */
function closeName(a: string, b: string): boolean {
  if (samePersonName(a, b)) return true;
  const left = withoutSuffix(sourceName(a)).split(" ").filter(Boolean);
  const right = withoutSuffix(sourceName(b)).split(" ").filter(Boolean);
  let typos = 0;
  return left.length >= 2 && left.length === right.length && left.every((token, i) => {
    if (token === right[i]) return true;
    typos++;
    return typos === 1 && Math.min(token.length, right[i].length) >= 5 && oneEditApart(token, right[i]);
  });
}

function localUfcBouts(fighterId: string): KnownUfcBout[] {
  return db.prepare(`
    SELECT f.id, e.date,
           CASE WHEN f.f1_id = ? THEN f.f2_name ELSE f.f1_name END AS opponent
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND e.complete = 1
      AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
    ORDER BY e.date ASC, f.ord DESC
  `).all(fighterId, fighterId, fighterId) as KnownUfcBout[];
}

/**
 * Match source rows to UFCStats by date and opponent. A one-day tolerance is
 * accepted only with the same opponent (timezone/date-boundary corrections).
 * A UFC-branded source row remains UFC even if UFCStats lacks it (notably UFC
 * 1), so it can never leak into the outside-UFC totals.
 */
export function reconcileCareerBouts(source: SherdogBout[], known: KnownUfcBout[]): ReconciledBout[] {
  const unused = new Set(known.map((bout) => bout.id));
  return source.map((bout) => {
    let match = known.find((candidate) => unused.has(candidate.id)
      && candidate.date === bout.date
      && samePersonName(candidate.opponent, bout.opponentName));
    if (!match) {
      match = known.find((candidate) => unused.has(candidate.id)
        && Math.abs(daysBetween(candidate.date, bout.date)) <= 1
        && samePersonName(candidate.opponent, bout.opponentName));
    }
    // The same bout under a shortened or misspelled opponent name ("Felix
    // Mitchell" for Felix Lee Mitchell, "Leininger" for Leninger). Only a single
    // such candidate within a day counts, so a tournament night can't mix them.
    if (!match) {
      const similar = known.filter((candidate) => unused.has(candidate.id)
        && Math.abs(daysBetween(candidate.date, bout.date)) <= 1
        && similarOpponentName(candidate.opponent, bout.opponentName));
      if (similar.length === 1) match = similar[0];
    }
    // Some records use a ring name on only one source. A date identifies the
    // bout when both sources contain exactly one row for that fighter within a
    // day of it — the two sources disagree on the date around midnight.
    if (!match) {
      const near = (date: string) => Math.abs(daysBetween(date, bout.date)) <= 1;
      const onDate = known.filter((candidate) => unused.has(candidate.id) && near(candidate.date));
      const sourceOnDate = source.filter((candidate) => near(candidate.date));
      const knownNear = known.filter((candidate) => near(candidate.date));
      if (onDate.length === 1 && knownNear.length === 1 && sourceOnDate.length === 1) match = onDate[0];
    }
    if (match) unused.delete(match.id);
    return {
      ...bout,
      isUfc: Boolean(match) || looksLikeUfcEvent(bout.eventName),
      ufcFightId: match?.id ?? null,
    };
  });
}

function totalsMatch(local: LocalFighter, profile: SherdogProfile): boolean {
  const localTotal = local.wins + local.losses + local.draws;
  return localTotal === 0 || (
    local.wins === profile.wins
    && local.losses === profile.losses
    && local.draws === profile.draws
  );
}

type VerifiedCandidate = {
  candidate: SherdogCandidate;
  profile: SherdogProfile;
  bouts: ReconciledBout[];
  matchedUfc: number;
  score: number;
};

export function isVerifiedIdentity(
  local: LocalFighter,
  candidateCount: number,
  profile: SherdogProfile,
  bouts: ReconciledBout[],
  known: KnownUfcBout[],
): boolean {
  const matched = bouts.filter((bout) => bout.ufcFightId).length;
  const birthMatches = Boolean(local.birth_date && profile.birthDate && local.birth_date === profile.birthDate);
  // UFCStats can freeze a departing fighter's headline record. For a one-bout
  // UFC career, verify that exact old total against the source timeline at the
  // last UFC bout instead of requiring it to equal today's expanded career.
  const lastUfcDate = bouts.filter((bout) => bout.ufcFightId).map((bout) => bout.date).sort().at(-1);
  const atLastUfc = bouts.filter((bout) => lastUfcDate && bout.date <= lastUfcDate);
  const frozenTotalsMatch = known.length === 1 && atLastUfc.length > 0
    && local.wins === atLastUfc.filter((bout) => bout.outcome === "win").length
    && local.losses === atLastUfc.filter((bout) => bout.outcome === "loss").length
    && local.draws === atLastUfc.filter((bout) => bout.outcome === "draw").length;
  const recordMatches = totalsMatch(local, profile) || frozenTotalsMatch;
  const allUfcMatched = matched === known.length;
  // The headline records drift apart by a bout whenever one source is slow to
  // add a result or counts a bout the other doesn't. Two independent keys
  // settle identity without them: the same name (to one typo) and the same
  // date of birth, with every UFC bout we have reconciling exactly. Only for
  // a single bout of drift: anything wider is a stale total to review by hand.
  const recordGap = Math.abs(local.wins - profile.wins) + Math.abs(local.losses - profile.losses) + Math.abs(local.draws - profile.draws);
  if (recordGap <= 1 && birthMatches && allUfcMatched && closeName(local.name, profile.name)) return true;
  // An exact name that also shares our UFC bouts by date and opponent is the
  // same person when the records are one bout apart.
  if (recordGap <= 1 && known.length >= 1 && allUfcMatched && samePersonName(local.name, profile.name)) return true;
  // A debutant has no shared bout, and a regional record often counts bouts the
  // other source doesn't. The only result carrying the name (or a short form of
  // it, "Joe" for Joseph), the same nickname and the same date of birth is the
  // same person at any record gap.
  const sameNickname = Boolean(local.nickname && profile.nickname && normName(local.nickname) === normName(profile.nickname));
  if (known.length === 0 && candidateCount === 1 && birthMatches && sameNickname && similarOpponentName(local.name, profile.name)) return true;
  if (!samePersonName(local.name, profile.name)) {
    // A previously discovered profile may use a legal name or a differently
    // spaced transliteration. A matching birth date plus reconciled UFC history
    // identifies it independently of spelling; a single bout also needs totals.
    const corroborated = birthMatches && (matched >= 2 || (matched === 1 && recordMatches));
    // Only the ring name matches. That is a real identity — but a weaker one
    // than a name, so it has to be carried by something independent: two of
    // our own UFC bouts reconciling exactly, or the same date of birth.
    if (!corroborated) {
      if (!samePersonName(local.name, profile.name, profile.nickname)) return false;
      if (matched < 2 && !birthMatches) return false;
    }
  }
  // Two exact UFC date+opponent matches are a stronger identity key than the
  // UFCStats headline record, which may freeze when a fighter leaves and then
  // continues competing elsewhere. With only one shared bout, keep the record
  // total as an additional independent check.
  if (known.length >= 2) return matched >= 2;
  if (known.length === 1) return matched === 1 && recordMatches;
  if (!totalsMatch(local, profile)) return false;
  // Debutants have no shared UFC bout to use as an identity key. Require the
  // same full record plus either an independent bio match or one unique exact
  // name result. Duplicate names with no corroborating field remain ambiguous.
  return birthMatches || sameNickname || candidateCount === 1;
}

async function resolve(local: LocalFighter, knownUrl = ""): Promise<{ state: "verified"; value: VerifiedCandidate } | { state: "not_found" | "ambiguous"; reason: string }> {
  let searched = knownUrl ? [] : await searchSherdogFighters(local.name);
  const searchName = withoutSuffix(local.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\./g, ""));
  if (!knownUrl && searchName !== local.name && !searched.some((candidate) => samePersonName(local.name, candidate.name, candidate.nickname))) {
    searched = await searchSherdogFighters(searchName);
  }
  // The source may spell the name a letter differently, which its search
  // won't find. The surname alone finds it; only close names are kept, and
  // those still have to verify on birth date and history.
  const surname = searchName.split(" ").filter(Boolean).at(-1) ?? "";
  if (!knownUrl && !searched.length && surname.length >= 4 && surname !== searchName) {
    searched = (await searchSherdogFighters(surname)).filter((candidate) => closeName(local.name, candidate.name));
  }
  const exactCandidates = searched.filter((candidate) => samePersonName(local.name, candidate.name, candidate.nickname));
  const candidates = knownUrl
    ? [{ id: knownUrl.match(/-(\d+)$/)?.[1] ?? "", name: local.name, nickname: local.nickname, url: knownUrl, height: "", weight: "" }]
    : (exactCandidates.length ? exactCandidates : searched).slice(0, 5);
  if (candidates.length === 0) return { state: "not_found", reason: "no source candidate" };
  const known = localUfcBouts(local.id);
  const checked: VerifiedCandidate[] = [];
  for (const candidate of candidates) {
    let profile: SherdogProfile;
    try {
      profile = await scrapeSherdogProfile(candidate.url);
    } catch (error) {
      // Search may return several people with an identical name. A malformed
      // or incomplete page for one candidate must not prevent a different,
      // fully reconciled candidate from being selected.
      if (knownUrl) throw error;
      continue;
    }
    const bouts = reconcileCareerBouts(profile.bouts, known);
    if (!isVerifiedIdentity(local, candidates.length, profile, bouts, known)) continue;
    const matchedUfc = bouts.filter((bout) => bout.ufcFightId).length;
    const bioScore = (local.birth_date && profile.birthDate === local.birth_date ? 20 : 0)
      + (local.nickname && normName(profile.nickname) === normName(local.nickname) ? 10 : 0);
    checked.push({ candidate, profile, bouts, matchedUfc, score: matchedUfc * 100 + bioScore });
  }
  checked.sort((a, b) => b.score - a.score);
  if (checked.length === 0) return { state: "ambiguous", reason: "source candidates failed record/identity reconciliation" };
  if (checked.length > 1 && checked[0].score === checked[1].score) {
    return { state: "ambiguous", reason: "multiple source candidates passed with the same identity score" };
  }
  return { state: "verified", value: checked[0] };
}

function storeVerified(fighterId: string, value: VerifiedCandidate): void {
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    // Nationality rides along with the verified history: it is the same page,
    // read once, and it belongs to the identity we just established.
    db.prepare("UPDATE fighters SET country = ?, country_code = ?, birthplace = ? WHERE id = ?")
      .run(value.profile.country || null, value.profile.countryCode || null, value.profile.birthplace || null, fighterId);
    db.prepare("DELETE FROM career_bouts WHERE fighter_id = ? AND source = ?").run(fighterId, SOURCE);
    const insert = db.prepare(`
      INSERT INTO career_bouts (
        fighter_id, source, source_bout_key, source_order, date, outcome,
        opponent_name, opponent_norm, opponent_url, event_name, event_url,
        method, round, time, is_ufc, ufc_fight_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const bout of value.bouts) {
      insert.run(
        fighterId, SOURCE, bout.key, bout.sourceOrder, bout.date, bout.outcome,
        bout.opponentName, normName(bout.opponentName), bout.opponentUrl,
        bout.eventName, bout.eventUrl, bout.method, bout.round, bout.time,
        bout.isUfc ? 1 : 0, bout.ufcFightId,
      );
    }
    db.prepare(`
      INSERT INTO career_profiles (
        fighter_id, source, source_url, source_name, status, checked_at, fetched_at,
        error, source_wins, source_losses, source_draws, source_ncs
      ) VALUES (?, ?, ?, ?, 'verified', ?, ?, '', ?, ?, ?, ?)
      ON CONFLICT(fighter_id) DO UPDATE SET
        source = excluded.source, source_url = excluded.source_url,
        source_name = excluded.source_name, status = 'verified',
        checked_at = excluded.checked_at, fetched_at = excluded.fetched_at,
        error = '', source_wins = excluded.source_wins,
        source_losses = excluded.source_losses, source_draws = excluded.source_draws,
        source_ncs = excluded.source_ncs
    `).run(
      fighterId, SOURCE, value.profile.url, value.profile.name, now, now,
      value.profile.wins, value.profile.losses, value.profile.draws, value.profile.ncs,
    );
    // Every reconciled UFC row gives us a second, stronger identity bridge:
    // its opponent URL belongs to the UFCStats opponent in that exact bout.
    // Seed that URL so most of the roster can be fetched without name search.
    const fightOpponent = db.prepare(`
      SELECT CASE WHEN f1_id = ? THEN f2_id ELSE f1_id END AS id
      FROM fights WHERE id = ? AND (f1_id = ? OR f2_id = ?)
    `);
    const seed = db.prepare(`
      INSERT INTO career_profiles (fighter_id, source, source_url, status)
      VALUES (?, ?, ?, 'pending')
      ON CONFLICT(fighter_id) DO UPDATE SET
        source_url = COALESCE(career_profiles.source_url, excluded.source_url),
        status = CASE
          WHEN career_profiles.status != 'verified' AND career_profiles.source_url IS NULL THEN 'pending'
          ELSE career_profiles.status
        END,
        checked_at = CASE
          WHEN career_profiles.status != 'verified' AND career_profiles.source_url IS NULL THEN NULL
          ELSE career_profiles.checked_at
        END
    `);
    for (const bout of value.bouts) {
      if (!bout.ufcFightId || !bout.opponentUrl) continue;
      const opponent = fightOpponent.get(fighterId, bout.ufcFightId, fighterId, fighterId) as { id: string } | undefined;
      if (opponent?.id) seed.run(opponent.id, SOURCE, bout.opponentUrl);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function storeUnresolved(fighterId: string, status: "not_found" | "ambiguous" | "error", reason: string): void {
  const existing = db.prepare("SELECT status FROM career_profiles WHERE fighter_id = ?").get(fighterId) as { status: string } | undefined;
  // A temporary source/search disagreement must never erase last-known-good
  // verified history. Keep serving it and record the refresh error alongside.
  const nextStatus = existing?.status === "verified" ? "verified" : status;
  const checkedAt = existing?.status === "verified" ? Date.now() - 6 * DAY : Date.now();
  db.prepare(`
    INSERT INTO career_profiles (fighter_id, source, status, checked_at, error)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(fighter_id) DO UPDATE SET
      status = excluded.status, checked_at = excluded.checked_at, error = excluded.error
  `).run(fighterId, SOURCE, nextStatus, checkedAt, reason.slice(0, 500));
}

export async function syncCareerRecord(fighterId: string): Promise<boolean> {
  const local = db.prepare(`
    SELECT id, name, nickname, birth_date, wins, losses, draws
    FROM fighters WHERE id = ?
  `).get(fighterId) as LocalFighter | undefined;
  if (!local) return false;
  try {
    const existing = db.prepare("SELECT source_url FROM career_profiles WHERE fighter_id = ?").get(fighterId) as { source_url: string | null } | undefined;
    const resolved = await resolve(local, existing?.source_url ?? "");
    if (resolved.state !== "verified") {
      storeUnresolved(fighterId, resolved.state, resolved.reason);
      return false;
    }
    storeVerified(fighterId, resolved.value);
    return true;
  } catch (error) {
    storeUnresolved(fighterId, "error", String(error));
    throw error;
  }
}

let running = false;

/**
 * Resume-safe priority backfill. Booked/ranked fighters are filled first;
 * verified active records refresh weekly and the long-retired tail quarterly.
 */
export async function syncCareerRecords(limit = 40): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const targets = db.prepare(`
      WITH priority AS (
        SELECT fighter_id AS id, 0 AS pri FROM rankings WHERE fighter_id != ''
        UNION ALL
        SELECT f.f1_id, 0 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 0 AND e.date >= date('now')
        UNION ALL
        SELECT f.f2_id, 0 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 0 AND e.date >= date('now')
        UNION ALL
        SELECT f.f1_id, 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-18 months')
        UNION ALL
        SELECT f.f2_id, 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-18 months')
        UNION ALL SELECT f1_id, 2 FROM fights
        UNION ALL SELECT f2_id, 2 FROM fights
      ), candidates AS (
        SELECT fr.id, fr.name, MIN(p.pri) AS pri, cp.status, cp.checked_at,
               fr.country_code, MAX(e.date) AS last_fight
        FROM fighters fr JOIN priority p ON p.id = fr.id
        LEFT JOIN career_profiles cp ON cp.fighter_id = fr.id
        LEFT JOIN fights f ON f.f1_id = fr.id OR f.f2_id = fr.id
        LEFT JOIN events e ON e.id = f.event_id
        GROUP BY fr.id
      )
      SELECT id, name FROM candidates
      WHERE checked_at IS NULL
         OR status = 'pending'
         -- A record verified before nationality was read has no country yet;
         -- it is the same page, so the next refresh simply comes early.
         OR (status = 'verified' AND country_code IS NULL AND checked_at < ?)
         OR (status = 'verified' AND checked_at < CASE WHEN last_fight >= date('now', '-18 months') THEN ? ELSE ? END)
         OR (status = 'error' AND checked_at < ?)
         OR (status IN ('not_found', 'ambiguous') AND checked_at < CASE WHEN pri = 0 THEN ? ELSE ? END)
      ORDER BY pri ASC, (status = 'verified') ASC, checked_at ASC NULLS FIRST
      LIMIT ?
    `).all(now - DAY, now - 7 * DAY, now - 90 * DAY, now - DAY, now - 3 * DAY, now - 30 * DAY, limit) as { id: string; name: string }[];
    let verified = 0;
    for (const fighter of targets) {
      try {
        if (await syncCareerRecord(fighter.id)) verified += 1;
      } catch (error) {
        log(`career record for ${fighter.name} failed:`, String(error));
      }
    }
    if (targets.length) log(`career records: ${verified}/${targets.length} verified or refreshed`);
  } finally {
    running = false;
  }
}

/** Make completed-event participants the first records refreshed next. */
export function staleCareerRecords(fighterIds: string[]): void {
  const stale = db.prepare("UPDATE career_profiles SET checked_at = 0 WHERE fighter_id = ?");
  for (const id of new Set(fighterIds.filter(Boolean))) stale.run(id);
}

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

/** Allows harmless first/last ordering differences, but never fuzzy spelling. */
export function samePersonName(a: string, b: string): boolean {
  return normName(a) === normName(b) || tokens(a) === tokens(b);
}

function looksLikeUfcEvent(name: string): boolean {
  return /^(?:UFC\b|The Ultimate Fighter\b|Dana White(?:'s)? (?:Tuesday Night )?Contender Series\b)/i.test(name.trim());
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
    // Some records use a ring name on only one source. A date identifies the
    // bout when both sources contain exactly one row for that fighter that day.
    if (!match) {
      const onDate = known.filter((candidate) => unused.has(candidate.id) && candidate.date === bout.date);
      const sourceOnDate = source.filter((candidate) => candidate.date === bout.date);
      if (onDate.length === 1 && sourceOnDate.length === 1) match = onDate[0];
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
  if (!samePersonName(local.name, profile.name)) return false;
  const matched = bouts.filter((bout) => bout.ufcFightId).length;
  // Two exact UFC date+opponent matches are a stronger identity key than the
  // UFCStats headline record, which may freeze when a fighter leaves and then
  // continues competing elsewhere. With only one shared bout, keep the record
  // total as an additional independent check.
  if (known.length >= 2) return matched >= 2;
  if (known.length === 1) return matched === 1 && totalsMatch(local, profile);
  if (!totalsMatch(local, profile)) return false;
  const birthMatches = Boolean(local.birth_date && profile.birthDate && local.birth_date === profile.birthDate);
  const nicknameMatches = Boolean(local.nickname && profile.nickname && normName(local.nickname) === normName(profile.nickname));
  // Debutants have no shared UFC bout to use as an identity key. Require the
  // same full record plus either an independent bio match or one unique exact
  // name result. Duplicate names with no corroborating field remain ambiguous.
  return birthMatches || nicknameMatches || candidateCount === 1;
}

async function resolve(local: LocalFighter, knownUrl = ""): Promise<{ state: "verified"; value: VerifiedCandidate } | { state: "not_found" | "ambiguous"; reason: string }> {
  const searched = knownUrl ? [] : await searchSherdogFighters(local.name);
  const candidates = knownUrl
    ? [{ id: knownUrl.match(/-(\d+)$/)?.[1] ?? "", name: local.name, nickname: local.nickname, url: knownUrl, height: "", weight: "" }]
    : searched.filter((candidate) => samePersonName(local.name, candidate.name)).slice(0, 5);
  if (candidates.length === 0) return { state: "not_found", reason: "no exact-name source candidate" };
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
               MAX(e.date) AS last_fight
        FROM fighters fr JOIN priority p ON p.id = fr.id
        LEFT JOIN career_profiles cp ON cp.fighter_id = fr.id
        LEFT JOIN fights f ON f.f1_id = fr.id OR f.f2_id = fr.id
        LEFT JOIN events e ON e.id = f.event_id
        GROUP BY fr.id
      )
      SELECT id, name FROM candidates
      WHERE checked_at IS NULL
         OR (status = 'verified' AND checked_at < CASE WHEN last_fight >= date('now', '-18 months') THEN ? ELSE ? END)
         OR (status = 'error' AND checked_at < ?)
         OR (status IN ('not_found', 'ambiguous') AND checked_at < ?)
      ORDER BY pri ASC, checked_at ASC NULLS FIRST
      LIMIT ?
    `).all(now - 7 * DAY, now - 90 * DAY, now - DAY, now - 30 * DAY, limit) as { id: string; name: string }[];
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

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
export const db = new DatabaseSync(path.join(DATA_DIR, "ufc.db"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 10000;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  date              TEXT NOT NULL,
  location          TEXT NOT NULL DEFAULT '',
  complete          INTEGER NOT NULL DEFAULT 0,
  detail_fetched_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

CREATE TABLE IF NOT EXISTS fighters (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  norm_name        TEXT NOT NULL DEFAULT '',
  nickname         TEXT NOT NULL DEFAULT '',
  height           TEXT NOT NULL DEFAULT '',
  weight           TEXT NOT NULL DEFAULT '',
  reach            TEXT NOT NULL DEFAULT '',
  stance           TEXT NOT NULL DEFAULT '',
  birth_date       TEXT NOT NULL DEFAULT '',
  birth_fetched_at INTEGER,
  wins             INTEGER NOT NULL DEFAULT 0,
  losses           INTEGER NOT NULL DEFAULT 0,
  draws            INTEGER NOT NULL DEFAULT 0,
  belt             INTEGER NOT NULL DEFAULT 0,
  photo_url        TEXT,
  photo_checked_at INTEGER,
  bfo_url          TEXT,
  bfo_checked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fighters_norm ON fighters(norm_name);

CREATE TABLE IF NOT EXISTS fights (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL,
  ord               INTEGER NOT NULL DEFAULT 0,
  weight_class      TEXT NOT NULL DEFAULT '',
  title_fight       INTEGER NOT NULL DEFAULT 0,
  title_type        TEXT NOT NULL DEFAULT '',
  f1_id             TEXT NOT NULL DEFAULT '',
  f2_id             TEXT NOT NULL DEFAULT '',
  f1_name           TEXT NOT NULL DEFAULT '',
  f2_name           TEXT NOT NULL DEFAULT '',
  f1_outcome        TEXT,
  f2_outcome        TEXT,
  method            TEXT,
  method_details    TEXT,
  round             TEXT,
  time              TEXT,
  f1_kd TEXT, f1_str TEXT, f1_td TEXT, f1_sub TEXT,
  f2_kd TEXT, f2_str TEXT, f2_td TEXT, f2_sub TEXT,
  perf_bonus       INTEGER,
  fotn_bonus       INTEGER,
  detail_json       TEXT,
  detail_fetched_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fights_event ON fights(event_id);
CREATE INDEX IF NOT EXISTS idx_fights_f1 ON fights(f1_id);
CREATE INDEX IF NOT EXISTS idx_fights_f2 ON fights(f2_id);

CREATE TABLE IF NOT EXISTS rankings (
  ranking_type TEXT NOT NULL CHECK (ranking_type IN ('meta', 'media')),
  division     TEXT NOT NULL,
  weight_limit TEXT NOT NULL DEFAULT '',
  div_pos      INTEGER NOT NULL,
  rank         TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  fighter_id   TEXT NOT NULL DEFAULT '',
  rank_change  TEXT,
  PRIMARY KEY (ranking_type, division, div_pos)
);

CREATE TABLE IF NOT EXISTS image_queue (
  fighter_id   TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS odds (
  fight_id   TEXT PRIMARY KEY,
  f1_open    TEXT,
  f1_close   TEXT,
  f2_open    TEXT,
  f2_close   TEXT,
  f1_history TEXT,
  f2_history TEXT,
  source_url TEXT,
  final      INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER
);

-- Pre-fight prop prices, kept separately from the two-way moneyline.
-- markets_json holds every named sportsbook quote (or the source's mean price
-- where no book column survives) and the fighter ids it was verified against.
-- final = 1 once read from the completed event's board: closing prices.
CREATE TABLE IF NOT EXISTS method_odds (
  fight_id          TEXT PRIMARY KEY,
  markets_json      TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  final             INTEGER NOT NULL DEFAULT 0,
  fetched_at        INTEGER NOT NULL
);

-- A verified link from our UFCStats identity to a complete professional
-- record source. A verified status is deliberately required before any of
-- the rows below are used: common names are never joined by name alone.
CREATE TABLE IF NOT EXISTS career_profiles (
  fighter_id       TEXT PRIMARY KEY,
  source           TEXT NOT NULL DEFAULT 'sherdog',
  source_url       TEXT,
  source_name      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'verified', 'not_found', 'ambiguous', 'error')),
  checked_at       INTEGER,
  fetched_at       INTEGER,
  error            TEXT NOT NULL DEFAULT '',
  source_wins      INTEGER,
  source_losses    INTEGER,
  source_draws     INTEGER,
  source_ncs       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_career_profiles_refresh
  ON career_profiles(status, checked_at);

-- All professional rows from the verified source are retained, including the
-- UFC rows used for reconciliation. Unmatched non-UFC rows are therefore the
-- exact, dated outside-UFC history; matched UFC rows cannot be double-counted.
CREATE TABLE IF NOT EXISTS career_bouts (
  fighter_id        TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'sherdog',
  source_bout_key   TEXT NOT NULL,
  source_order      INTEGER NOT NULL DEFAULT 0,
  date              TEXT NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'draw', 'nc')),
  opponent_name     TEXT NOT NULL,
  opponent_norm     TEXT NOT NULL,
  opponent_url      TEXT,
  event_name        TEXT NOT NULL DEFAULT '',
  event_url         TEXT,
  method            TEXT NOT NULL DEFAULT '',
  round             TEXT NOT NULL DEFAULT '',
  time              TEXT NOT NULL DEFAULT '',
  is_ufc            INTEGER NOT NULL DEFAULT 0,
  ufc_fight_id      TEXT,
  PRIMARY KEY (fighter_id, source, source_bout_key)
);
CREATE INDEX IF NOT EXISTS idx_career_bouts_fighter_date
  ON career_bouts(fighter_id, date, source_order);
CREATE INDEX IF NOT EXISTS idx_career_bouts_ufc
  ON career_bouts(ufc_fight_id);
`);

const careerBoutColumns = db.prepare("PRAGMA table_info(career_bouts)").all() as { name: string }[];
if (!careerBoutColumns.some((column) => column.name === "is_ufc")) {
  db.exec("ALTER TABLE career_bouts ADD COLUMN is_ufc INTEGER NOT NULL DEFAULT 0");
}

const fighterColumns = db.prepare("PRAGMA table_info(fighters)").all() as { name: string }[];
if (!fighterColumns.some((column) => column.name === "birth_date")) {
  db.exec("ALTER TABLE fighters ADD COLUMN birth_date TEXT NOT NULL DEFAULT ''");
}
if (!fighterColumns.some((column) => column.name === "birth_fetched_at")) {
  db.exec("ALTER TABLE fighters ADD COLUMN birth_fetched_at INTEGER");
}

// The event listing only marks that a belt is at stake. The fight-details page
// supplies the authoritative distinction between undisputed and interim belts.
const fightColumns = db.prepare("PRAGMA table_info(fights)").all() as { name: string }[];
if (!fightColumns.some((column) => column.name === "title_type")) {
  db.exec("ALTER TABLE fights ADD COLUMN title_type TEXT NOT NULL DEFAULT ''");
}
db.exec(`
  UPDATE fights
  SET title_type = CASE
    WHEN detail_json LIKE '%"titleBout":"interim"%' THEN 'interim'
    WHEN detail_json LIKE '%"titleBout":"title"%' THEN 'title'
    ELSE title_type
  END
  WHERE title_type = '' AND detail_json IS NOT NULL
`);

// UFC's first championship was called the Superfight Championship. UFCStats
// marks these five bouts with a belt but its historical headings do not use the
// modern "Title Bout" wording. Keep the immutable fight IDs explicit so no
// ordinary open-weight bout can be promoted by a fuzzy name/date heuristic.
// UFC 5 was the inaugural (drawn) title bout; UFC 6–9 continued that lineage.
db.exec(`
  UPDATE fights
  SET title_type = 'title',
      detail_json = CASE
        WHEN detail_json IS NULL THEN NULL
        ELSE json_set(detail_json, '$.titleBout', 'title')
      END
  WHERE title_fight = 1 AND id IN (
    'db8df615610f3632',
    'd62aec55bc142346',
    '3932f8e9a74f3d11',
    '16b4a0b06427f1ac',
    '6a060498e60756af'
  )
`);

// Earlier title typing treated tournament/TUF finals as UFC divisional belts.
// Re-fetch those authoritative headings once so they cannot create fake reigns.
if (getMeta("migration_title_types") !== "2") {
  db.exec(`
    UPDATE fights SET title_type = '', detail_json = NULL, detail_fetched_at = NULL
    WHERE title_fight = 1
  `);
  setMeta("migration_title_types", "2");
}

// Meta rankings were added alongside the traditional media-panel rankings.
// Rebuild the old single-source table once so both complete datasets can be
// stored without colliding on division/position. Existing rows are Media rows.
const rankingColumns = db.prepare("PRAGMA table_info(rankings)").all() as { name: string }[];
if (!rankingColumns.some((column) => column.name === "ranking_type")) {
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE rankings RENAME TO rankings_single_source;
      CREATE TABLE rankings (
        ranking_type TEXT NOT NULL CHECK (ranking_type IN ('meta', 'media')),
        division     TEXT NOT NULL,
        weight_limit TEXT NOT NULL DEFAULT '',
        div_pos      INTEGER NOT NULL,
        rank         TEXT NOT NULL,
        fighter_name TEXT NOT NULL,
        fighter_id   TEXT NOT NULL DEFAULT '',
        rank_change  TEXT,
        PRIMARY KEY (ranking_type, division, div_pos)
      );
      INSERT INTO rankings
        (ranking_type, division, weight_limit, div_pos, rank, fighter_name, fighter_id, rank_change)
      SELECT 'media', division, weight_limit, div_pos, rank, fighter_name, fighter_id, rank_change
      FROM rankings_single_source;
      DROP TABLE rankings_single_source;
      INSERT INTO meta (key, value) VALUES ('rankings_synced_at', '0')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      COMMIT;
    `);
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The failing statement may already have ended the transaction.
    }
    throw err;
  }
}
db.exec("CREATE INDEX IF NOT EXISTS idx_rankings_fighter ON rankings(fighter_id, ranking_type)");

// Columns added after the first release; ignore "duplicate column" on re-run.
// The schedule columns hold what UFCStats has no notion of: when each segment
// of a card starts, and which segment a bout is on. Both come from ufc.com.
for (const alter of [
  "ALTER TABLE fighters ADD COLUMN bfo_url TEXT",
  "ALTER TABLE fighters ADD COLUMN bfo_checked_at INTEGER",
  "ALTER TABLE fights ADD COLUMN perf_bonus INTEGER",
  "ALTER TABLE fights ADD COLUMN fotn_bonus INTEGER",
  "ALTER TABLE events ADD COLUMN ufc_slug TEXT",
  "ALTER TABLE events ADD COLUMN main_card_at INTEGER",
  "ALTER TABLE events ADD COLUMN prelims_at INTEGER",
  "ALTER TABLE events ADD COLUMN early_prelims_at INTEGER",
  "ALTER TABLE events ADD COLUMN schedule_fetched_at INTEGER",
  "ALTER TABLE events ADD COLUMN segments_fetched_at INTEGER",
  "ALTER TABLE events ADD COLUMN bfo_url TEXT",
  "ALTER TABLE events ADD COLUMN bfo_checked_at INTEGER",
  "ALTER TABLE events ADD COLUMN bfo_final_at INTEGER",
  "ALTER TABLE fights ADD COLUMN segment TEXT",
  // How many rounds the bout is booked for, from ufc.com's live-card feed.
  // NULL until that feed has identified the bout; never inferred.
  "ALTER TABLE fights ADD COLUMN scheduled_rounds INTEGER",
  // Weigh-in misses, from the event's Wikipedia article: the weight in pounds
  // as text, "" when the article gives none, NULL when the fighter made weight
  // or the card has not been read (events.wiki_checked_at says which).
  "ALTER TABLE fights ADD COLUMN f1_weight_miss TEXT",
  "ALTER TABLE fights ADD COLUMN f2_weight_miss TEXT",
  "ALTER TABLE events ADD COLUMN wiki_title TEXT",
  "ALTER TABLE events ADD COLUMN wiki_checked_at INTEGER",
  // Nationality comes from the same verified professional-history page the
  // career record does, so it costs no extra source and cannot be attached to
  // a fighter whose identity was never established.
  "ALTER TABLE fighters ADD COLUMN country TEXT",
  "ALTER TABLE fighters ADD COLUMN country_code TEXT",
  "ALTER TABLE fighters ADD COLUMN birthplace TEXT",
  // ufc.com's full-body cut-out, kept beside the headshot rather than
  // replacing it: the two are different crops with different coverage, and the
  // interface offers both.
  "ALTER TABLE fighters ADD COLUMN photo_full_url TEXT",
  // When a bout's moneyline was last looked for, found or not. fetched_at only
  // moves when a price is stored, so on its own it can't tell "not posted yet"
  // from "never tried".
  "ALTER TABLE odds ADD COLUMN checked_at INTEGER",
]) {
  try {
    db.exec(alter);
  } catch {
    // column already exists
  }
}

// Identity resolution used to reject a source page whose name differed from
// ours, which lost every fighter UFCStats files under a ring name (Patricio
// Pitbull is Sherdog's Patricio Freire). Retry the unresolved rows once under
// the rule that accepts a nickname carried by two reconciled UFC bouts.
// Full-body pictures arrived after every fighter had already been checked for
// a headshot, and both come from the same page fetch. Clearing the stamp lets
// the ordinary background image pass collect the missing half, most-visible
// fighters first; a failed re-check keeps whatever photo is already stored.
if (getMeta("migration_full_body_photos") !== "1") {
  db.exec("UPDATE fighters SET photo_checked_at = NULL WHERE photo_full_url IS NULL");
  setMeta("migration_full_body_photos", "1");
}

// Directory imports previously marked headshot-only rows as fully checked.
// Retry those athlete pages once now that the directory leaves the stamp alone.
if (getMeta("migration_directory_image_checks") !== "1") {
  db.exec("UPDATE fighters SET photo_checked_at = NULL WHERE photo_full_url IS NULL OR photo_full_url = ''");
  setMeta("migration_directory_image_checks", "1");
}

// ufc.com's silhouette stand-ins were being stored as real pictures, which left
// a fighter it has no photograph of showing a grey outline where the matchup
// draws a full body and an empty circle where every list draws a face. The
// scrape now refuses them, but a stored one would never be replaced — an empty
// scrape deliberately keeps whatever is already on file — so clear them here
// and let the ordinary image pass look again. Run a second time because the
// athlete directory pass kept writing silhouettes back until it refused them too.
if (getMeta("migration_placeholder_photos_v2") !== "1") {
  db.exec(`
    UPDATE fighters SET photo_checked_at = NULL,
      photo_url = CASE WHEN photo_url LIKE '%no-profile-image%' OR photo_url LIKE '%silhouette%'
                         OR photo_url LIKE '%shadow%' THEN NULL ELSE photo_url END,
      photo_full_url = CASE WHEN photo_full_url LIKE '%no-profile-image%' OR photo_full_url LIKE '%silhouette%'
                         OR photo_full_url LIKE '%shadow%' THEN NULL ELSE photo_full_url END
    WHERE photo_url LIKE '%no-profile-image%' OR photo_url LIKE '%silhouette%' OR photo_url LIKE '%shadow%'
       OR photo_full_url LIKE '%no-profile-image%' OR photo_full_url LIKE '%silhouette%' OR photo_full_url LIKE '%shadow%'
  `);
  setMeta("migration_placeholder_photos_v2", "1");
}

if (getMeta("migration_career_identity_and_unlinked_bouts") !== "1") {
  db.exec("UPDATE career_profiles SET checked_at = NULL WHERE status != 'verified'");
  setMeta("migration_career_identity_and_unlinked_bouts", "1");
}

if (getMeta("migration_ring_names") !== "1") {
  db.exec("UPDATE career_profiles SET checked_at = 0 WHERE status IN ('not_found', 'ambiguous')");
  setMeta("migration_ring_names", "1");
}

export function getMeta(key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function metaAgeMs(key: string): number {
  const v = getMeta(key);
  return v ? Date.now() - Number(v) : Infinity;
}

export function touchMeta(key: string): void {
  setMeta(key, String(Date.now()));
}

// Cached fight details predate the per-round tables and the f1/f2-normalised
// scorecards. Drop the stale copies so they are re-fetched (lazily, on first
// view) in the current shape.
if (getMeta("migration_detail_rounds") !== "2") {
  db.exec(
    `UPDATE fights SET detail_json = NULL, detail_fetched_at = NULL
     WHERE detail_json LIKE '%"past"%'
       AND (detail_json NOT LIKE '%totalsRounds%'
            OR (detail_json LIKE '%judges%' AND detail_json NOT LIKE '%f1Score%'))`,
  );
  setMeta("migration_detail_rounds", "2");
}

// v1: every stat table on a fight-details page was read by column position, but
// the page orders the fighters by the original bout order while the event page
// puts the winner first — so roughly half of all cached details had both
// fighters' stats swapped. v2: details now also carry which belt is on the line
// (interim vs undisputed), which only the fight-details page names. Either way
// the fix is the same — drop the cached copies and let them re-fetch.
if (getMeta("migration_detail_fighter_order") !== "2") {
  db.exec("UPDATE fights SET detail_json = NULL, detail_fetched_at = NULL WHERE detail_json IS NOT NULL");
  setMeta("migration_detail_fighter_order", "2");
}

// Props before v4 were either stored without fighter ids or hidden behind a
// timestamp gate, and older boards were never priced. Re-read every board.
if (getMeta("migration_method_odds") !== "4") {
  db.exec("DELETE FROM method_odds");
  db.exec("UPDATE events SET bfo_checked_at = NULL, bfo_final_at = NULL");
  setMeta("migration_method_odds", "4");
}

// Event boards now also fill moneylines the fighter pages missed. Re-read the
// completed cards that still have a fight without one (props already stored
// as final are skipped, so this costs a board request, not a re-scrape).
if (getMeta("migration_board_moneyline") !== "2") {
  db.exec(`UPDATE events SET bfo_final_at = NULL WHERE complete = 1 AND id IN (
    SELECT f.event_id FROM fights f LEFT JOIN odds o ON o.fight_id = f.id WHERE o.f1_close IS NULL)`);
  // Fighter pages now also yield bouts filed under the source's undated
  // "Future Events" page; rescan fighters who still have a missing line.
  db.exec(`UPDATE fighters SET bfo_checked_at = NULL WHERE id IN (
    SELECT f.f1_id FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 1 AND o.f1_close IS NULL
    UNION SELECT f.f2_id FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 1 AND o.f1_close IS NULL)`);
  setMeta("migration_board_moneyline", "2");
}

// Knockout and Submission of the Night (the pre-2014 performance awards) were
// not read before. Re-read bonuses for every card from those years.
if (getMeta("migration_bonus_kinds") !== "1") {
  db.exec("UPDATE fights SET perf_bonus = NULL WHERE event_id IN (SELECT id FROM events WHERE date < '2014-07-01')");
  setMeta("migration_bonus_kinds", "1");
}

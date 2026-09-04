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
for (const alter of [
  "ALTER TABLE fighters ADD COLUMN bfo_url TEXT",
  "ALTER TABLE fighters ADD COLUMN bfo_checked_at INTEGER",
  "ALTER TABLE fights ADD COLUMN perf_bonus INTEGER",
  "ALTER TABLE fights ADD COLUMN fotn_bonus INTEGER",
]) {
  try {
    db.exec(alter);
  } catch {
    // column already exists
  }
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

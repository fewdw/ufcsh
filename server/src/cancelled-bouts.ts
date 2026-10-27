import { db, metaAgeMs, prepared, setMeta, touchMeta } from "./db.ts";
import { fighterNamed, hasUfcFight } from "./fighter-identity.ts";
import { HttpRateLimitError } from "./http.ts";
import { fightOddsAllEvents, fightOddsCancelled, type FightOddsCancelled } from "./scrape/fightodds.ts";
import { log, normName } from "./util.ts";

/** Bookings that fell through. FightOdds.io keeps every bout ever posted to a
 *  UFC board, flagging the ones that were cancelled on the card they were
 *  booked for, and files both corners under their UFCStats page: the same
 *  list Tapology shows, read by identity rather than by name. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UPCOMING_EVERY = 6 * HOUR;

/** All or nothing, and nestable inside a caller's own transaction. */
function inSavepoint(write: () => void): void {
  db.exec("SAVEPOINT cancelled_bouts_write");
  try {
    write();
    db.exec("RELEASE cancelled_bouts_write");
  } catch (err) {
    db.exec("ROLLBACK TO cancelled_bouts_write; RELEASE cancelled_bouts_write");
    throw err;
  }
}

type Board = { pk: number; date: string; slug: string; name: string; read_at: number | null; error: string };

/** Read when never read; every six hours until the card is over, since a bout
 *  can fall through up to the day itself; and once after, so the list a past
 *  card keeps is the one read when nothing more could change. */
export function boardDue(board: Pick<Board, "date" | "read_at">, now = Date.now()): boolean {
  if (board.read_at == null) return true;
  const over = Date.parse(`${board.date}T00:00:00Z`) + 2 * DAY;
  if (board.read_at >= over) return false;
  return now >= over || now - board.read_at >= UPCOMING_EVERY;
}

/** FightOdds.io's list of UFC boards, kept in `cancelled_boards`. */
export async function readCancelledBoardList(): Promise<number> {
  try {
    const events = (await fightOddsAllEvents()).filter((event) => event.slug !== "future-fights");
    const upsert = db.prepare(`INSERT INTO cancelled_boards (pk, date, slug, name) VALUES (?, ?, ?, ?)
      ON CONFLICT(pk) DO UPDATE SET date = excluded.date, slug = excluded.slug, name = excluded.name,
        -- A card moved to a later date is coming again, so it's read again.
        read_at = CASE WHEN cancelled_boards.date = excluded.date THEN cancelled_boards.read_at END`);
    inSavepoint(() => { for (const event of events) upsert.run(event.pk, event.date, event.slug, event.name); });
    touchMeta("cancelled_boards_listed_at");
    setMeta("cancelled_boards_error", "");
    return events.length;
  } catch (err) {
    setMeta("cancelled_boards_error", String(err));
    throw err;
  }
}

let running = false;
/** A board FightOdds.io fails to answer (UFC 193's errors on their side) is
 *  tried again a day later, not on every pass; its error stays in Admin → Bugs. */
const failedAt = new Map<number, number>();

/** One pass: the board list daily, then up to `limit` due boards, nearest
 *  card first and then the archive newest first. `pk` re-reads one board. */
export async function syncCancelledBouts({ limit = 40, pk }: { limit?: number; pk?: number } = {}): Promise<{ boards: number; bouts: number; failed: number }> {
  if (running && pk == null) return { boards: 0, bouts: 0, failed: 0 };
  if (pk == null) running = true;
  try {
    if (pk == null && metaAgeMs("cancelled_boards_listed_at") > DAY) await readCancelledBoardList();
    const boards = db.prepare("SELECT * FROM cancelled_boards WHERE ? IS NULL OR pk = ?").all(pk ?? null, pk ?? null) as Board[];
    const today = new Date().toISOString().slice(0, 10);
    const due = boards.filter((board) => pk != null || (boardDue(board) && Date.now() - (failedAt.get(board.pk) ?? -Infinity) >= DAY))
      .sort((a, b) => Number(b.date >= today) - Number(a.date >= today)
        || (a.date >= today ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))
      .slice(0, pk != null ? 1 : limit);
    const result = { boards: 0, bouts: 0, failed: 0 };
    for (const board of due) {
      try {
        const bouts = await fightOddsCancelled(board.pk);
        result.bouts += storeCancelledBoard(board, bouts);
        result.boards++;
        failedAt.delete(board.pk);
      } catch (err) {
        // A host-wide cooldown says nothing about this board. Leave its
        // saved snapshot and retry eligibility alone, and stop this pass.
        if (err instanceof HttpRateLimitError) throw err;
        result.failed++;
        failedAt.set(board.pk, Date.now());
        db.prepare("UPDATE cancelled_boards SET error = ? WHERE pk = ?").run(String(err), board.pk);
        log(`cancelled bouts [${board.slug}]:`, String(err));
        if (pk != null) throw err;
      }
    }
    return result;
  } finally {
    if (pk == null) running = false;
  }
}

/** The board's cancelled bouts replace what it listed before: a bout put back
 *  on the card drops out. Unchanged rows are left alone, so a re-read that
 *  finds nothing new doesn't invalidate cached profiles. */
export function storeCancelledBoard(board: Pick<Board, "pk" | "date" | "name">, bouts: FightOddsCancelled[], now = Date.now()): number {
  // The board's UFCStats link is kept even before we hold that fighter: a
  // name would pin a debutant's cancellation on a namesake. A corner it hasn't
  // linked is named, and the rule the event articles' cancellations use picks
  // who that name means on that date.
  const corner = (id: string | null, name: string, division: string) => id ?? (fighterNamed(name, division, board.date) || null);
  const upsert = db.prepare(`
    INSERT INTO cancelled_bouts (slug, board_pk, date, event_name, weight_class, f1_id, f2_id, f1_name, f2_name, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET board_pk = excluded.board_pk, date = excluded.date, event_name = excluded.event_name,
      weight_class = excluded.weight_class, f1_id = excluded.f1_id, f2_id = excluded.f2_id,
      f1_name = excluded.f1_name, f2_name = excluded.f2_name, checked_at = excluded.checked_at`);
  const listed = db.prepare("SELECT slug FROM cancelled_bouts WHERE board_pk = ?").all(board.pk) as { slug: string }[];
  const remove = db.prepare("DELETE FROM cancelled_bouts WHERE slug = ?");
  const slugs = new Set(bouts.map((bout) => bout.slug));
  inSavepoint(() => {
    for (const bout of bouts) {
      upsert.run(bout.slug, board.pk, board.date, board.name, bout.weightClass,
        corner(bout.f1.id, bout.f1.name, bout.weightClass), corner(bout.f2.id, bout.f2.name, bout.weightClass),
        bout.f1.name, bout.f2.name, now);
    }
    for (const row of listed) if (!slugs.has(row.slug)) remove.run(row.slug);
    db.prepare("UPDATE cancelled_boards SET read_at = ?, error = '' WHERE pk = ?").run(now, board.pk);
  });
  return bouts.length;
}

type Corner = { id: string | null; name: string };

/** A booking that fell through on one card, from whichever source lists it:
 *  FightOdds.io's board (by UFCStats id), the card's Wikipedia article
 *  (a bout it says was scrapped), or the replacement the article names (the
 *  fighter replaced, against the opponent who stayed). */
export type Cancellation = {
  key: string;
  date: string;
  event_name: string;
  /** Our card, when we list one: a card cancelled outright has none. */
  event_id: string | null;
  f1: Corner;
  f2: Corner;
  division: string | null;
  /** Why, as the article says it, or who the replacement was. */
  reason: string | null;
  source_url: string;
};

export type CancelledBout = {
  key: string;
  date: string;
  event_name: string;
  /** Our card on that date, when we list one: a card cancelled outright has none. */
  event_id: string | null;
  weight_class: string;
  opponent: { id: string | null; name: string };
  /** Why, from the event's Wikipedia article, when it says. */
  reason: string | null;
  /** The same two fighters' bout within a year after, fought or booked:
   *  the booking moved to that card rather than falling through. */
  moved_to: { fight_id: string; date: string; event_name: string } | null;
  source_url: string;
};

type Card = { id: string; name: string; date: string; wiki_title: string | null; cancelled_json: string | null };
type Fought = { date: string; opponent: { id?: string | null; name: string } };

const surnameOf = (name: string) => normName(name).split(" ").filter((word) => !/^(?:jr|sr|ii|iii|iv)$/.test(word)).at(-1) ?? "";
/** One person across sources: the same id or name, or a bare surname with no
 *  id ("Allen" in an article) and the full name it ends. Two ids are two people. */
const samePerson = (a: Corner, b: Corner) => (a.id != null && a.id === b.id) || normName(a.name) === normName(b.name)
  || (!(a.id && b.id) && [a, b].some((side) => !normName(side.name).includes(" ")) && surnameOf(a.name) === surnameOf(b.name));
const samePair = (a: { f1: Corner; f2: Corner }, b: { f1: Corner; f2: Corner }) =>
  (samePerson(a.f1, b.f1) && samePerson(a.f2, b.f2)) || (samePerson(a.f1, b.f2) && samePerson(a.f2, b.f1));

const cardColumns = "id, name, date, wiki_title, cancelled_json";
const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/** The card a board is for: ours within a day of it (FightOdds.io dates some
 *  cards a day late), told apart by the words of its name when there are two,
 *  and none for a card cancelled outright. */
export function boardCard(board: Pick<Board, "date" | "slug" | "name">): Card | null {
  if (/-canc[a-z]*$/.test(board.slug) || /\(canc/i.test(board.name)) return null;
  const cards = prepared(`SELECT ${cardColumns} FROM events WHERE date BETWEEN date(?, '-1 day') AND date(?, '+1 day')`)
    .all(board.date, board.date) as Card[];
  if (cards.length <= 1) return cards[0] ?? null;
  const words = (name: string) => normName(name).split(" ").filter((word) => !/^(?:ufc|fight|night|on|espn|fox|fx|fuel|tv|abc|vs)$/.test(word));
  const score = (card: Card) => words(board.name).filter((word) => words(card.name).includes(word)).length;
  const best = Math.max(...cards.map(score));
  const named = cards.filter((card) => best > 0 && score(card) === best);
  if (named.length === 1) return named[0];
  const sameDay = (named.length ? named : cards).filter((card) => card.date === board.date);
  return sameDay.length === 1 ? sameDay[0] : null;
}

/** The division a corner fought at nearest the date. */
function divisionAt(id: string | null, date: string): string | undefined {
  if (!id) return undefined;
  return (prepared(`SELECT f.weight_class FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND f.weight_class NOT IN ('', 'Catch Weight')
    ORDER BY abs(julianday(e.date) - julianday(?)) LIMIT 1`).get(id, id, date) as { weight_class: string } | undefined)?.weight_class;
}

/** Every booking that fell through on one card, each pairing once: the
 *  board's first (its ids are UFCStats'), then the article's scrapped bouts,
 *  then the pairings its replacements broke up. */
export function cardCancellations(card: Card): Cancellation[] {
  const fights = prepared(`SELECT weight_class, f1_id, f2_id, f1_name, f2_name, f1_replaced, f2_replaced, f1_replaced_id, f2_replaced_id,
    f1_outcome IS NOT NULL OR f2_outcome IS NOT NULL AS fought FROM fights WHERE event_id = ? ORDER BY ord`).all(card.id) as {
    weight_class: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string;
    f1_replaced: string | null; f2_replaced: string | null; f1_replaced_id: string | null; f2_replaced_id: string | null; fought: number }[];
  const listed = fights.map((fight) => ({ f1: { id: fight.f1_id, name: fight.f1_name }, f2: { id: fight.f2_id, name: fight.f2_name }, fought: !!fight.fought }));
  const checked = (listed: string, f1: Corner, f2: Corner) =>
    bookedDivision(listed, [divisionAt(f1.id, card.date), divisionAt(f2.id, card.date)]) || null;
  const article = card.wiki_title ? wikiUrl(card.wiki_title) : null;
  const list: Cancellation[] = [];
  // A pairing that fought on the card is a stale entry. One still listed for a
  // coming card stands only on the board's word: UFCStats is slower to drop a
  // changed bout than the board, and an article's prose is read less surely.
  const add = (entry: Omit<Cancellation, "date" | "event_name" | "event_id">, board = false) => {
    if (listed.some((pair) => (pair.fought || !board) && samePair(pair, entry))) return;
    const same = list.find((other) => samePair(other, entry));
    if (!same) {
      list.push({ ...entry, date: card.date, event_name: card.name, event_id: card.id });
      return;
    }
    const [f1, f2] = samePerson(same.f1, entry.f1) && samePerson(same.f2, entry.f2) ? [entry.f1, entry.f2] : [entry.f2, entry.f1];
    same.f1.id ??= f1.id;
    same.f2.id ??= f2.id;
    same.division ??= entry.division;
    same.reason ??= entry.reason;
  };

  const boards = (prepared("SELECT pk, date, slug, name FROM cancelled_boards WHERE date BETWEEN date(?, '-1 day') AND date(?, '+1 day')")
    .all(card.date, card.date) as Pick<Board, "pk" | "date" | "slug" | "name">[]).filter((board) => boardCard(board)?.id === card.id);
  const onBoard = prepared("SELECT * FROM cancelled_bouts WHERE board_pk = ? ORDER BY rowid");
  for (const board of boards) {
    for (const row of onBoard.all(board.pk) as Stored[]) {
      const f1 = { id: row.f1_id, name: row.f1_name };
      const f2 = { id: row.f2_id, name: row.f2_name };
      add({ key: row.slug, f1, f2, division: checked(row.weight_class, f1, f2), reason: null, source_url: `https://fightodds.io/fights/${row.slug}/odds` }, true);
    }
  }

  let scrapped: { f1: string; f2: string; f1_id?: string | null; f2_id?: string | null; division?: string | null; reason?: string | null }[] = [];
  try { scrapped = JSON.parse(card.cancelled_json ?? "[]"); } catch { /* unread */ }
  for (const [index, bout] of scrapped.entries()) {
    add({ key: `${card.id}:article:${index}`, f1: { id: bout.f1_id ?? null, name: bout.f1 }, f2: { id: bout.f2_id ?? null, name: bout.f2 },
      division: bout.division ?? null, reason: bout.reason ?? null, source_url: article ?? "" });
  }

  // "Allen withdrew and was replaced by Keita": Allen against Keita's opponent.
  // Only where the opponent stayed: with both corners replaced, who was first
  // booked against whom isn't known.
  for (const [index, fight] of fights.entries()) {
    for (const [replaced, replacedId, name, stayed] of [
      [fight.f1_replaced, fight.f1_replaced_id, fight.f1_name, { id: fight.f2_id, name: fight.f2_name, replaced: fight.f2_replaced }],
      [fight.f2_replaced, fight.f2_replaced_id, fight.f2_name, { id: fight.f1_id, name: fight.f1_name, replaced: fight.f1_replaced }],
    ] as const) {
      if (!replaced || stayed.replaced || !article) continue;
      const out = { id: replacedId, name: replaced };
      const kept = { id: stayed.id, name: stayed.name };
      add({ key: `${card.id}:replaced:${index}:${normName(replaced)}`, f1: out, f2: kept,
        division: checked(fight.weight_class === "Catch Weight" ? "" : fight.weight_class, out, kept),
        reason: `${replaced} out, replaced by ${name}`, source_url: article });
    }
  }

  const articles = prepared(`SELECT cancelled_json FROM events WHERE cancelled_json IS NOT NULL
    AND date BETWEEN date(?, '-60 days') AND date(?, '+60 days')`).all(card.date, card.date) as { cancelled_json: string }[];
  for (const entry of list) entry.reason ??= articleReason(articles, entry);
  return list;
}

type Stored = { slug: string; board_pk: number; date: string; event_name: string; weight_class: string;
  f1_id: string | null; f2_id: string | null; f1_name: string; f2_name: string };

/** The same two fighters' bout within a year after, fought or booked. */
export function movedTo(entry: Pick<Cancellation, "date" | "f1" | "f2">): CancelledBout["moved_to"] {
  if (!entry.f1.id || !entry.f2.id) return null;
  return (prepared(`SELECT f.id AS fight_id, e.date, e.name AS event_name FROM fights f JOIN events e ON e.id = f.event_id
    WHERE ((f.f1_id = ? AND f.f2_id = ?) OR (f.f1_id = ? AND f.f2_id = ?))
      AND e.date > date(?, '+1 day') AND e.date <= date(?, '+1 year')
    ORDER BY e.date LIMIT 1`).get(entry.f1.id, entry.f2.id, entry.f2.id, entry.f1.id, entry.date, entry.date) as CancelledBout["moved_to"] | undefined) ?? null;
}

/** The division a cancelled bout was booked at. The board's own is a guide,
 *  not a fact: it never says "Women's", is blank on some bouts and wrong on
 *  others. It's kept where it matches a corner's division at the time (the
 *  bout nearest the date), else the two corners' shared one is used, and with
 *  neither nothing is said rather than a guess. */
export function bookedDivision(listed: string, corners: (string | null | undefined)[]): string {
  if (/^catch ?weight$/i.test(listed.trim())) return "Catch Weight";
  const known = corners.filter((division): division is string => !!division && division !== "Catch Weight");
  const plain = (division: string) => division.replace(/^Women's /, "");
  const shared = known.length === 2 && known[0] === known[1] ? known[0] : "";
  const board = plain(listed.trim());
  if (board && known.some((division) => plain(division) === board)) {
    return known.some((division) => division.startsWith("Women's")) ? `Women's ${board}` : board;
  }
  return shared;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/** A fighter's cancelled bouts, newest first: theirs from every card that
 *  lists one (`cardCancellations`), and the board's own on a card cancelled
 *  outright. One they fought that week anyway is a stale duplicate, and the
 *  same booking listed twice is shown once. */
export function cancelledBoutsOf(fighterId: string, fought: Fought[]): CancelledBout[] {
  const rows = prepared(`
    SELECT cb.*, b.slug AS board_slug, b.name AS board_name FROM cancelled_bouts cb LEFT JOIN cancelled_boards b ON b.pk = cb.board_pk
    WHERE cb.f1_id = ? OR cb.f2_id = ? ORDER BY cb.date DESC, cb.slug
  `).all(fighterId, fighterId) as (Stored & { board_slug: string | null; board_name: string | null })[];
  const cards = new Map<string, Card>();
  const entries: Cancellation[] = [];
  for (const row of rows) {
    const card = row.board_slug != null ? boardCard({ date: row.date, slug: row.board_slug, name: row.board_name ?? "" }) : null;
    if (card) cards.set(card.id, card);
    else entries.push({ key: row.slug, date: row.date, event_name: row.event_name, event_id: null,
      f1: { id: row.f1_id, name: row.f1_name }, f2: { id: row.f2_id, name: row.f2_name },
      division: bookedDivision(row.weight_class, [divisionAt(row.f1_id, row.date), divisionAt(row.f2_id, row.date)]) || null,
      reason: null, source_url: `https://fightodds.io/fights/${row.slug}/odds` });
  }
  const others = prepared(`SELECT ${cardColumns} FROM events WHERE cancelled_json LIKE ?1
    UNION SELECT ${cardColumns} FROM events WHERE id IN (SELECT event_id FROM fights WHERE f1_replaced_id = ?2
      UNION SELECT event_id FROM fights WHERE f2_replaced_id = ?2
      UNION SELECT event_id FROM fights WHERE f1_id = ?2 AND f2_replaced <> ''
      UNION SELECT event_id FROM fights WHERE f2_id = ?2 AND f1_replaced <> '')`);
  for (const card of others.all(`%"${fighterId}"%`, fighterId) as Card[]) cards.set(card.id, card);
  for (const card of cards.values()) entries.push(...cardCancellations(card).filter((entry) => entry.f1.id === fighterId || entry.f2.id === fighterId));
  if (!entries.length) return [];
  const articles = prepared(`SELECT cancelled_json FROM events WHERE cancelled_json IS NOT NULL
    AND date BETWEEN date(?, '-60 days') AND date(?, '+60 days')`);
  const seen = new Set<string>();
  const list: CancelledBout[] = [];
  for (const entry of entries.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key))) {
    const opponent = entry.f1.id === fighterId ? entry.f2 : entry.f1;
    if (fought.some((bout) => dayDiff(bout.date, entry.date) <= 1 && samePerson(opponent, { id: bout.opponent.id ?? null, name: bout.opponent.name }))) continue;
    const key = `${entry.date}:${opponent.id ?? normName(opponent.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      key: entry.key,
      date: entry.date,
      event_name: entry.event_name,
      event_id: entry.event_id,
      weight_class: entry.division ?? "",
      opponent: { id: opponent.id && hasUfcFight(opponent.id) ? opponent.id : null, name: opponent.name },
      moved_to: movedTo(entry),
      reason: entry.reason ?? articleReason(articles.all(entry.date, entry.date) as { cancelled_json: string }[], entry),
      source_url: entry.source_url,
    });
  }
  return list;
}

/** The reason an event article gives for the same pairing, when it names one. */
function articleReason(articles: { cancelled_json: string }[], pair: { f1: Corner; f2: Corner }): string | null {
  for (const { cancelled_json } of articles) {
    let bouts: { f1: string; f2: string; f1_id?: string | null; f2_id?: string | null; reason?: string | null }[];
    try { bouts = JSON.parse(cancelled_json); } catch { continue; }
    for (const bout of bouts) {
      if (bout.reason && samePair(pair, { f1: { id: bout.f1_id ?? null, name: bout.f1 }, f2: { id: bout.f2_id ?? null, name: bout.f2 } })) return bout.reason;
    }
  }
  return null;
}

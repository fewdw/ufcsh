// Rebuilds roster-history-wikipedia.json from the history of Wikipedia's
// "List of current UFC fighters": one revision a week, each revision's dated
// "Recent signings" and "Recent releases" rows, linked to that revision.
//   node src/import-roster-history.ts [YYYY-MM-DD start, default 2010-11-12] [YYYY-MM-DD end] [--merge]
// REVISIONS_DIR=<dir> reads (and keeps) each week's API response as <day>.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchHtml } from "./http.ts";
import { citationDate, ROSTER_ARTICLE, ROSTER_HEADINGS, rosterMoves, type RosterMove } from "./scrape/wikipedia.ts";
import { departureKind, validRosterDate, type RosterHistoryEvent } from "./roster-history.ts";
import { normName } from "./util.ts";
import { db } from "./db.ts";
import { rosterMoveFighter } from "./roster-moves.ts";

const API = "https://en.wikipedia.org/w/api.php";
const OUT = new URL("./roster-history-wikipedia.json", import.meta.url);
/** Rows for one change edited over a few weeks are one report. */
const SAME_REPORT_DAYS = 45;
/** A report is only kept where the fighter's UFC bouts bear it out: a signing
 *  followed by a UFC bout within this long, a departure preceded by one. */
const SIGNED_BEFORE_DAYS = 550;
const LEFT_AFTER_DAYS = 800;

type Seen = { name: string; date: string; kind: "signed" | "left"; reason: string | null; revid: number };

async function revisionAt(day: string): Promise<{ revid: number; text: string } | null> {
  const url = `${API}?action=query&format=json&prop=revisions&rvprop=ids|content&rvslots=main&rvlimit=1&rvdir=older`
    + `&rvstart=${day}T00:00:00Z&titles=${encodeURIComponent(ROSTER_ARTICLE)}`;
  const cache = process.env.REVISIONS_DIR && `${process.env.REVISIONS_DIR}/${day}.json`;
  const body = cache && existsSync(cache) ? readFileSync(cache, "utf8") : await fetchHtml(url, { retries: 2 });
  if (cache) writeFileSync(cache, body);
  const page = Object.values(JSON.parse(body)?.query?.pages ?? {})[0] as
    { revisions?: { revid: number; slots: { main: { "*": string } } }[] } | undefined;
  const revision = page?.revisions?.[0];
  return revision ? { revid: revision.revid, text: revision.slots.main["*"] } : null;
}

/** Each table on its own: a revision may lack one of them. */
function tables(text: string): { signed: RosterMove[]; cut: RosterMove[] } {
  const read = (pick: "signed" | "cut") => { try { return rosterMoves(text, ROSTER_HEADINGS[pick]); } catch { return []; } };
  return { signed: read("signed"), cut: read("cut") };
}

/** "Tim Williams (fighter)| Tim Williams", "BJ Penn(retired)", "Amanda Ribas -
 *  2 years suspension …": the name, and whether the cell said retired. */
export function cleanName(cell: string): { name: string; retired: boolean } {
  const retired = /\(\s*retired\s*\)/i.test(cell);
  const name = (cell.split("|").at(-1) ?? "").split(/\s+[-–]\s+/)[0].replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return { name, retired };
}

/** The one UFC fighter a source name means, as written or in the other name
 *  order ("Yadong Song" for UFCStats' "Song Yadong"). */
function profileFor(name: string): string | null {
  const parts = name.split(" ");
  return rosterMoveFighter(name) ?? (parts.length === 2 ? rosterMoveFighter(`${parts[1]} ${parts[0]}`) : null);
}

const ufcBoutDates = db.prepare(`SELECT e.date FROM fights f JOIN events e ON e.id = f.event_id
  WHERE (f.f1_id = ?1 OR f.f2_id = ?1) AND e.complete = 1 ORDER BY e.date`);

function borneOut(fighterId: string, event: RosterHistoryEvent): boolean {
  const day = Date.parse(event.date);
  return (ufcBoutDates.all(fighterId) as { date: string }[]).some(({ date }) => {
    const gap = (Date.parse(date) - day) / 86_400_000;
    return event.kind === "signed" ? gap > 0 && gap <= SIGNED_BEFORE_DAYS : gap <= 0 && gap >= -LEFT_AFTER_DAYS;
  });
}

/** Before 2017 the releases table had no date column. A row still counts when
 *  its own reference is a dated report about this fighter leaving: the
 *  report's title names them and says released, cut or retired. */
export function undatedReleases(text: string): { name: string; date: string; reason: string }[] {
  const start = text.search(ROSTER_HEADINGS.cut);
  if (start < 0) return [];
  const rest = text.slice(start + 3);
  const section = rest.slice(0, rest.search(/\n==[^=]/));
  if (/\n!\s*(?:[^|\n]*\|)?\s*Date\s*$/im.test(section)) return [];
  const defined = new Map([...text.matchAll(/<ref\s+name\s*=\s*"?([^">/]+?)"?\s*>([\s\S]*?)<\/ref>/gi)].map((match) => [match[1].trim(), match[2]]));
  const found: { name: string; date: string; reason: string }[] = [];
  for (const row of section.split(/\n\|-/).slice(1)) {
    const cell = row.split("\n").find((line) => /^\|\s*(?:''')?\s*\[\[/.test(line));
    const name = cell?.match(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/)?.[1].replace(/\([^)]*\)/g, "").trim();
    if (!cell || !name) continue;
    const surname = normName(name).split(" ").at(-1) ?? "";
    for (const match of cell.matchAll(/<ref(?:\s+name\s*=\s*"?([^">/]+?)"?)?\s*(?:\/>|>([\s\S]*?)<\/ref>)/gi)) {
      const ref = match[2] ?? defined.get(match[1]?.trim() ?? "") ?? "";
      const field = (key: string) => ref.match(new RegExp(`\\|\\s*${key}\\s*=\\s*([^|}]*)`, "i"))?.[1].trim() ?? "";
      const title = field("title");
      const date = citationDate(field("date"));
      const retired = /\bretire/i.test(title);
      if (!/^https?:\/\//.test(field("url")) || /\b(?:asks?|requests?|plans?|considering|could|might|unless|denies|denied|not)\b/i.test(title)) continue;
      if (!date || !normName(`${title} ${field("url")}`).split(" ").includes(surname)) continue;
      if (!retired && !/\breleas|\bcuts?\b|parted ways|\blet go\b/i.test(title)) continue;
      found.push({ name, date, reason: retired ? "Retired" : "Released" });
      break;
    }
  }
  return found;
}

export function reports(seen: Seen[]): RosterHistoryEvent[] {
  const groups = new Map<string, Seen[]>();
  for (const row of seen) {
    const key = `${normName(row.name)}:${row.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const events: RosterHistoryEvent[] = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.revid - b.revid);
    let cluster: Seen[] = [];
    const flush = () => {
      if (!cluster.length) return;
      // The latest revision has the editors' corrections.
      const row = cluster.reduce((latest, next) => next.revid > latest.revid ? next : latest);
      events.push({
        name: row.name, date: row.date,
        kind: row.kind === "signed" ? "signed" : departureKind(row.reason),
        reason: row.kind === "signed" ? null : row.reason,
        source_url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(ROSTER_ARTICLE.replaceAll(" ", "_"))}&oldid=${row.revid}`,
        observed: false,
      });
      cluster = [];
    };
    for (const row of rows) {
      if (cluster.length && Date.parse(row.date) - Date.parse(cluster[0].date) > SAME_REPORT_DAYS * 86_400_000) flush();
      cluster.push(row);
    }
    flush();
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

if (import.meta.main) {
  const seen: Seen[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const start = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "2010-11-12";
  const end = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : today;
  if (!validRosterDate(start) || !validRosterDate(end) || start > end || end > today) throw new Error("Expected a valid start/end date range through today");
  let read = 0;
  for (let day = start; day <= end; day = new Date(Date.parse(day) + 7 * 86_400_000).toISOString().slice(0, 10)) {
    const revision = await revisionAt(day);
    if (!revision) continue;
    const { signed, cut } = tables(revision.text);
    for (const [kind, moves] of [["signed", signed], ["left", cut]] as const) {
      for (const move of moves) {
        // An undated row is only used through its reference (undatedReleases).
        if (move.date && validRosterDate(move.date) && move.date <= day) {
          const { name, retired } = cleanName(move.name);
          const reason = move.reason?.replace(/^\|\s*/, "") || (retired ? "Retired" : null);
          if (name) seen.push({ name, date: move.date, kind, reason, revid: revision.revid });
        }
      }
    }
    for (const release of undatedReleases(revision.text)) {
      if (release.date <= day) seen.push({ ...release, kind: "left", revid: revision.revid });
    }
    if (++read % 50 === 0) console.log(`${day}: ${read} revisions, ${seen.length} rows`);
  }
  // Stored under the profile's own name, so it resolves the same way at runtime.
  const names = new Map<string, string | null>();
  const nameOf = db.prepare("SELECT name FROM fighters WHERE id = ?");
  const events = reports(seen).flatMap((event) => {
    if (!names.has(event.name)) names.set(event.name, profileFor(event.name));
    const id = names.get(event.name);
    if (!id || !borneOut(id, event)) return [];
    return [{ ...event, name: (nameOf.get(id) as { name: string }).name }];
  });
  const unmatched = [...names.values()].filter((id) => !id).length;
  // [name, date, kind, reason, revision], one report a line (roster-history.ts reads it).
  type Row = [string, string, RosterHistoryEvent["kind"], string | null, number];
  const rows: Row[] = process.argv.includes("--merge") ? JSON.parse(readFileSync(OUT, "utf8")) : [];
  let added = 0;
  for (const event of events) {
    if (rows.some(row => normName(row[0]) === normName(event.name) && (row[2] === "signed") === (event.kind === "signed")
      && Math.abs(Date.parse(row[1]) - Date.parse(event.date)) <= SAME_REPORT_DAYS * 86_400_000)) continue;
    rows.push([event.name, event.date, event.kind, event.reason, Number(event.source_url.split("oldid=")[1])]);
    added++;
  }
  rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  writeFileSync(OUT, `[\n${rows.map(row => JSON.stringify(row)).join(",\n")}\n]\n`);
  console.log(`${events.length} reports from ${read} revisions; ${unmatched} of ${names.size} names matched no single UFC fighter`);
  console.log(`${added} added, ${rows.length} retained`);
}

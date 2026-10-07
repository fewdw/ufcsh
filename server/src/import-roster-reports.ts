// Retain explicitly dated UFC contract reports cited by fighter biographies.
// Usage: node src/import-roster-reports.ts <cached-biographies-directory>
// Each cached JSON is { name, revision, text }, from Wikipedia's revisions API.
// Missing articles are skipped; only evidence that resolves a real timeline gap
// and matches one UFC profile is exported. No archive data is exported.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "./db.ts";
import { fightIndex, professionalBouts } from "./fight-index.ts";
import { rosterEventsByFighter, rosterMoveFighter } from "./roster-moves.ts";
import { careerBands, type TimelineBout } from "./roster-timeline.ts";
import { citedRosterReports, datedRosterStatements } from "./scrape/roster-reports.ts";
import { SEARCH_ALIASES } from "./search-aliases.ts";
import type { RosterHistoryEvent } from "./roster-history.ts";

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: node src/import-roster-reports.ts <cached-biographies-directory>");
  const output = new URL("./roster-history-reports.json", import.meta.url);
  const retained = JSON.parse(readFileSync(output, "utf8")) as [string, string, RosterHistoryEvent["kind"], string | null, number][];
  const index = fightIndex();
  const byFighter = rosterEventsByFighter();
  let read = 0, added = 0;
  for (const file of readdirSync(directory).filter(file => file.endsWith(".json"))) {
    const article = JSON.parse(readFileSync(path.join(directory, file), "utf8")) as { name: string; revision?: number; text?: string };
    if (!article.text || !Number.isSafeInteger(article.revision) || !article.name) continue;
    const id = rosterMoveFighter(article.name);
    if (!id || !index.fighters.has(id)) continue;
    const fighter = index.fighters.get(id)!;
    const source = db.prepare("SELECT source_name FROM career_profiles WHERE fighter_id = ? AND status = 'verified'").get(id) as { source_name: string } | undefined;
    const names = [fighter.name, ...(source?.source_name ? [source.source_name] : []), ...(SEARCH_ALIASES[fighter.name] ?? [])];
    const bouts = professionalBouts(index, id).reverse();
    const rows: TimelineBout[] = bouts.map(bout => ({
      date: bout.date, event_name: bout.eventName, promotion: bout.isUfc ? "ufc" : "outside",
      fight_id: bout.ufcFightId, title_type: bout.ufcFightId ? index.byId.get(bout.ufcFightId)?.titleType ?? null : null,
      upcoming: false, outcome: bout.outcome,
    }));
    const reports = [...(byFighter.get(id) ?? [])];
    const unknown = (events: RosterHistoryEvent[]) => careerBands(rows, events).flat().filter(band => band.unknown?.length).length;
    const found = [...datedRosterStatements(article.text, names), ...citedRosterReports(article.text, names)];
    for (const report of found.sort((a, b) => a.date.localeCompare(b.date))) {
      const signing = report.kind === "signed";
      if (reports.some(other => (other.kind === "signed") === signing && !other.observed
        && Math.abs(Date.parse(other.date) - Date.parse(report.date)) <= 45 * 86_400_000)) continue;
      const supported = bouts.some(bout => {
        const days = (Date.parse(bout.date) - Date.parse(report.date)) / 86_400_000;
        return bout.isUfc && (signing ? days >= 0 && days <= 550 : days <= 0 && days >= -800);
      });
      if (!supported) continue;
      // Calling a retired regional fighter a UFC veteran does not date their
      // UFC departure. Their last professional bout must still have been UFC.
      if (report.kind === "retired" && !bouts.find(bout => bout.date <= report.date)?.isUfc) continue;
      const event: RosterHistoryEvent = { ...report, name: fighter.name, observed: false,
        source_url: `https://en.wikipedia.org/w/index.php?oldid=${article.revision}` };
      if (unknown([...reports, event]) >= unknown(reports)) continue;
      retained.push([fighter.name, event.date, event.kind, event.reason, article.revision!]);
      reports.push(event);
      added++;
    }
    read++;
  }
  retained.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  writeFileSync(output, `[\n${retained.map(row => JSON.stringify(row)).join(",\n")}\n]\n`);
  console.log(JSON.stringify({ biographies: read, added, retained: retained.length }));
}

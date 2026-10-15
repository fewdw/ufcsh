// Import reviewed season revisions, preserving the original contract report.
// Usage: DATA_DIR=<private archive> node src/import-contender-contracts.ts CACHE
// CACHE contains season-N.json files: { name, revision, text }. Read the cited
// reports before retaining a season; development deals and later call-ups must
// not be dated to an earlier appearance. Neither a win nor a bout is evidence
// of an award by itself.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fightIndex, professionalBouts } from "./fight-index.ts";
import { rosterEventsByFighter, rosterMoveFighter } from "./roster-moves.ts";
import { careerBands, fightProgram, type TimelineBout } from "./roster-timeline.ts";
import { contenderContracts } from "./scrape/contender-contracts.ts";
import type { RosterHistoryEvent } from "./roster-history.ts";

type Retained = [name: string, date: string, source: string, revision: number];
export const CONTRACT_REASON = "Awarded UFC contract on Dana White's Contender Series";

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: node src/import-contender-contracts.ts <reviewed-seasons-directory>");
  const output = new URL("./roster-history-contracts.json", import.meta.url);
  const retained = JSON.parse(readFileSync(output, "utf8")) as Retained[];
  const index = fightIndex(), byFighter = rosterEventsByFighter();
  const keys = new Set(retained.map(([name, date]) => `${name}:${date}`));
  let added = 0, unmatched = 0, unsupported = 0;
  for (const file of readdirSync(directory).filter(file => /^season-\d+\.json$/.test(file))) {
    const article = JSON.parse(readFileSync(path.join(directory, file), "utf8")) as { name: string; revision: number; text: string };
    const season = article.name?.match(/^Dana White's Contender Series season (\d+)$/)?.[1];
    if (!season || !Number.isSafeInteger(article.revision) || article.revision <= 0 || typeof article.text !== "string") continue;
    for (const report of contenderContracts(article.text)) {
      if (Number(report.date.slice(0, 4)) !== 2016 + Number(season) || report.date > new Date().toISOString().slice(0, 10)) continue;
      const id = rosterMoveFighter(report.name), fighter = id && index.fighters.get(id);
      if (!id || !fighter) { unmatched++; continue; }
      if (keys.has(`${fighter.name}:${report.date}`)) continue;
      const bouts = professionalBouts(index, id).reverse();
      if (!bouts.some(bout => bout.date === report.date && fightProgram(bout.eventName) === "Contender Series")
        || !bouts.some(bout => bout.isUfc && bout.date > report.date)) { unsupported++; continue; }
      const reports = byFighter.get(id) ?? [];
      if (reports.some(other => other.kind === "signed" && !other.observed
        && Math.abs(Date.parse(other.date) - Date.parse(report.date)) <= 45 * 86_400_000)) continue;
      const rows: TimelineBout[] = bouts.map(bout => ({ date: bout.date, event_name: bout.eventName,
        promotion: bout.isUfc ? "ufc" : "outside", fight_id: bout.ufcFightId,
        title_type: bout.ufcFightId ? index.byId.get(bout.ufcFightId)?.titleType ?? null : null,
        upcoming: false, outcome: bout.outcome }));
      const event: RosterHistoryEvent = { ...report, name: fighter.name, kind: "signed", observed: false, reason: CONTRACT_REASON };
      const unknown = (events: RosterHistoryEvent[]) => careerBands(rows, events).flat().filter(band => band.unknown?.length).length;
      if (unknown([...reports, event]) >= unknown(reports)) continue;
      retained.push([fighter.name, report.date, report.source_url, article.revision]);
      keys.add(`${fighter.name}:${report.date}`);
      byFighter.set(id, [...reports, event]);
      added++;
    }
  }
  retained.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  writeFileSync(output, `[\n${retained.map(row => JSON.stringify(row)).join(",\n")}\n]\n`);
  console.log(JSON.stringify({ added, unmatched, unsupported, retained: retained.length }));
}

import { alignment } from "./verdict-import.ts";
import { fetchMmaDecisions, parseMmaDecision, parseMmaEventDecisions, parseMmaEvents, type MmaDecision } from "./scrape/mmadecisions.ts";
import { normName } from "./util.ts";

/** A decision to find on MMA Decisions: its date and both fighters' names. */
export type CrawlFight = { id: string; date: string; f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null };
export type CrawlStats = { years: number; events: number; decisions: number; matched: number; failed: number };

/** Read MMA Decisions' yearly archives, the events near each wanted date and
 *  the decision pages naming one of its fighters, and hand over each page that
 *  matches exactly one wanted bout by date and both fighters' names. `order`
 *  is -1 when the page lists the fighters the other way round. */
export async function crawlMmaDecisions<F extends CrawlFight>(fights: F[], options: { concurrency: number; eventFilter?: string; fetchPage?: typeof fetchMmaDecisions; onChecked?: (fight: F) => void },
  onMatch: (fight: F, order: 1 | -1, page: MmaDecision, path: string) => void | Promise<void>,
  onProgress?: (stats: CrawlStats, pages: number) => void): Promise<CrawlStats> {
  const stats: CrawlStats = { years: 0, events: 0, decisions: 0, matched: 0, failed: 0 };
  const read = options.fetchPage ?? fetchMmaDecisions;
  const failedYears = new Set<number>();
  const failedDates = new Set<string>();
  const byDate = new Map<string, F[]>();
  for (const fight of fights) byDate.set(fight.date, [...(byDate.get(fight.date) ?? []), fight]);
  // MMA Decisions files some international cards under the following UTC day.
  // Keep the window narrow; both fighter names still have to match.
  const nearbyFights = (date: string): F[] => {
    const day = new Date(`${date}T12:00:00Z`);
    return [-1, 0, 1].flatMap(offset => {
      const shifted = new Date(day);
      shifted.setUTCDate(day.getUTCDate() + offset);
      return byDate.get(shifted.toISOString().slice(0, 10)) ?? [];
    });
  };
  const pool = async <T>(items: T[], run: (item: T) => Promise<void>): Promise<void> => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }));
  };

  const nearbyDates = (date: string) => [-1, 0, 1].map(offset =>
    new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10));
  // Only boundary dates need another year's archive.
  const yearsFor = (date: string) => nearbyDates(date).map(day => Number(day.slice(0, 4)))
    .filter(year => year <= new Date().getUTCFullYear());
  const wantedYears = new Set([...byDate.keys()].flatMap(yearsFor));
  const events: { date: string; path: string }[] = [];
  await pool([...wantedYears].filter(year => year <= new Date().getUTCFullYear()), async year => {
    try {
      const found = parseMmaEvents(await read(`decisions-by-event/${year}/`));
      events.push(...found.filter(event => nearbyFights(event.date).length && event.path.includes(options.eventFilter ?? "")));
      stats.years++;
    } catch (error) { failedYears.add(year); stats.failed++; console.error(`MMA Decisions year ${year}: ${String(error)}`); }
  });

  const seen = new Set<string>();
  const paths: { date: string; path: string }[] = [];
  const relevantPath = (date: string, path: string): boolean => {
    const slug = normName(decodeURIComponent(path.split("/").at(-1) ?? ""));
    const words = new Set(slug.split(" ").filter(word => word.length >= 4));
    return nearbyFights(date).some(fight => [fight.f1_name, fight.f2_name, fight.f1_alias, fight.f2_alias]
      .some(name => name && normName(name).split(" ").some(word => words.has(word))));
  };
  await pool(events, async event => {
    try {
      for (const path of parseMmaEventDecisions(await read(event.path))) {
        if (seen.has(path) || !relevantPath(event.date, path)) continue;
        seen.add(path);
        paths.push({ date: event.date, path });
      }
      stats.events++;
    } catch (error) { failedDates.add(event.date); stats.failed++; console.error(`MMA Decisions ${event.path}: ${String(error)}`); }
  });
  onProgress?.(stats, paths.length);

  await pool(paths, async ({ date, path }) => {
    try {
      const page = parseMmaDecision(await read(path));
      stats.decisions++;
      if (!page) throw new Error("Unreadable decision page");
      const matches = nearbyFights(date).flatMap(fight => {
        const found = alignment(page.f1Name, page.f2Name,
          [fight.f1_name, ...(fight.f1_alias ? [fight.f1_alias] : [])],
          [fight.f2_name, ...(fight.f2_alias ? [fight.f2_alias] : [])]);
        return found?.tier === 1 ? [{ fight, order: found.order }] : [];
      });
      if (matches.length !== 1) return;
      stats.matched++;
      await onMatch(matches[0].fight, matches[0].order, page, path);
    } catch (error) { failedDates.add(date); stats.failed++; if (stats.failed <= 20) console.error(`MMA Decisions ${path}: ${String(error)}`); }
    finally { if (stats.decisions > 0 && stats.decisions % 100 === 0) onProgress?.(stats, paths.length); }
  });
  // A failed archive, event or decision read is not evidence of absence.
  // Leave affected bouts eligible for retry, including neighboring UTC dates.
  for (const fight of fights) {
    if (!yearsFor(fight.date).some(year => failedYears.has(year))
      && !nearbyDates(fight.date).some(date => failedDates.has(date))) options.onChecked?.(fight);
  }
  return stats;
}

import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { cardChanges, eventInfobox, eventSection, infoboxDate, namesCard, samePlace } from "./scrape/wikipedia.ts";
import { preChangeBackupPath } from "./backup-retention.ts";
import { invalidReplacement } from "./replacement-announcements.ts";

/** Replay retained public article revisions against a baseline, updating only
 * replacement identities and missing announcements. Never imports db.ts,
 * runs migrations, or starts a scheduler. Audit is the default. */
export type EventArticle = { eventId: string; name: string; revision: number; text: string };
type Event = { id: string; date: string; wiki_title: string; location: string };
type Fight = {
  id: string; event_id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string;
  method: string | null; round: string | null;
  f1_replaced: string | null; f2_replaced: string | null;
  f1_notice: string | null; f2_notice: string | null;
  f1_short_notice: number | null; f2_short_notice: number | null;
};
const identity = ["event_id", "f1_id", "f2_id", "f1_name", "f2_name", "method", "round"] as const;

export function repairEventChanges(baseline: DatabaseSync, target: DatabaseSync, articles: EventArticle[], apply = false) {
  const result = { articles: 0, fights: 0, names: 0, notices: 0, conflicts: 0, rejected: 0 };
  const plans: { fight: Fight; fields: [string, string | null][]; names: number; notices: number }[] = [];
  const unchanged = (fight: Fight, current: Fight | undefined) => current && identity.every(key => current[key] === fight[key])
    && ["f1", "f2"].every(side => ["replaced", "notice", "short_notice"].every(field => {
      const key = `${side}_${field}` as keyof Fight;
      return current[key] === fight[key];
    }));
  let transaction = false;
  try {
    for (const article of articles) {
      const event = baseline.prepare("SELECT id, date, wiki_title, location FROM events WHERE id = ?").get(article.eventId) as Event | undefined;
      const currentEvent = target.prepare("SELECT id, date, wiki_title, location FROM events WHERE id = ?").get(article.eventId) as Event | undefined;
      if (!event || !currentEvent || event.date !== currentEvent.date || event.wiki_title !== currentEvent.wiki_title || event.location !== currentEvent.location
        || article.name !== event.wiki_title || !Number.isSafeInteger(article.revision) || article.revision <= 0) {
        result.rejected++; continue;
      }
      const fights = baseline.prepare("SELECT * FROM fights WHERE event_id = ?").all(event.id) as Fight[];
      const text = eventSection(article.text, event.date);
      if (!text || infoboxDate(text) !== event.date || !samePlace(eventInfobox(text).city, event.location)
        || !namesCard(text, fights.flatMap(fight => [fight.f1_name, fight.f2_name]))) {
        result.rejected++; continue;
      }
      result.articles++;
      const { changes } = cardChanges(text, fights.map(fight => [fight.f1_name, fight.f2_name]));
      for (const fight of fights) {
        const fields: [string, string | null][] = [];
        let names = 0, notices = 0;
        for (const side of ["f1", "f2"] as const) {
          const change = changes.find(change => change.name === fight[`${side}_name`]);
          if (invalidReplacement(fight[`${side}_name`], fight[`${side}_replaced`], event.date) && !change?.replaced) {
            fields.push([`${side}_replaced`, null], [`${side}_replaced_id`, null], [`${side}_notice`, null], [`${side}_short_notice`, null]);
            names++;
            continue;
          }
          if (!change?.replaced?.includes(" ")) continue;
          if (change.replaced !== fight[`${side}_replaced`]) {
            fields.push([`${side}_replaced`, change.replaced], [`${side}_replaced_id`, null]);
            names++;
          }
          if (fight[`${side}_notice`] == null && change.notice) {
            fields.push([`${side}_notice`, change.notice]); notices++;
          }
        }
        if (!fields.length) continue;
        const current = target.prepare("SELECT * FROM fights WHERE id = ?").get(fight.id) as Fight | undefined;
        if (current && identity.every(key => current[key] === fight[key])
          && fields.every(([key, value]) => (current as unknown as Record<string, unknown>)[key] === value)) continue;
        if (!unchanged(fight, current)) {
          result.conflicts++; continue;
        }
        plans.push({ fight, fields, names, notices });
        result.fights++; result.names += names; result.notices += notices;
      }
    }
    if (apply) {
      // Source parsing stays outside the write lock. Recheck the live fields
      // after acquiring it so the short transaction cannot clobber a sync.
      target.exec("BEGIN IMMEDIATE"); transaction = true;
      for (const { fight, fields, names, notices } of plans) {
        const current = target.prepare("SELECT * FROM fights WHERE id = ?").get(fight.id) as Fight | undefined;
        const currentEvent = target.prepare("SELECT date, wiki_title, location FROM events WHERE id = ?").get(fight.event_id) as Event | undefined;
        const event = baseline.prepare("SELECT date, wiki_title, location FROM events WHERE id = ?").get(fight.event_id) as Event;
        if (!unchanged(fight, current) || !currentEvent || ["date", "wiki_title", "location"].some(key => currentEvent[key as keyof Event] !== event[key as keyof Event])) {
          result.fights--; result.names -= names; result.notices -= notices; result.conflicts++; continue;
        }
        target.prepare(`UPDATE fights SET ${fields.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`)
          .run(...fields.map(([, value]) => value), fight.id);
      }
      target.exec("COMMIT"); transaction = false;
      if ((target.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check !== "ok") throw new Error("Post-repair integrity check failed");
    }
    return result;
  } catch (error) {
    if (transaction) target.exec("ROLLBACK");
    throw error;
  }
}

if (import.meta.main) {
  const [baselineFile, targetFile, directory, option] = process.argv.slice(2);
  if (!baselineFile || !targetFile || !directory || (option && option !== "--apply")
    || realpathSync(baselineFile) === realpathSync(targetFile))
    throw new Error("Usage: node src/repair-event-changes.ts BASELINE.db TARGET.db ARTICLE_CACHE [--apply]");
  const articles = readdirSync(directory).filter(file => /^[a-f0-9]{16}\.json$/.test(file)).map(file => ({
    ...JSON.parse(readFileSync(path.join(directory, file), "utf8")), eventId: file.slice(0, -5),
  })) as EventArticle[];
  const apply = option === "--apply";
  const baseline = new DatabaseSync(baselineFile, { readOnly: true });
  const target = new DatabaseSync(targetFile, { readOnly: !apply });
  try {
    if (apply) {
      const destination = await preChangeBackupPath(targetFile, "event-changes");
      await backup(target, destination);
      const copy = new DatabaseSync(destination, { readOnly: true });
      try {
        if ((copy.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check !== "ok") throw new Error("Repair backup failed its integrity check");
      } finally { copy.close(); }
      console.log("Verified backup before event repair");
    }
    console.log(JSON.stringify({ applied: apply, ...repairEventChanges(baseline, target, articles, apply) }));
  } finally { baseline.close(); target.close(); }
}

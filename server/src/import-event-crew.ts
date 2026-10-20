import { db } from "./db.ts";
import { eventBroadcast, importBroadcast, type CrewEvent } from "./event-crew.ts";

/** DATA_DIR=<private copy> npm run import:event-crew -- --event-id=<id> --url=<report>
 * Imports one card's explicit broadcast sections from an MMA Junkie report or its
 * Yahoo/AOL syndication, for a card whose report has left the feed. */
const options = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=", 2) as [string, string]));
const event = db.prepare("SELECT id, name, date FROM events WHERE id = ?").get(options.get("event-id") ?? "") as CrewEvent | undefined;
if (!event || !options.get("url")) throw new Error("Use --event-id=<id> --url=<broadcast report>");
await importBroadcast(event, options.get("url")!);
console.log(event.name, eventBroadcast(event)?.roles);

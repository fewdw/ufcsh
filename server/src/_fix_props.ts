import { db } from "./db.ts";
import { syncMethodOddsForEvent } from "./sync.ts";
const missing = () => (db.prepare(`SELECT COUNT(*) c FROM fights f JOIN events e ON e.id=f.event_id LEFT JOIN method_odds m ON m.fight_id=f.id WHERE e.complete=1 AND e.date>='2021-01-01' AND m.fight_id IS NULL`).get() as any).c;
const noLine = () => (db.prepare(`SELECT COUNT(*) c FROM fights f JOIN events e ON e.id=f.event_id LEFT JOIN odds o ON o.fight_id=f.id WHERE e.complete=1 AND e.date>='2008-01-01' AND o.f1_close IS NULL`).get() as any).c;
const events = db.prepare(`SELECT DISTINCT e.id, e.name, e.date FROM fights f JOIN events e ON e.id=f.event_id LEFT JOIN method_odds m ON m.fight_id=f.id WHERE e.complete=1 AND e.date>='2021-01-01' AND m.fight_id IS NULL ORDER BY e.date DESC`).all() as any[];
console.log("start: props missing", missing(), "moneylines missing", noLine(), "events", events.length);
for (const e of events) {
  try {
    const r = await syncMethodOddsForEvent(e.id);
    console.log(e.date, e.name, JSON.stringify(r));
  } catch (err) { console.log(e.date, e.name, "ERR", String(err)); }
}
console.log("end: props missing", missing(), "moneylines missing", noLine());
process.exit(0);

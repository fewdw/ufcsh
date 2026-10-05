import { getMeta, setMeta } from "./db.ts";
import { normName } from "./util.ts";

export type RosterHistoryEvent = {
  name: string;
  date: string;
  kind: "signed" | "released" | "retired" | "departed";
  reason: string | null;
  source_url: string;
  /** ufc.com dates are when a change was observed, not contract dates. */
  observed: boolean;
};

/** Historical reports reviewed individually; never infer a release from a
 * non-UFC bout, a loss, inactivity, or an already-inactive athlete page. */
const VERIFIED: RosterHistoryEvent[] = [{
  name: "Yoel Romero", date: "2020-12-04", kind: "released", reason: "Released with three fights remaining on his contract",
  source_url: "https://www.mmafighting.com/2020/12/4/22155464/four-time-ufc-title-challenger-yoel-romero-released",
  observed: false,
}];

export function validRosterDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date;
}

export function departureKind(reason: string | null): RosterHistoryEvent["kind"] {
  if (/\bretired\b|\bretirement\b/i.test(reason ?? "")) return "retired";
  if (/^released\b|^cut\b/i.test(reason ?? "")) return "released";
  return "departed";
}

export function storedRosterHistory(): RosterHistoryEvent[] {
  return [...VERIFIED, ...JSON.parse(getMeta("roster_history") ?? "[]") as RosterHistoryEvent[]];
}

/** Keep dated reports after the rolling recent-roster lists drop them. Names
 * remain source names so a signee's replacement UFCStats id can take over. */
export function archiveRosterEvents(events: RosterHistoryEvent[]): void {
  const saved = JSON.parse(getMeta("roster_history") ?? "[]") as RosterHistoryEvent[];
  const key = (event: RosterHistoryEvent) => `${normName(event.name)}:${event.date}:${event.kind === "signed" ? "signed" : "left"}:${event.observed}`;
  const merged = new Map(saved.map(event => [key(event), event]));
  for (const event of events) {
    if (event.name && validRosterDate(event.date)) {
      const previous = merged.get(key(event));
      merged.set(key(event), { ...event,
        source_url: event.source_url.endsWith("/athletes/all") && previous?.source_url ? previous.source_url : event.source_url,
        reason: event.reason ?? previous?.reason ?? null,
      });
    }
  }
  const next = JSON.stringify([...merged.values()]);
  if (next !== JSON.stringify(saved)) {
    setMeta("roster_history", next);
    setMeta("roster_history_revision", String(Date.now()));
  }
}

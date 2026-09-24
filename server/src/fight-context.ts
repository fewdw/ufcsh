import { prepared } from "./db.ts";
import { fightIsComplete } from "./live-state.ts";
import { milestonesWithinReach } from "./records.ts";
import { officialIdentity } from "./officials.ts";
import { venueOfEvent } from "./venues.ts";
import { normName } from "./util.ts";

/**
 * What surrounds a matchup rather than what the two fighters bring to it: the
 * room, the broadcast, the officials, what has been reported about the bout,
 * and the records a result would move. Everything carries its source, and
 * anything not yet confirmed is left out rather than guessed.
 */

type ContextRow = {
  id: string; event_id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string; weight_class: string;
  f1_outcome: string | null; f2_outcome: string | null; method: string | null; detail_json: string | null;
  referee_assigned: string | null; segment: string | null;
  event_name: string; event_date: string; main_card_at: number | null; prelims_at: number | null; early_prelims_at: number | null;
  broadcast_json: string | null; attendance: number | null; gate: string | null; wiki_title: string | null; wiki_background: string | null;
  venue_tz: string | null;
};

function parse<T>(text: string | null): T | null {
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** Sentences of the event article that name either fighter, in the order
 * written. A sentence naming someone else on the card is not about this bout. */
export function developmentsFor(background: string, names: [string, string], card: string[]): string[] {
  const sentences = background.replace(/\n+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z“"])/).map((sentence) => sentence.trim()).filter(Boolean);
  const tokens = (name: string) => {
    const parts = normName(name).split(" ").filter(Boolean);
    return { full: parts.join(" "), last: parts.length > 1 ? parts.at(-1)! : null };
  };
  const ours = names.map(tokens);
  const lastNames = card.map((name) => tokens(name).last).filter(Boolean);
  const mentions = (text: string, person: ReturnType<typeof tokens>) => {
    const plain = ` ${normName(text)} `;
    if (plain.includes(` ${person.full} `)) return true;
    // A surname alone only counts when no one else on the card shares it.
    return Boolean(person.last && person.last.length > 2 && lastNames.filter((last) => last === person.last).length <= 1 && plain.includes(` ${person.last} `));
  };
  return sentences.filter((sentence) => ours.some((person) => mentions(sentence, person))).slice(0, 8)
    .map((sentence) => sentence.length > 420 ? `${sentence.slice(0, 417)}…` : sentence);
}

export function fightContext(id: string): unknown | null {
  const row = prepared(`
    SELECT f.id, f.event_id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, f.weight_class, f.f1_outcome, f.f2_outcome, f.method,
      f.detail_json, f.referee_assigned, f.segment,
      e.name AS event_name, e.date AS event_date, e.main_card_at, e.prelims_at, e.early_prelims_at,
      e.broadcast_json, e.attendance, e.gate, e.wiki_title, e.wiki_background, e.venue_tz
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
  `).get(id) as ContextRow | undefined;
  if (!row) return null;
  const complete = fightIsComplete(row);
  const detail = parse<any>(row.detail_json);
  const refereeName: string | null = detail?.methodInfo?.Referee || row.referee_assigned || null;
  const judges: string[] = complete && Array.isArray(detail?.judges) ? detail.judges.map((card: any) => String(card?.judge ?? "")).filter(Boolean) : [];
  const card = (prepared("SELECT f1_name, f2_name FROM fights WHERE event_id = ?").all(row.event_id) as { f1_name: string; f2_name: string }[])
    .flatMap((fight) => [fight.f1_name, fight.f2_name]);
  const broadcasters = parse<Record<string, string>>(row.broadcast_json);
  const developments = row.wiki_background ? developmentsFor(row.wiki_background, [row.f1_name, row.f2_name], card) : [];
  const milestones = complete ? [] : (["f1", "f2"] as const).flatMap((side) => {
    const fighterId = side === "f1" ? row.f1_id : row.f2_id;
    return fighterId ? milestonesWithinReach(fighterId, row.weight_class || null).map((entry) => ({ ...entry, side })) : [];
  });
  return {
    fight_id: row.id,
    complete,
    event: {
      id: row.event_id,
      name: row.event_name,
      date: row.event_date,
      starts_at: row.main_card_at ?? row.prelims_at ?? row.early_prelims_at ?? null,
      segment: row.segment,
      segment_starts_at: row.segment === "main" ? row.main_card_at : row.segment === "prelims" ? row.prelims_at : row.segment === "early" ? row.early_prelims_at : null,
      time_zone: row.venue_tz,
      broadcaster: broadcasters && row.segment ? broadcasters[row.segment] ?? null : null,
      broadcasters,
      attendance: row.attendance,
      gate: row.gate,
    },
    venue: venueOfEvent(row.event_id),
    officials: {
      referee: refereeName ? { name: officialIdentity("referee", refereeName)?.name ?? refereeName, slug: officialIdentity("referee", refereeName)?.slug ?? null, assigned: !detail?.methodInfo?.Referee } : null,
      judges: judges.map((name) => ({ name: officialIdentity("judge", name)?.name ?? name, slug: officialIdentity("judge", name)?.slug ?? null })),
    },
    developments: developments.length && row.wiki_title
      ? { source: "Wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(row.wiki_title.replace(/ /g, "_"))}`, items: developments }
      : null,
    milestones,
  };
}

import { postJson } from "../http.ts";
import { consistentMoneyline } from "../method-odds.ts";
import { normName } from "../util.ts";
import type { MethodOddsPrice, MethodOddsQuote, MethodOddsSide, ScrapedMethodOdds } from "./odds.ts";

/** FightOdds.io: the app's own GraphQL API. It reads two dozen sportsbooks
 *  every few minutes and files each fighter under their UFCStats page, so an
 *  upcoming bout is matched by identity, not by name. */
const API = "https://api.fightodds.io/gql";
const SITE = "https://fightodds.io";

export type FightOddsEvent = { pk: number; date: string; slug: string };
export type FightOddsCorner = { id: string | null; name: string; last: string };
/** One book's two-way price: now, and when it first posted. */
export type FightOddsQuote = { now: [number, number]; open: [number | null, number | null] };
export type FightOddsBout = { slug: string; url: string; propCount: number; f1: FightOddsCorner; f2: FightOddsCorner; quotes: FightOddsQuote[] };

async function query<T>(text: string, variables: Record<string, unknown>, timeoutMs = 25_000): Promise<T> {
  const body = await postJson(API, { query: text, variables }, { timeoutMs }) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) throw new Error(`fightodds: ${body.errors?.[0]?.message ?? "no data"}`);
  return body.data;
}

/** UFC events dated on or after `from`. */
export async function fightOddsEvents(from: string): Promise<FightOddsEvent[]> {
  const data = await query<{ promotion: { events: { edges: { node: FightOddsEvent }[] } } | null }>(
    `query($from: Date) { promotion: promotionBySlug(slug: "ufc") {
      events(date_Gte: $from, first: 40, orderBy: "date") { edges { node { pk date slug } } } } }`,
    { from },
  );
  return data.promotion?.events.edges.map((edge) => edge.node) ?? [];
}

type RawFighter = { id: string; firstName: string; lastName: string; fightmetricUrl: string | null };
type RawOutcome = { odds: number | null; oddsOpen: number | null; fighter: { id: string } | null } | null;
type RawBout = {
  slug: string;
  isCancelled: boolean;
  propCount?: number | null;
  fighter1: RawFighter;
  fighter2: RawFighter;
  straightOffers: { edges: { node: { outcome1: RawOutcome; outcome2: RawOutcome } }[] };
};

/** Every bout on an event's odds board with each book's moneyline. */
export async function fightOddsBoard(pk: number): Promise<FightOddsBout[]> {
  const data = await query<{ board: { fightOffers: { edges: { node: RawBout }[] } } | null }>(
    `query($pk: Int!) { board: eventOfferTable(pk: $pk) { fightOffers { edges { node {
      slug isCancelled propCount
      fighter1 { id firstName lastName fightmetricUrl }
      fighter2 { id firstName lastName fightmetricUrl }
      straightOffers { edges { node {
        outcome1 { odds oddsOpen fighter { id } }
        outcome2 { odds oddsOpen fighter { id } } } } } } } } } }`,
    { pk },
  );
  return (data.board?.fightOffers.edges ?? []).map((edge) => edge.node)
    .filter((bout) => !bout.isCancelled)
    .map(parseBout);
}

export function parseBout(bout: RawBout): FightOddsBout {
  const corner = (fighter: RawFighter): FightOddsCorner => ({
    id: fighter.fightmetricUrl?.match(/fighter-details\/([0-9a-f]{16})/)?.[1] ?? null,
    name: `${fighter.firstName} ${fighter.lastName}`.trim(),
    last: fighter.lastName,
  });
  const quotes: FightOddsQuote[] = [];
  for (const { node } of bout.straightOffers.edges) {
    let [a, b] = [node.outcome1, node.outcome2];
    if (!a || !b) continue;
    // A book's outcomes are read against the fighter each one names.
    if (a.fighter?.id === bout.fighter2.id && b.fighter?.id === bout.fighter1.id) [a, b] = [b, a];
    else if ((a.fighter && a.fighter.id !== bout.fighter1.id) || (b.fighter && b.fighter.id !== bout.fighter2.id)) continue;
    if (a.odds == null || b.odds == null) continue;
    quotes.push({ now: [a.odds, b.odds], open: [a.oddsOpen, b.oddsOpen] });
  }
  return {
    slug: bout.slug, url: `${SITE}/fights/${bout.slug}/odds`, propCount: bout.propCount ?? 0,
    f1: corner(bout.fighter1), f2: corner(bout.fighter2), quotes,
  };
}

const probability = (line: number) => (line < 0 ? -line / (100 - line) : 100 / (100 + line));
const text = (line: number) => (line > 0 ? `+${line}` : String(line));

function american(p: number): string {
  if (p >= 0.5) {
    const line = Math.round((p / (1 - p)) * 100);
    return line === 100 ? "+100" : `-${line}`;
  }
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The market's line: each corner's median price across the books whose two
 *  sides describe one market. A median shrugs off the stray book (a thin
 *  prediction market, a stale quote) that would drag a mean or a range. */
export function consensusLine(pairs: [number | null, number | null][]): [string, string] | null {
  const usable = pairs.filter((pair): pair is [number, number] =>
    pair[0] != null && pair[1] != null && consistentMoneyline(text(pair[0]), text(pair[1])));
  if (!usable.length) return null;
  const line: [string, string] = [
    american(median(usable.map(([a]) => probability(a)))),
    american(median(usable.map(([, b]) => probability(b)))),
  ];
  return consistentMoneyline(...line) ? line : null;
}

/** The current line and the opening line. Books that don't keep an opener
 *  leave it to the others; with none, the bout opens at today's line. */
export function boutLines(bout: FightOddsBout): { open: [string, string]; close: [string, string] } | null {
  const close = consensusLine(bout.quotes.map((quote) => quote.now));
  if (!close) return null;
  return { open: consensusLine(bout.quotes.map((quote) => quote.open)) ?? close, close };
}

type OurFight = { id: string; f1_id: string | null; f2_id: string | null; names1: string[]; names2: string[] };

/** A board corner is our fighter when the UFCStats ids agree. A debutant the
 *  board hasn't linked yet must carry our fighter's full name or surname. */
function sameFighter(corner: FightOddsCorner, id: string | null, names: string[]): "id" | "name" | null {
  if (corner.id) return corner.id === id ? "id" : null;
  const full = normName(corner.name);
  const last = normName(corner.last);
  return names.some((name) => normName(name) === full || (last && normName(name).endsWith(` ${last}`))) ? "name" : null;
}

/** The one fight a board bout prices, and whether its corners are reversed.
 *  At least one corner must match by id, or both by full name. */
export function matchBout<T extends OurFight>(bout: FightOddsBout, fights: T[]): { fight: T; reversed: boolean } | null {
  const found: { fight: T; reversed: boolean }[] = [];
  for (const fight of fights) {
    for (const reversed of [false, true]) {
      const [a, b] = reversed ? [bout.f2, bout.f1] : [bout.f1, bout.f2];
      const one = sameFighter(a, fight.f1_id, fight.names1);
      const two = sameFighter(b, fight.f2_id, fight.names2);
      if (!one || !two) continue;
      const byName = (corner: FightOddsCorner, names: string[]) => names.some((name) => normName(name) === normName(corner.name));
      if (one === "name" && two === "name" && !(byName(a, fight.names1) && byName(b, fight.names2))) continue;
      found.push({ fight, reversed });
    }
  }
  return found.length === 1 ? found[0] : null;
}

type RawPropOutcome = { odds: number | null; oddsPrev: number | null } | null;
export type RawProp = {
  propName1: string;
  propName2: string;
  offers: { edges: { node: { sportsbook: { shortName: string }; outcome1: RawPropOutcome; outcome2: RawPropOutcome } }[] };
};

/** Every prop on each bout's board, in one request per card. */
export async function fightOddsProps(slugs: string[]): Promise<Map<string, RawProp[]>> {
  if (!slugs.length) return new Map();
  const fields = `propOffers { edges { node { propName1 propName2 offers { edges { node {
    sportsbook { shortName } outcome1 { odds oddsPrev } outcome2 { odds oddsPrev } } } } } } }`;
  const request = `query(${slugs.map((_, i) => `$s${i}: String!`).join(", ")}) {
    ${slugs.map((_, i) => `p${i}: fightPropOfferTable(slug: $s${i}) { ${fields} }`).join("\n")} }`;
  const data = await query<Record<string, { propOffers: { edges: { node: RawProp }[] } } | null>>(
    request, Object.fromEntries(slugs.map((slug, i) => [`s${i}`, slug])), 90_000,
  );
  return new Map(slugs.map((slug, i) => [slug, data[`p${i}`]?.propOffers.edges.map((edge) => edge.node) ?? []]));
}

/** Exchanges and prediction markets. Their two-way moneylines join the median,
 *  but a thin prop market there can carry a price no book offers, and the
 *  matchup shows each prop's best price. */
const EXCHANGES = new Set(["kalshi", "polymarket", "prophetx", "sxbet", "4casters", "4cx"]);

function prices(offers: RawProp["offers"], side: "outcome1" | "outcome2"): MethodOddsPrice[] {
  const seen = new Set<string>();
  const list: MethodOddsPrice[] = [];
  for (const { node } of offers.edges) {
    const book = node.sportsbook.shortName;
    const outcome = node[side];
    if (EXCHANGES.has(book.toLowerCase().replace(/[^a-z0-9]/g, "")) || seen.has(book)) continue;
    if (outcome?.odds == null || !Number.isSafeInteger(outcome.odds) || Math.abs(outcome.odds) < 100) continue;
    seen.add(book);
    const move = outcome.oddsPrev == null || outcome.oddsPrev === outcome.odds ? undefined
      : outcome.odds > outcome.oddsPrev ? "up" as const : "down" as const;
    list.push({ bookmaker: book, line: text(outcome.odds), ...(move ? { move } : {}) });
  }
  return list;
}

/** A bout's props in the matchup's own markets and wording, corner for corner
 *  with ours: each fighter's method, the round totals, the distance, and the
 *  method in each round. `names` are the names our labels use. */
export function boutProps(props: RawProp[], bout: FightOddsBout, reversed: boolean, names: [string, string]): ScrapedMethodOdds {
  const result: ScrapedMethodOdds = { f1: {}, f2: {}, additional: [], sourceUrl: bout.url };
  // A fighter's prop names them by some tail of their full name.
  const sideOf = (who: string): 0 | 1 | null => {
    const tail = normName(who);
    const hits = [bout.f1.name, bout.f2.name].map((name) => normName(name) === tail || normName(name).endsWith(` ${tail}`));
    if (hits[0] === hits[1]) return null;
    const side = hits[0] ? 0 : 1;
    return (reversed ? 1 - side : side) as 0 | 1;
  };
  const quote = (label: string, list: MethodOddsPrice[]): MethodOddsQuote | null => (list.length ? { label, prices: list } : null);
  const add = (label: string, list: MethodOddsPrice[]) => {
    const q = quote(label, list);
    if (q && !result.additional.some((other) => other.label === label)) result.additional.push(q);
  };
  const METHODS: Record<string, keyof MethodOddsSide> = { "tko/ko": "ko", submission: "submission", decision: "decision" };
  for (const prop of props) {
    const name = prop.propName1.trim();
    let m = /^(.+) wins by (TKO\/KO|submission|decision)$/i.exec(name);
    if (m) {
      const side = sideOf(m[1]);
      const q = side == null ? null : quote(`${names[side]} wins by ${m[2].toLowerCase() === "tko/ko" ? "TKO/KO" : m[2].toLowerCase()}`, prices(prop.offers, "outcome1"));
      if (side != null && q) result[side ? "f2" : "f1"][METHODS[m[2].toLowerCase()]] ??= q;
      continue;
    }
    if ((m = /^Over ([1-4])\.5 rounds$/i.exec(name)) && /^Under [1-4]\.5 rounds$/i.test(prop.propName2.trim())) {
      add(`Over ${m[1]}½ rounds`, prices(prop.offers, "outcome1"));
      add(`Under ${m[1]}½ rounds`, prices(prop.offers, "outcome2"));
      continue;
    }
    if (/^Fight goes the distance$/i.test(name)) {
      add("Fight goes to decision", prices(prop.offers, "outcome1"));
      add("Fight doesn't go to decision", prices(prop.offers, "outcome2"));
      continue;
    }
    if ((m = /^Fight ends in round ([1-5]) - (KO, TKO or DQ|Submission)$/i.exec(name))) {
      add(`Fight ends in ${/^ko/i.test(m[2]) ? "TKO/KO/DQ" : "submission"} in round ${m[1]}`, prices(prop.offers, "outcome1"));
      continue;
    }
    if ((m = /^(.+) wins in round ([1-5]) - (KO, TKO or DQ|Submission)$/i.exec(name))) {
      const side = sideOf(m[1]);
      if (side != null) add(`${names[side]} wins by ${/^ko/i.test(m[3]) ? "TKO/KO" : "submission"} in round ${m[2]}`, prices(prop.offers, "outcome1"));
    }
  }
  return result;
}

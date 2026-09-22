import { db } from "./db.ts";
import { fetchVerdictDocument, fetchVerdictHtml, parseVerdictEventFightNumbers, parseVerdictEventPage, parseVerdictFightPage, VERDICT } from "./scrape/verdict.ts";
import { firstLastName, normName } from "./util.ts";
import { compatibleJudgeCards } from "./judge-scorecards.ts";

type LocalFight = {
  id: string; event_id: string; event_name: string; date: string;
  f1_name: string; f2_name: string; method: string | null; round: string | null;
  detail_json: string | null;
  judge_rounds_json: string | null; community_score_json: string | null;
};

const argv = new Map(process.argv.slice(2).map(value => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const maxEvent = Math.max(1, Number(argv.get("max") ?? process.env.VERDICT_MAX_EVENT_ID ?? 2050));
const firstEvent = Math.max(1, Number(argv.get("from") ?? 1));
const concurrency = Math.min(12, Math.max(1, Number(argv.get("concurrency") ?? 6)));
const refresh = argv.has("refresh");

function sameName(a: string, b: string): boolean {
  const left = normName(a);
  const right = normName(b);
  if (!left || !right) return false;
  if (left === right || firstLastName(left) === firstLastName(right)) return true;
  const la = left.split(" ");
  const lb = right.split(" ");
  return la.at(-1) === lb.at(-1) && la[0]?.[0] === lb[0]?.[0];
}

function orientation(a1: string, a2: string, b1: string, b2: string): 1 | -1 | 0 {
  if (sameName(a1, b1) && sameName(a2, b2)) return 1;
  if (sameName(a1, b2) && sameName(a2, b1)) return -1;
  return 0;
}

function scoreable(fight: LocalFight): boolean {
  return /DEC|decision/i.test(fight.method ?? "") || Number(fight.round) > 1;
}

const local = db.prepare(`SELECT f.id, f.event_id, e.name AS event_name, e.date,
  f.f1_name, f.f2_name, f.method, f.round, f.detail_json, f.judge_rounds_json, f.community_score_json
  FROM fights f JOIN events e ON e.id = f.event_id
  WHERE e.complete = 1 AND (f.method LIKE '%DEC' OR CAST(f.round AS INTEGER) > 1)
  ORDER BY e.date DESC, f.ord`).all() as LocalFight[];
const byDate = new Map<string, LocalFight[]>();
for (const fight of local) byDate.set(fight.date, [...(byDate.get(fight.date) ?? []), fight]);

const update = db.prepare(`UPDATE fights SET judge_rounds_json = COALESCE(?, judge_rounds_json),
  community_score_json = COALESCE(?, community_score_json), verdict_checked_at = ? WHERE id = ?`);
const replace = db.prepare(`UPDATE fights SET judge_rounds_json = ?, community_score_json = ?, verdict_checked_at = ? WHERE id = ?`);

let scanned = 0;
let matchedEvents = 0;
let matchedFights = 0;
let official = 0;
let community = 0;
let failed = 0;

async function importFight(eventId: number, fightNumber: number, fight: LocalFight): Promise<void> {
  const sourceUrl = `${VERDICT}/event/${eventId}/fight/${fightNumber}`;
  try {
    const page = parseVerdictFightPage(await fetchVerdictHtml(`/event/${eventId}/fight/${fightNumber}`));
    if (!page) return;
    const order = orientation(page.f1Name, page.f2Name, fight.f1_name, fight.f2_name);
    if (!order) return;
    const fetchedAt = Date.now();
    let judgeJson: string | null = null;
    if ((refresh || !fight.judge_rounds_json) && page.judges.length && /DEC|decision/i.test(fight.method ?? "")) {
      const aligned = page.judges.map(card => order === 1 ? card : {
        ...card,
        f1Name: card.f2Name, f2Name: card.f1Name,
        f1Score: card.f2Score, f2Score: card.f1Score,
        rounds: card.rounds.map(round => ({ ...round, f1Score: round.f2Score, f2Score: round.f1Score })),
      });
      let officialCards: any[] = [];
      try {
        const detail = fight.detail_json ? JSON.parse(fight.detail_json) : null;
        officialCards = Array.isArray(detail?.judges) ? detail.judges : [];
      } catch { /* malformed detail is treated as unavailable */ }
      const judges = compatibleJudgeCards(officialCards, aligned);
      if (judges.length) {
        judgeJson = JSON.stringify({ source: "Verdict MMA", sourceUrl, fetchedAt, judges });
        official += 1;
      }
    }
    let communityJson: string | null = null;
    if ((refresh || !fight.community_score_json) && page.community) {
      const card = page.community;
      const aligned = order === 1 ? card : {
        ...card,
        f1Name: card.f2Name, f2Name: card.f1Name,
        avg1: card.avg2, avg2: card.avg1,
        rounds: card.rounds.map(round => ({ ...round, avg1: round.avg2, avg2: round.avg1 })),
      };
      communityJson = JSON.stringify({ source: "Verdict MMA", sourceUrl, fetchedAt, ...aligned });
      community += 1;
    }
    if (refresh) replace.run(judgeJson, communityJson, fetchedAt, fight.id);
    else update.run(judgeJson, communityJson, fetchedAt, fight.id);
  } catch (error) {
    failed += 1;
    if (failed <= 20) console.error(`fight ${eventId}/${fightNumber}: ${String(error)}`);
  }
}

async function scanEvent(eventId: number): Promise<void> {
  try {
    const page = parseVerdictEventPage(await fetchVerdictHtml(`/event/${eventId}`));
    scanned += 1;
    const candidates = byDate.get(page.date) ?? [];
    if (!candidates.length || !page.fights.length) return;
    const matches = page.fights.flatMap(source => {
      const fight = candidates.find(row => orientation(source.f1Name, source.f2Name, row.f1_name, row.f2_name));
      return fight && scoreable(fight) && (refresh || !fight.judge_rounds_json || !fight.community_score_json) ? [{ source, fight }] : [];
    });
    if (!matches.length) return;
    matchedEvents += 1;
    const missingNumbers = matches.some(match => match.source.fightNumber == null);
    const numbered = missingNumbers
      ? parseVerdictEventFightNumbers(await fetchVerdictDocument(`/event/${eventId}`), eventId)
      : [];
    for (const match of matches) {
      const resolved = match.source.fightNumber != null ? match.source : numbered.find(source =>
        orientation(source.f1Name, source.f2Name, match.fight.f1_name, match.fight.f2_name));
      const fightNumber = resolved?.fightNumber;
      if (fightNumber == null) continue;
      matchedFights += 1;
      await importFight(resolved?.eventId ?? eventId, fightNumber, match.fight);
    }
  } catch (error) {
    failed += 1;
    if (failed <= 20) console.error(`event ${eventId}: ${String(error)}`);
  }
  if (scanned % 100 === 0) {
    console.log(`scanned ${scanned}/${maxEvent - firstEvent + 1}; matched ${matchedEvents} events / ${matchedFights} fights; official ${official}; community ${community}; failures ${failed}`);
  }
}

async function main(): Promise<void> {
  console.log(`Verdict backfill: events ${firstEvent}–${maxEvent}, ${concurrency} concurrent requests, ${local.length} scoreable local fights`);
  let next = firstEvent;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const eventId = next++;
      if (eventId > maxEvent) return;
      await scanEvent(eventId);
    }
  }));
  console.log(`done: scanned ${scanned}; matched ${matchedEvents} events / ${matchedFights} fights; official ${official}; community ${community}; failures ${failed}`);
}

await main();

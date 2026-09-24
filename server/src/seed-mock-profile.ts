/**
 * Fills one dev profile with fake activity — scorecards, predictions, bets
 * and comments — plus a field of fake rival fans so the leaderboards have
 * somebody to rank against. For seeing the profile pages full. Dev only.
 *
 *   node src/seed-mock-profile.ts <username>          add (replaces earlier mock data)
 *   node src/seed-mock-profile.ts <username> --reset  remove every mock row
 *
 * Every row it writes is tagged (ids start with `mock-`, rivals' user ids with
 * `mock_user_`, picks carry `"mock": true`), so a rerun or a reset touches
 * nothing real. Restart the app afterwards: a few read paths cache in memory.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { bodyKey } from "./moderation.ts";
import { PREDICTION_RULES } from "./predictions.ts";

const [username, flag] = process.argv.slice(2);
if (!username) {
  console.error("Usage: node src/seed-mock-profile.ts <username> [--reset]");
  process.exit(2);
}
const origin = process.env.SITE_ORIGIN ?? "";
if (process.env.NODE_ENV === "production" && origin !== "https://dev.ufc.sh") {
  console.error(`Refusing to write mock data outside dev (SITE_ORIGIN=${origin || "unset"}).`);
  process.exit(2);
}

const dataDir = process.env.DATA_DIR || path.join(import.meta.dirname, "..", "data");
const ufc = new DatabaseSync(path.join(dataDir, "ufc.db"), { readOnly: true });
const db = new DatabaseSync(path.join(dataDir, "scoring.db"));
db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

const target = db.prepare("SELECT user_id FROM scorers WHERE username_key = ?").get(username.toLowerCase()) as { user_id: string } | undefined;
if (!target) {
  console.error(`No scorer named ${username}. Sign in on dev once so the account exists.`);
  process.exit(1);
}
const me = target.user_id;

// ---------------------------------------------------------------------------
// removal

function removeMock() {
  const rivals = "SELECT user_id FROM scorers WHERE user_id LIKE 'mock_user_%'";
  db.exec(`
    DELETE FROM comment_votes WHERE user_id LIKE 'mock_user_%' OR comment_id LIKE 'mock-%';
    DELETE FROM comment_reports WHERE comment_id LIKE 'mock-%';
    DELETE FROM comments WHERE id LIKE 'mock-%' AND depth = 3;
    DELETE FROM comments WHERE id LIKE 'mock-%' AND depth = 2;
    DELETE FROM comments WHERE id LIKE 'mock-%';
    DELETE FROM bets WHERE id LIKE 'mock-%' OR user_id IN (${rivals});
    DELETE FROM predictions WHERE json_extract(pick_json, '$.mock') = 1 OR user_id IN (${rivals});
    DELETE FROM scores WHERE card_id LIKE 'mock-%';
    DELETE FROM scorecards WHERE id LIKE 'mock-%' OR user_id IN (${rivals});
    DELETE FROM comment_blocks WHERE user_id LIKE 'mock_user_%' OR blocked_id LIKE 'mock_user_%';
    DELETE FROM scorers WHERE user_id LIKE 'mock_user_%';
  `);
}

if (flag === "--reset") {
  db.exec("BEGIN IMMEDIATE");
  try { removeMock(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
  console.log("Removed all mock profile data.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// a repeatable random stream, so two runs build the same profile

let seed = 0x2f6e2b1;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => random() < p;
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const shuffle = <T,>(list: T[]): T[] => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (date: string, hours: number) => Date.parse(`${date}T00:00:00Z`) + hours * HOUR;

// ---------------------------------------------------------------------------
// the fights to draw from

type Fight = {
  id: string; event_id: string; event_name: string; event_date: string; complete: number;
  f1_id: string; f2_id: string; f1_name: string; f2_name: string;
  f1_outcome: string | null; f2_outcome: string | null; method: string | null; round: string | null;
  detail_json: string | null; f1_close: string | null; f2_close: string | null;
};
const today = new Date().toISOString().slice(0, 10);
const allFights = ufc.prepare(`
  SELECT f.id, f.event_id, e.name AS event_name, e.date AS event_date, e.complete,
         f.f1_id, f.f2_id, f.f1_name, f.f2_name, f.f1_outcome, f.f2_outcome, f.method, f.round,
         f.detail_json, o.f1_close, o.f2_close
  FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id
  WHERE f.f1_id != '' AND f.f2_id != '' AND e.date >= ?
  ORDER BY e.date DESC, f.ord ASC
`).all("2023-01-01") as Fight[];

const AMERICAN = /^[+-]\d+$/;
const winnerOf = (f: Fight): 1 | 2 | null => f.f1_outcome === "win" ? 1 : f.f2_outcome === "win" ? 2 : null;
const finishOf = (f: Fight): "ko" | "submission" | "decision" | null => {
  const method = (f.method ?? "").toUpperCase();
  if (/DEC/.test(method)) return "decision";
  if (/SUB/.test(method)) return "submission";
  if (/KO|TKO|DQ/.test(method)) return "ko";
  return null;
};
const scheduledOf = (f: Fight): number => {
  try {
    const format = JSON.parse(f.detail_json ?? "null")?.methodInfo?.["Time format"] as string | undefined;
    return Number(format?.match(/^(\d+) Rnd \(5-5(?:-5)*\)$/)?.[1] ?? 0);
  } catch { return 0; }
};
/** Rounds a completed bout has to score: every round of a decision, the ones
 *  before the stoppage otherwise — the same rule the scoring panel applies. */
const scorableRounds = (f: Fight): number => {
  const scheduled = scheduledOf(f);
  const last = Number(f.round);
  if (![3, 5].includes(scheduled) || !Number.isInteger(last) || last < 1 || last > scheduled) return 0;
  return finishOf(f) === "decision" ? last : last - 1;
};

const settled = allFights.filter(f => f.complete && f.event_date < today && winnerOf(f) && finishOf(f));
const upcoming = allFights.filter(f => !f.complete && f.event_date >= today);
const priced = (f: Fight) => AMERICAN.test(f.f1_close ?? "") && AMERICAN.test(f.f2_close ?? "");
console.log(`${settled.length} settled and ${upcoming.length} upcoming bouts to draw from.`);

// ---------------------------------------------------------------------------
// fans

const FIRST = ["Iron", "Swift", "Prime", "Rolling", "Spinning", "Heavy", "Slick", "Ground", "Clinch", "Hook", "Jab", "Body", "Cage", "Octa", "Guard", "Sprawl", "Philly", "Muay", "Liver", "Calf"];
const SECOND = ["Chin", "Pivot", "Southpaw", "Thunder", "Elbow", "Kicker", "Choke", "Wrestler", "Counter", "Striker", "Shot", "Scrambler", "Sweep", "Shell", "Clinch", "Knee", "Plex", "Tap", "Check", "Stance"];
const RIVAL_COUNT = 24;
const rivals: string[] = [];

type Row = Record<string, string | number | null>;
const insert = (table: string, row: Row) => {
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...Object.values(row));
};

// ---------------------------------------------------------------------------
// writers

function scorecard(user: string, f: Fight, skill: number, when: number) {
  const rounds = scorableRounds(f);
  if (!rounds) return false;
  const winner = winnerOf(f)!;
  const list = [];
  for (let round = 1; round <= rounds; round++) {
    // Mostly the round goes the winner's way; a skilled scorer disagrees less.
    const forWinner = chance(0.55 + skill * 0.2);
    const side: 1 | 2 = forWinner ? winner : winner === 1 ? 2 : 1;
    const loser = chance(0.08) ? 8 : 9;
    const even = chance(0.03);
    const f1 = even ? 10 : side === 1 ? 10 : loser;
    const f2 = even ? 10 : side === 2 ? 10 : loser;
    list.push({ round, f1, f2, deduct1: chance(0.02) ? 1 : 0, deduct2: chance(0.02) ? 1 : 0 });
  }
  const id = `mock-${randomUUID()}`;
  insert("scorecards", { id, fight_id: f.id, user_id: user, revision: int(1, 3), updated_at: when, rounds_json: JSON.stringify(list) });
  for (const r of list) insert("scores", { card_id: id, fight_id: f.id, round: r.round, f1: r.f1, f2: r.f2, deduct1: r.deduct1, deduct2: r.deduct2 });
  return true;
}

function prediction(user: string, f: Fight, skill: number, when: number) {
  const actual = winnerOf(f);
  const finish = finishOf(f);
  const right = actual ? chance(skill) : chance(0.5);
  const side: 1 | 2 = actual ? (right ? actual : actual === 1 ? 2 : 1) : (chance(0.5) ? 1 : 2);
  // Most fans name a method; a correct winner call often gets it right too.
  let method: "ko" | "submission" | "decision" | null = chance(0.8)
    ? (right && finish && chance(0.55) ? finish : pick(["ko", "submission", "decision"] as const)) : null;
  let round: number | null = null;
  if (method && method !== "decision" && chance(0.6)) {
    const actualRound = Number(f.round);
    round = right && method === finish && Number.isInteger(actualRound) && chance(0.4) ? actualRound : int(1, 3);
  }
  if (method === "decision") round = null;
  if (!method) round = null;
  const pickJson = {
    fighterId: side === 1 ? f.f1_id : f.f2_id, method, round,
    eventId: f.event_id, f1Id: f.f1_id, f2Id: f.f2_id, f1Name: f.f1_name, f2Name: f.f2_name,
    eventName: f.event_name, eventDate: f.event_date, ruleVersion: PREDICTION_RULES.version, mock: true,
  };
  insert("predictions", { fight_id: f.id, user_id: user, revision: int(1, 2), updated_at: when, pick_json: JSON.stringify(pickJson) });
}

function leg(f: Fight, skill: number) {
  const actual = winnerOf(f);
  const side: 1 | 2 = actual && chance(skill) ? actual : (chance(0.5) ? 1 : 2);
  const name = side === 1 ? f.f1_name : f.f2_name;
  const price = (side === 1 ? f.f1_close : f.f2_close)!;
  const base = { fightId: f.id, eventId: f.event_id, eventName: f.event_name, eventDate: f.event_date,
    f1Id: f.f1_id, f2Id: f.f2_id, f1Name: f.f1_name, f2Name: f.f2_name };
  const roll = random();
  if (roll < 0.7) return { ...base, market: "Moneyline", selection: `${name} to win`, price, outcome: { fightId: f.id, winner: side } };
  // A method prop pays well above the moneyline; the price is made up but
  // shaped like the real board.
  const decimal = 1 + Math.abs(Number(price)) / 100;
  const boost = (n: number) => `+${Math.round((decimal * n - 1) * 100)}`;
  if (roll < 0.85) return { ...base, market: "Method", selection: `${name} by KO/TKO`, price: boost(2.4), outcome: { fightId: f.id, winner: side, decision: false, method: "KO/TKO" } };
  if (roll < 0.93) return { ...base, market: "Method", selection: `${name} by DEC`, price: boost(1.9), outcome: { fightId: f.id, winner: side, decision: true } };
  return { ...base, market: "Goes the distance", selection: "Goes to decision", price: pick(["-150", "-125", "+110", "+135"]), outcome: { fightId: f.id, decision: true } };
}

function bet(user: string, fights: Fight[], skill: number, when: number) {
  const legs = fights.map(f => leg(f, skill));
  const stake = pick([100, 200, 250, 500, 500, 1000, 1000, 1500, 2000]);
  insert("bets", { id: `mock-${randomUUID()}`, user_id: user, placed_at: when, stake_cents: stake, legs_json: JSON.stringify(legs) });
}

// ---------------------------------------------------------------------------
// comments

const OPENERS = [
  "{w} was levels above tonight.", "Robbery. {l} won rounds 2 and 3 clearly.", "That {m} was clean — didn’t see it coming.",
  "Called it last week, {w} had the better cardio all along.", "Say what you want but {l} showed a lot of heart.",
  "{w} needs a ranked opponent next, no more tune-ups.", "Judges got this one right for once.",
  "How is nobody talking about {w}’s footwork in the first?", "{l} gassed after round one, same story every fight.",
  "Watch the replay: that shot to the body is what ended it.", "Bring {w} back on a five-round main event.",
  "The takedown defence from {w} was the difference.", "{l} should have stayed on the outside instead of trading.",
  "I scored it the other way, closer than the cards say.", "That’s a performance bonus if I’ve ever seen one.",
  "Crowd was dead until that third round exchange.", "{w} keeps getting better every camp.",
  "Not sure the stoppage was early, {l} was out on his feet.", "Honestly thought {l} was winning on volume.",
  "The jab won this fight. Simple as that.", "Calf kicks from {w} changed everything after round one.",
];
const PREVIEWS = [
  "{a} by decision, the reach is too much.", "I like {b} on the ground here, sub in two.", "This is a pick’em, could go either way.",
  "{a} at plus money is free money.", "If {b} survives the first round it’s theirs.", "Fight of the night candidate right here.",
  "{a} by KO in round one, lock it in.", "The line has moved a lot towards {b}, somebody knows something.",
];
const REPLIES = [
  "Hard disagree.", "Exactly what I was saying.", "Rewatch round two before you say that.", "Facts.",
  "This aged well.", "Cards were a mess either way.", "{w} is overrated, change my mind.", "Fair point, I was wrong on this one.",
  "Totally. The body work set up everything.", "Nah, that was a 10-8 at least.", "No way, the stoppage was fine.",
];
const fill = (text: string, f: Fight) => {
  const w = winnerOf(f) === 2 ? f.f2_name : f.f1_name;
  const l = winnerOf(f) === 2 ? f.f1_name : f.f2_name;
  const finish = finishOf(f);
  return text.replaceAll("{w}", w).replaceAll("{l}", l).replaceAll("{a}", f.f1_name).replaceAll("{b}", f.f2_name)
    .replaceAll("{m}", finish === "submission" ? "submission" : finish === "ko" ? "finish" : "decision");
};

function comment(user: string, f: Fight, body: string, when: number, parent: { id: string; root: string; depth: number } | null) {
  const id = `mock-${randomUUID()}`;
  const ups = int(0, 18);
  const downs = chance(0.35) ? int(1, 4) : 0;
  insert("comments", {
    id, fight_id: f.id, user_id: user, parent_id: parent?.id ?? null, root_id: parent?.root ?? id,
    depth: parent ? parent.depth + 1 : 1, body, body_key: bodyKey(body), created_at: when,
    edited_at: chance(0.1) ? when + int(1, 30) * 60_000 : null, ups, downs,
  });
  // The tallies on the row are backed by real votes from the rival fans.
  const voters = shuffle(rivals.filter(rival => rival !== user));
  voters.slice(0, ups).forEach(voter => insert("comment_votes", { comment_id: id, user_id: voter, value: 1, created_at: when + HOUR }));
  voters.slice(ups, ups + downs).forEach(voter => insert("comment_votes", { comment_id: id, user_id: voter, value: -1, created_at: when + HOUR }));
  return { id, root: parent?.root ?? id, depth: parent ? parent.depth + 1 : 1 };
}

// ---------------------------------------------------------------------------
// build

db.exec("BEGIN IMMEDIATE");
try {
  removeMock();
  const takenNames = new Set((db.prepare("SELECT username_key FROM scorers WHERE username_key IS NOT NULL").all() as { username_key: string }[]).map(row => row.username_key));

  for (let i = 0; rivals.length < RIVAL_COUNT; i++) {
    const name = `${pick(FIRST)}${pick(SECOND)}${int(1, 99)}`;
    if (takenNames.has(name.toLowerCase())) continue;
    takenNames.add(name.toLowerCase());
    const user = `mock_user_${String(i).padStart(3, "0")}`;
    const joined = Date.now() - int(20, 400) * DAY;
    insert("scorers", {
      user_id: user, public_id: randomUUID(), created_at: joined, username: name, username_key: name.toLowerCase(),
      username_set_at: joined, image_url: null, comments_public: chance(0.6) ? 1 : 0,
    });
    rivals.push(user);
  }

  const recent = settled.slice(0, 400);
  const decisions = recent.filter(f => scorableRounds(f) > 0);

  // Your scorecards: most judged bouts of the last few cards, some finishes.
  let cards = 0;
  for (const f of shuffle(decisions).slice(0, 110)) if (scorecard(me, f, 0.8, at(f.event_date, int(28, 60)))) cards++;

  // Your picks: a long settled history, and every bout still ahead.
  const myPicks = shuffle(recent).slice(0, 170);
  for (const f of myPicks) prediction(me, f, 0.66, at(f.event_date, -int(2, 140)));
  for (const f of upcoming) if (chance(0.85)) prediction(me, f, 0.5, Date.now() - int(1, 72) * HOUR);

  // Your bets: straights and parlays, won, lost and still open.
  const pricedPast = recent.filter(priced);
  const pricedAhead = upcoming.filter(priced);
  for (let i = 0; i < 55; i++) {
    const size = chance(0.65) ? 1 : int(2, 4);
    const legs = shuffle(pricedPast).slice(0, size);
    // A parlay's legs sit on one card, the way the slip is usually built.
    const card = legs.length > 1 ? shuffle(pricedPast.filter(f => f.event_id === legs[0].event_id)).slice(0, size) : legs;
    if (card.length) bet(me, card, 0.52, at(card[0].event_date, -int(3, 120)));
  }
  for (let i = 0; i < 8 && pricedAhead.length; i++) {
    const size = chance(0.6) ? 1 : int(2, 3);
    const legs = shuffle(pricedAhead).slice(0, size);
    bet(me, legs, 0.5, Date.now() - int(1, 48) * HOUR);
  }

  // Rivals: enough settled picks and bets to rank, at a spread of skill, so
  // the leaderboards read like a real field with you somewhere in it.
  for (const rival of rivals) {
    const skill = 0.45 + random() * 0.3;
    for (const f of shuffle(recent).slice(0, int(20, 150))) prediction(rival, f, skill, at(f.event_date, -int(2, 140)));
    for (const f of shuffle(upcoming).slice(0, int(0, upcoming.length))) prediction(rival, f, 0.5, Date.now() - int(1, 96) * HOUR);
    for (let i = int(3, 30); i > 0; i--) {
      const legs = shuffle(pricedPast).slice(0, chance(0.7) ? 1 : 2);
      if (legs.length) bet(rival, legs, skill, at(legs[0].event_date, -int(3, 120)));
    }
    for (const f of shuffle(decisions).slice(0, int(0, 25))) scorecard(rival, f, 0.5 + random() * 0.4, at(f.event_date, int(28, 90)));
  }

  // Comments: your takes on past fights, previews of the next card, and the
  // threads that grew under them in both directions.
  let comments = 0;
  for (const f of shuffle(recent).slice(0, 60)) {
    const when = at(f.event_date, int(26, 200));
    const mine = comment(me, f, fill(pick(OPENERS), f), when, null);
    comments++;
    for (let r = int(0, 3); r > 0; r--) {
      const reply = comment(pick(rivals), f, fill(pick(REPLIES), f), when + int(1, 40) * HOUR, mine);
      if (chance(0.4)) { comment(me, f, fill(pick(REPLIES), f), when + int(41, 80) * HOUR, reply); comments++; }
    }
  }
  for (const f of shuffle(recent).slice(0, 25)) {
    const when = at(f.event_date, int(26, 200));
    const theirs = comment(pick(rivals), f, fill(pick(OPENERS), f), when, null);
    comment(me, f, fill(pick(REPLIES), f), when + int(1, 30) * HOUR, theirs);
    comments++;
  }
  for (const f of shuffle(upcoming).slice(0, 12)) {
    comment(me, f, fill(pick(PREVIEWS), f), Date.now() - int(1, 120) * HOUR, null);
    comments++;
  }

  db.exec("COMMIT");
  const count = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  console.log(`${username}: ${cards} scorecards, ${count("SELECT COUNT(*) n FROM predictions WHERE user_id = ?", me)} predictions, `
    + `${count("SELECT COUNT(*) n FROM bets WHERE user_id = ?", me)} bets, ${comments} comments.`);
  console.log(`${rivals.length} rival fans with ${count("SELECT COUNT(*) n FROM predictions WHERE user_id LIKE 'mock_user_%'")} predictions `
    + `and ${count("SELECT COUNT(*) n FROM bets WHERE user_id LIKE 'mock_user_%'")} bets.`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

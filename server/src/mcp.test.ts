import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_VERSIONS, MODERN_VERSIONS, answerMcp, validOrigin, type McpServer } from "./mcp.ts";
import { MAX_RESULT_CHARS, createMcpServer, fitted, prune, type McpData } from "./mcp-tools.ts";
import { publicApi } from "./api-policy.ts";
import { OverloadedError } from "./response-cache.ts";

const META = "io.modelcontextprotocol";
const VERSION = MODERN_VERSIONS[0];
const meta = { [`${META}/protocolVersion`]: VERSION, [`${META}/clientCapabilities`]: {} };
const server: McpServer = {
  info: { name: "ufc.sh", version: "1" }, instructions: "read me",
  tools: [{ name: "echo", title: "Echo", description: "", inputSchema: { type: "object" }, annotations: {} }],
  call: async (name, args) => ({ text: JSON.stringify({ name, args }), isError: args.fail === true }),
};
const headersOf = (values: Record<string, string>) => (name: string) => values[name];
const modernHeaders = (method: string, extra: Record<string, string> = {}) => headersOf({ "mcp-protocol-version": VERSION, "mcp-method": method, ...extra });
const rpc = (method: string, params?: object, id: unknown = 1) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
const body = (reply: { body?: unknown }) => reply.body as any;

test("legacy clients open with initialize and need no session", async () => {
  const known = await answerMcp(server, rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} }), headersOf({}));
  assert.equal(body(known).result.protocolVersion, "2025-06-18");
  assert.deepEqual(body(known).result.capabilities, { tools: {} });
  assert.equal(body(known).result.instructions, "read me");
  const unknown = await answerMcp(server, rpc("initialize", { protocolVersion: "1999-01-01" }), headersOf({}));
  assert.equal(body(unknown).result.protocolVersion, LEGACY_VERSIONS[0]);
  assert.equal((await answerMcp(server, { jsonrpc: "2.0", method: "notifications/initialized" }, headersOf({}))).status, 202);
  const list = await answerMcp(server, rpc("tools/list"), headersOf({ "mcp-protocol-version": "2025-11-25" }));
  assert.equal(body(list).result.tools[0].name, "echo");
  assert.equal(body(list).result.resultType, undefined);
  const call = await answerMcp(server, rpc("tools/call", { name: "echo", arguments: { a: 1 } }), headersOf({}));
  assert.deepEqual(JSON.parse(body(call).result.content[0].text), { name: "echo", args: { a: 1 } });
  assert.equal(body(call).result.isError, false);
  const unknownMethod = await answerMcp(server, rpc("prompts/list"), headersOf({}));
  assert.equal(unknownMethod.status, 200);
  assert.equal(body(unknownMethod).error.code, -32601);
});

test("modern requests are stateless and carry their version", async () => {
  const discover = await answerMcp(server, rpc("server/discover", { _meta: meta }), modernHeaders("server/discover"));
  assert.equal(body(discover).result.resultType, "complete");
  assert.ok(body(discover).result.supportedVersions.includes(VERSION));
  assert.equal(body(discover).result.cacheScope, "public");
  assert.ok(body(discover).result.ttlMs > 0);
  const list = await answerMcp(server, rpc("tools/list", { _meta: meta }), modernHeaders("tools/list"));
  assert.equal(body(list).result.resultType, "complete");
  assert.equal(body(list).result._meta[`${META}/serverInfo`].name, "ufc.sh");
  const call = await answerMcp(server, rpc("tools/call", { name: "echo", arguments: { fail: true }, _meta: meta }), modernHeaders("tools/call", { "mcp-name": "echo" }));
  assert.equal(body(call).result.isError, true);
  assert.equal(body(call).result.resultType, "complete");
  const missing = await answerMcp(server, rpc("nope/nothing", { _meta: meta }), modernHeaders("nope/nothing"));
  assert.equal(missing.status, 404);
  assert.equal(body(missing).error.code, -32601);
});

test("a modern request whose headers disagree with its body is refused", async () => {
  const code = async (message: unknown, header: (name: string) => string | undefined) => {
    const reply = await answerMcp(server, message, header);
    assert.equal(reply.status, 400);
    return body(reply).error.code;
  };
  const list = rpc("tools/list", { _meta: meta });
  assert.equal(await code(list, headersOf({ "mcp-method": "tools/list" })), -32020);
  assert.equal(await code(list, modernHeaders("tools/call")), -32020);
  assert.equal(await code(list, headersOf({ "mcp-protocol-version": VERSION })), -32020);
  const call = (name: string) => rpc("tools/call", { name, _meta: meta });
  assert.equal(await code(call("echo"), modernHeaders("tools/call")), -32020);
  assert.equal(await code(call("echo"), modernHeaders("tools/call", { "mcp-name": "other" })), -32020);
  const encoded = `=?base64?${Buffer.from("echo").toString("base64")}?=`;
  assert.equal((await answerMcp(server, call("echo"), modernHeaders("tools/call", { "mcp-name": encoded }))).status, 200);
  assert.equal(await code(rpc("tools/list", { _meta: { [`${META}/protocolVersion`]: VERSION } }), modernHeaders("tools/list")), -32602);
  assert.equal(await code(rpc("tools/list"), modernHeaders("tools/list")), -32602);
});

test("an unknown protocol version lists what is supported", async () => {
  const stale = { [`${META}/protocolVersion`]: "1900-01-01", [`${META}/clientCapabilities`]: {} };
  const reply = await answerMcp(server, rpc("tools/list", { _meta: stale }), headersOf({ "mcp-protocol-version": "1900-01-01", "mcp-method": "tools/list" }));
  assert.equal(reply.status, 400);
  assert.equal(body(reply).error.code, -32022);
  assert.equal(body(reply).error.data.requested, "1900-01-01");
  assert.ok(body(reply).error.data.supported.includes(VERSION));
  const header = await answerMcp(server, rpc("tools/list"), headersOf({ "mcp-protocol-version": "2031-01-01" }));
  assert.equal(body(header).error.code, -32022);
});

test("malformed messages get a JSON-RPC error, not a crash", async () => {
  const code = async (message: unknown) => body(await answerMcp(server, message, headersOf({}))).error.code;
  assert.equal(await code([rpc("tools/list")]), -32600);
  assert.equal(await code("hello"), -32600);
  assert.equal(await code({ jsonrpc: "1.0", id: 1, method: "ping" }), -32600);
  assert.equal(await code(rpc("tools/list", undefined, null)), -32600);
  assert.equal(await code(rpc("tools/list", undefined, 1.5)), -32600);
  assert.equal(await code({ jsonrpc: "2.0", id: 1, method: "tools/list", params: [1] }), -32602);
  assert.equal(await code(rpc("tools/call", { name: "missing" })), -32602);
  assert.equal(await code(rpc("tools/call", { name: "echo", arguments: "x" })), -32602);
});

test("any well-formed web origin may call this public server", () => {
  assert.ok(validOrigin(undefined));
  assert.ok(validOrigin("https://claude.ai"));
  assert.ok(validOrigin("http://localhost:6274"));
  assert.equal(validOrigin("null"), false);
  assert.equal(validOrigin("https://a.example/path"), false);
  assert.equal(validOrigin(""), false);
});

// -- Tools ---------------------------------------------------------------------

const JONES = "07f72a2a7591b409";
const DC = "d967f0128c323de6";
const FIGHT = "b35e47f2f58ef026";
const REMATCH = "5ab286735ccee803";
const EVENT = "daff32bc96d1eabf";
const side = (id: string, name: string, outcome: string | null, extra: object = {}) => ({
  id, name, record: "20-1", outcome, ranking: { division: "Heavyweight", rank: "C" }, age: 37,
  career_before: { statBouts: 20, finishes: 5, seconds: 600, sigLanded: 30, sigAbsorbed: 15, sigAttempted: 60, sigAccuracyLanded: 30 },
  ...extra,
});
const fightPayload = (over: object = {}) => ({
  id: FIGHT, status: "past", event: { id: EVENT, name: "UFC 309", date: "2024-11-16" }, weight_class: "Heavyweight", title_fight: true, title_type: "title", scheduled_rounds: 3,
  method: "U-DEC", round: "3", time: "5:00", officials: { referee: { name: "Herb Dean" } },
  f1: side(JONES, "Jon Jones", "win"), f2: side(DC, "Daniel Cormier", "loss"),
  odds: { f1: { open: "-150", close: "-160" }, f2: { open: "+130", close: "+140" }, source_url: "https://example.com" },
  judging: { stats: { rounds: [{ round: 1, p: 0.9 }], f1: 1, f2: 0, pick: 1 }, controversy: { margin: 2.5, signals: { close: false, fans_other: true } } },
  detail: {
    type: "past", judges: [{ judge: "A Judge", f1Score: 29, f2Score: 27, rounds: [{ round: 1, f1Score: 10, f2Score: 9 }] }],
    deductions: [{ side: "f2", round: 3, points: 1, reason: "Eye poke" }], totals: { labels: ["KD"], f1: ["1"], f2: ["0"] },
    media: { cards: [{ name: "Writer", outlet: "Paper", f1Score: 30, f2Score: 26 }] },
  },
  ...over,
});
const profile = {
  id: JONES, name: "Jon Jones", record: "28-1", ufc_record: "22-1", career_stats: { statBouts: 2, seconds: 60, sigLanded: 6, sigAbsorbed: 3 },
  division_medians: { division: "Heavyweight", from: "2023-01-01", to: "2026-01-01", fighters: 40, values: { slpm: 3.5, sapm: 3.4 } },
  history: [
    { fight_id: FIGHT, date: "2024-11-16", outcome: "win", method: "KO/TKO", opponent: { id: DC, name: "Daniel Cormier" } },
    { fight_id: REMATCH, date: "2017-07-29", outcome: "nc", method: "Overturned", opponent: { id: DC, name: "Daniel Cormier" } },
    { fight_id: "1111111111111111", date: "2099-01-01", upcoming: true, outcome: null, opponent: { id: "2222222222222222", name: "Next Foe" } },
  ],
  pro_history: [], records: [], awards: [], roster_events: [], cancelled: [],
};
const fixtures: Record<string, unknown> = {
  "/api/events": [
    { id: "potential-matchups", name: "Potential matchups", date: "", status: "future", potential: true },
    { id: "3333333333333333", name: "UFC 340", date: "2027-02-01", location: "Sydney", status: "future", fight_count: 1 },
    { id: "4444444444444444", name: "UFC 339", date: "2027-01-01", location: "Vegas", status: "next", fight_count: 5 },
    { id: EVENT, name: "UFC 309", date: "2024-11-16", location: "New York", status: "past", fight_count: 13 },
  ],
  "/api/rankings": { updated_at: 1, divisions: [
    { division: "Men's Pound-for-Pound", entries: [{ rank: "1", name: "P4P Man", fighter_id: JONES }] },
    { division: "Flyweight", entries: [{ rank: "C", name: "Fly Man", fighter_id: JONES }] },
    { division: "Light Heavyweight", entries: [{ rank: "C", name: "Light Heavy", fighter_id: JONES }] },
    { division: "Heavyweight", entries: [{ rank: "C", name: "Real Heavy", fighter_id: JONES }, { rank: "1", name: "Contender", fighter_id: DC }] },
    { division: "Women's Flyweight", entries: [{ rank: "C", name: "Fly Woman", fighter_id: JONES }] },
  ] },
  "/api/stats": { leaderboards: [{ group: "fights", title: "Judges most in step", format: "time", rows: [{ fighter_id: "a-judge", name: "A Judge", href: "/judges/a-judge", value: 90, rank: 1, tied: false, photo_url: "x" }] },
    { group: "record", title: "Wins", format: "number", rows: [{ fighter_id: JONES, name: "Jon Jones", value: 22, rank: 1, tied: false }] }] },
  "/api/officials": { judges: [], referees: [] },
  "/api/news": { total: 0, latest: [] },
  "/api/roster": { signed: [], cut: [] },
  "/api/awards": { categories: [] },
  "/api/controversial": { total: 0, rows: [] },
  [`/api/fighters/${JONES}`]: profile,
  [`/api/fights/${FIGHT}`]: fightPayload(),
  [`/api/fights/${REMATCH}`]: fightPayload({ id: REMATCH }),
  [`/api/fights/${FIGHT}/tape-history`]: { rows: [] },
  [`/api/fights/${REMATCH}/tape-history`]: { rows: [] },
};
const SEARCH: Record<string, unknown> = {
  "jon jones": { fighters: [{ id: JONES, name: "Jon Jones", record: "28-1" }], events: [], fights: [], officials: [], venues: [], locations: [] },
  "jon jonez": { fighters: [{ id: JONES, name: "Jon Jones", approximate: true }], events: [], fights: [], officials: [], venues: [], locations: [] },
  "daniel cormier": { fighters: [{ id: DC, name: "Daniel Cormier" }], events: [], fights: [], officials: [], venues: [], locations: [] },
  "bruno silva": { fighters: [{ id: "5555555555555555", name: "Bruno Silva", record: "23-12" }, { id: "6666666666666666", name: "Bruno Silva", record: "13-5" }], events: [], fights: [], officials: [], venues: [], locations: [] },
  "silva": { fighters: [{ id: "5555555555555555", name: "Bruno Silva" }, { id: "7777777777777777", name: "Anderson Silva" }], events: [], fights: [], officials: [], venues: [], locations: [] },
  "nobody": { fighters: [], events: [], fights: [], officials: [], venues: [], locations: [] },
};
function fakeData(overrides: Partial<McpData> = {}, seen: string[] = []): McpData {
  return {
    read: async (path) => {
      seen.push(path);
      const url = new URL(path, "http://localhost");
      if (url.pathname === "/api/search") return SEARCH[url.searchParams.get("q")!.toLowerCase()] ?? SEARCH.nobody;
      return fixtures[url.pathname];
    },
    fanScores: async () => ({ totals: { avg1: 29.37, avg2: 26.48, completeCards: 100 }, rounds: [{ total1: 9.9, total2: 9.1 }] }),
    markets: () => [],
    liveOdds: async () => ({ fight_id: null, odds: null, finished: null }),
    ...overrides,
  };
}
const call = async (name: string, args: Record<string, unknown> = {}, data = fakeData()) => {
  const { text, isError } = await createMcpServer(data).call(name, args);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* plain message */ }
  return { text, isError, json };
};

test("a division's name is matched whole: heavyweight is never light heavyweight", async () => {
  const entry = async (division: string) => (await call("get_rankings", { division })).json.entries[0].name;
  assert.equal(await entry("heavyweight"), "Real Heavy");
  assert.equal(await entry("light heavyweight"), "Light Heavy");
  assert.equal(await entry("flyweight"), "Fly Man");
  assert.equal(await entry("women's flyweight"), "Fly Woman");
  assert.equal(await entry("womens flyweight"), "Fly Woman");
  assert.equal(await entry("p4p"), "P4P Man");
  const unknown = await call("get_rankings", { division: "cruiserweight" });
  assert.ok(unknown.isError);
  assert.ok(unknown.json.divisions.includes("Heavyweight"));
});

test("rankings without a division list champions only", async () => {
  const { json } = await call("get_rankings");
  assert.equal(json.list, "media");
  const heavy = json.champions.find((row: any) => row.division === "Heavyweight");
  assert.deepEqual(heavy.champions.map((row: any) => row.name), ["Real Heavy"]);
});

test("a name is never guessed: ambiguous names list candidates", async () => {
  const twins = await call("get_fighter", { fighter: "Bruno Silva" });
  assert.ok(twins.isError);
  assert.equal(twins.json.candidates.length, 2);
  assert.equal((await call("get_fighter", { fighter: "silva" })).json.candidates.length, 2);
  const none = await call("get_fighter", { fighter: "nobody" });
  assert.ok(none.isError);
  assert.match(none.json.error, /No fighter/);
  assert.equal((await call("get_fighter", { fighter: "Jon Jonez" })).json.name, "Jon Jones");
  assert.equal((await call("get_fighter", { fighter: `https://ufc.sh/fighters/${JONES}` })).json.id, JONES);
});

test("a fighter's rates use the shared formulas and the booked bout is kept apart", async () => {
  const { json } = await call("get_fighter", { fighter: "Jon Jones" });
  assert.equal(json.career_stats.rates["Strikes landed / min"], 6);
  assert.equal(json.career_stats.rates["Strikes absorbed / min"], 3);
  assert.equal(json.career_stats.division_medians.values["Strikes landed / min"], 3.5);
  assert.deepEqual(json.booked.map((row: any) => row.result), ["upcoming"]);
  assert.equal(json.fights.length, 2);
  assert.ok(json.fights.every((row: any) => row.result !== "upcoming"));
});

test("unknown numbers are left out, never written as zero", async () => {
  const { json } = await call("get_fight", { fight: FIGHT });
  const rates = json.career_stats["Jon Jones"].rates;
  assert.equal(rates["Strikes landed / min"], 3);
  assert.equal("Takedowns / 15 min" in rates, false);
  assert.equal("Takedown accuracy" in rates, false);
  assert.deepEqual(prune({ a: 0, b: false, c: null, d: "", e: [], f: { g: null } }), { a: 0, b: false, f: {} });
});

test("get_fight says when its numbers apply and whose score is whose", async () => {
  const { json } = await call("get_fight", { fight: FIGHT });
  assert.equal(json.tape.as_of, "entering this fight");
  assert.equal(json.career_stats.as_of, "UFC career entering this fight");
  assert.deepEqual(json.fighters, ["Jon Jones", "Daniel Cormier"]);
  assert.equal(json.result.winner, "Jon Jones");
  const cards = json.scorecards;
  assert.ok(cards.note.includes("[Jon Jones, Daniel Cormier]"));
  assert.deepEqual(cards.judges[0].total, [29, 27]);
  assert.deepEqual(cards.judges[0].rounds, [[10, 9]]);
  assert.deepEqual(cards.deductions, [{ fighter: "Daniel Cormier", round: 3, points: 1, reason: "Eye poke" }]);
  assert.deepEqual(cards.fans.total, [29.37, 26.48]);
  assert.equal(cards.stats_judge.pick, "Jon Jones");
  assert.deepEqual(cards.controversy, { fans_points_apart: 2.5, flags: ["fans had the other winner"] });
  assert.equal(json.odds.no_vig_probability["Jon Jones"], 0.596);
  assert.equal(json.odds.no_vig_probability["Daniel Cormier"], 0.404);
});

test("a draw has no winner, and an unfought bout no result", async () => {
  const data = (over: object) => fakeData({ read: async (path) => path.includes("tape-history") ? { rows: [] } : fightPayload(over) });
  const draw = await call("get_fight", { fight: FIGHT }, data({ f1: side(JONES, "A", "draw"), f2: side(DC, "B", "draw") }));
  assert.equal(draw.json.result.outcome, "draw");
  assert.equal("winner" in draw.json.result, false);
  const nc = await call("get_fight", { fight: FIGHT }, data({ f1: side(JONES, "A", "nc"), f2: side(DC, "B", "nc") }));
  assert.equal(nc.json.result.outcome, "no contest");
  const coming = await call("get_fight", { fight: FIGHT }, data({ status: "upcoming", method: null, f1: side(JONES, "A", null), f2: side(DC, "B", null), detail: { type: "future" }, judging: null }));
  assert.equal(coming.json.result, undefined);
  assert.equal(coming.json.status, "upcoming");
  assert.equal(coming.json.scorecards, undefined);
  assert.match(coming.json.odds.note, /can still move/);
});

test("a pairing resolves to its latest meeting unless one is named", async () => {
  const latest = await call("get_fight", { fighter_a: "Jon Jones", fighter_b: "Daniel Cormier" });
  assert.equal(latest.json.id, FIGHT);
  assert.deepEqual(latest.json.other_meetings, [{ fight_id: REMATCH, date: "2017-07-29" }]);
  assert.equal((await call("get_fight", { fighter_a: "Jon Jones", fighter_b: "Daniel Cormier", meeting: 1 })).json.id, REMATCH);
  assert.ok((await call("get_fight", { fighter_a: "Jon Jones", fighter_b: "Daniel Cormier", meeting: 3 })).isError);
  assert.ok((await call("get_fight", {})).isError);
  assert.ok((await call("get_fight", { fight: "not an id" })).isError);
});

test("ranks are the site's default list, not the API's", async () => {
  const seen: string[] = [];
  await call("get_fighter", { fighter: JONES }, fakeData({}, seen));
  await call("get_fight", { fight: FIGHT }, fakeData({}, seen));
  assert.ok(seen.some(path => path === `/api/fighters/${JONES}?ranking=media`));
  assert.ok(seen.some(path => path === `/api/fights/${FIGHT}?ranking=media`));
});

test("leaderboards link officials to their own pages and give a unit", async () => {
  const seen: string[] = [];
  const { json } = await call("leaderboard", { board: "judge_agreement", limit: 5 }, fakeData({}, seen));
  assert.equal(json.rows[0].url.endsWith("/judges/a-judge"), true);
  assert.equal(json.rows[0].slug, "a-judge");
  assert.equal(json.rows[0].id, undefined);
  assert.equal(json.unit, "seconds");
  assert.match(seen[0], /fightsGroup=judges/);
  assert.match(seen[0], /limit=10/);
  const men = fakeData({}, seen);
  await call("leaderboard", { board: "wins", division: "Women's Flyweight" }, men);
  assert.match(seen[1], /includeWomen=1/);
  assert.ok((await call("leaderboard", { board: "wins", division: "Atomweight" })).isError);
  assert.ok((await call("leaderboard", { board: "nope" })).isError);
});

test("every tool reads public routes only", async () => {
  const seen: string[] = [];
  const data = fakeData({}, seen);
  const server = createMcpServer(data);
  const sample: Record<string, Record<string, unknown>> = {
    search: { query: "jon jones" }, get_fighter: { fighter: JONES, include: ["stat_ranks", "opposition", "news"] }, get_fight: { fight: FIGHT, include: ["tape_history"] },
    get_events: {}, get_event: { event: EVENT }, get_rankings: { date: "2019-06-01" }, get_live: {}, leaderboard: { board: "wins" },
    get_official: { name: "herb-dean", kind: "referee" }, browse_directory: { kind: "judges" }, get_place: { place: "nobody" }, get_controversial: {},
    get_news: {}, get_markets: {}, get_roster_changes: {}, get_awards: {},
  };
  assert.deepEqual(Object.keys(sample).sort(), server.tools.map(tool => tool.name).sort());
  for (const [name, args] of Object.entries(sample)) await server.call(name, args);
  assert.ok(seen.length > 10);
  for (const path of seen) assert.ok(publicApi(new URL(path, "http://localhost").pathname), path);
});

test("arguments are checked, and nulls count as absent", async () => {
  assert.equal((await call("get_fighter", { fighter: JONES, fight_limit: null, include: null })).isError, false);
  assert.match((await call("get_fighter", {})).text, /fighter is required/);
  assert.match((await call("get_fighter", { fighter: JONES, nope: 1 })).text, /Unknown argument nope/);
  assert.match((await call("get_fighter", { fighter: JONES, fight_limit: 9999 })).text, /fight_limit must be from 1 to 60/);
  assert.match((await call("get_fighter", { fighter: JONES, fight_limit: "5" })).text, /whole number/);
  assert.match((await call("get_fighter", { fighter: JONES, include: ["secrets"] })).text, /must be one of/);
  assert.match((await call("search", { query: "x".repeat(121) })).text, /limited to 120/);
  assert.match((await call("get_rankings", { date: "soon" })).text, /YYYY-MM-DD/);
});

test("events list the nearest upcoming card first and exclude rumours", async () => {
  const { json } = await call("get_events");
  assert.deepEqual(json.events.map((row: any) => row.name), ["UFC 339", "UFC 340"]);
  assert.deepEqual((await call("get_events", { when: "past" })).json.events.map((row: any) => row.name), ["UFC 309"]);
});

test("an answer over budget loses its largest parts and says so", () => {
  const huge = { id: "x", big: "y".repeat(MAX_RESULT_CHARS), small: "kept" };
  const result = fitted(huge) as any;
  assert.equal(result.big, undefined);
  assert.equal(result.small, "kept");
  assert.deepEqual(result.truncated.omitted, ["big"]);
  assert.ok(JSON.stringify(result).length <= MAX_RESULT_CHARS);
});

test("overload and failures become tool errors a model can retry, without internals", async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const busy = await call("get_events", {}, fakeData({ read: async () => { throw new OverloadedError("queue full"); } }));
    assert.ok(busy.isError);
    assert.match(busy.text, /busy/);
    const broken = await call("get_events", {}, fakeData({ read: async () => { throw new Error("SQLITE secret path"); } }));
    assert.ok(broken.isError);
    assert.equal(broken.text.includes("SQLITE"), false);
  } finally { console.log = quiet; }
});

test("tool calls in progress are capped, so a flood cannot take every worker", async () => {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const server = createMcpServer(fakeData({ read: async () => { await held; return []; } }));
  const running = Array.from({ length: 16 }, () => server.call("get_events", {}));
  const refused = await server.call("get_events", {});
  assert.ok(refused.isError);
  assert.match(refused.text, /busy/);
  release();
  await Promise.all(running);
  assert.equal((await server.call("get_events", {})).isError, false);
});

test("the tool list follows MCP's naming rules and promises no writes", () => {
  const { tools } = createMcpServer(fakeData());
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z_]{1,128}$/);
    assert.ok(tool.description.length > 20, tool.name);
    assert.equal((tool.annotations as any).readOnlyHint, true);
    assert.equal((tool.inputSchema as any).additionalProperties, false);
  }
});

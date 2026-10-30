import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMcpServer } from "./mcp-tools.ts";

test("public matchup history and MCP share the tournament cutoff", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "ufcsh-mcp-history-"));
  process.env.DATA_DIR = directory;
  process.env.DB_INIT = "1";
  process.env.NO_SYNC = "1";
  process.env.NODE_ENV = "test";
  const { db } = await import("./db.ts");
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const { resolvePublicApi } = await import("./api.ts");
  const ids = ["a000000000000001", "a000000000000002", "a000000000000003", "a000000000000004"];
  const names = ["First Fighter", "Second Fighter", "Earlier Opponent", "Later Opponent"];
  ids.forEach((id, i) => db.prepare("INSERT INTO fighters (id, name, norm_name) VALUES (?, ?, ?)").run(id, names[i], names[i].toLowerCase()));
  const event = "e000000000000001";
  const priorEvent = "e000000000000002";
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Tournament Fixture', '1995-01-01', 1)").run(event);
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Earlier Fixture', '1994-01-01', 1)").run(priorEvent);
  const bout = (id: string, card: string, ord: number, a: number, b: number) => {
    db.prepare(`INSERT INTO fights (id, event_id, ord, f1_id, f2_id, f1_name, f2_name,
      f1_outcome, f2_outcome, method, round, time, scheduled_rounds, detail_json, detail_fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'win', 'loss', 'SUB', '1', '1:00', 3, '{"type":"past"}', ?)`)
      .run(id, card, ord, ids[a], ids[b], names[a], names[b], Date.now());
  };
  bout("b000000000000001", priorEvent, 1, 1, 2);
  bout("b000000000000002", priorEvent, 0, 1, 3);
  const earlierMeeting = "b000000000000003";
  const earlierCommon = "b000000000000004";
  const target = "b000000000000005";
  const laterCommon = "b000000000000006";
  const laterMeeting = "b000000000000007";
  bout(earlierMeeting, event, 5, 0, 1);
  bout(earlierCommon, event, 4, 0, 2);
  bout(target, event, 3, 0, 1);
  bout(laterCommon, event, 2, 0, 3);
  bout(laterMeeting, event, 1, 0, 1);
  const read = (route: string) => resolvePublicApi(new URL(route, "http://localhost"));
  const matchup: any = await read(`/api/fights/${target}`);
  const meetings = new Map(matchup.head_to_head.map((row: any) => [row.fight_id, row.before_fight]));
  assert.equal(meetings.get(earlierMeeting), true);
  assert.equal(meetings.get(laterMeeting), false);
  const server = createMcpServer({ read, fanScores: async () => null, markets: () => [], liveOdds: async () => null });
  const result = await server.call("get_fight", { fight: target, include: ["history_between"] });
  assert.equal(result.isError, false);
  const answer = JSON.parse(result.text);
  assert.deepEqual(answer.meetings_before.map((row: any) => row.fight_id), [earlierMeeting]);
  assert.deepEqual(answer.meetings_after.map((row: any) => row.fight_id), [laterMeeting]);
  assert.deepEqual(answer.common_opponents.map((row: any) => row.opponent), [names[2]]);
});

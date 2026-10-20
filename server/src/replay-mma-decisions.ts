import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { preChangeBackupPath } from "./backup-retention.ts";
import { compatibleJudgeCards, type JudgeCard } from "./judge-scorecards.ts";
import { mergeMmaJudgeRounds } from "./mma-judge-rounds.ts";
import { storedDeductions } from "./point-deduction-rules.ts";

/** Replay a successful public-source import when the production host cannot
 * reach MMA Decisions. No db.ts import, migrations, network or scheduler.
 * Only missing source fields, improved round panels and successful read stamps
 * are eligible; a changed bout or existing source record is preserved. */
const identity = ["id", "event_id", "date", "f1_id", "f2_id", "f1_name", "f2_name", "method", "round"] as const;
type Identity = { [K in typeof identity[number]]: string };
type Row = Identity & { detail_json: string | null; judge_rounds_json: string | null; deductions_json: string | null;
  media_scores_json: string | null; deductions_checked_at: number | null };
type Entry = Identity & { checkedAt: number; deductions: string | null; media: string | null; judges: string | null };
export type MmaPatch = { version: 1; since: number; createdAt: number; entries: Entry[] };
const select = `SELECT f.*, e.date FROM fights f JOIN events e ON e.id = f.event_id`;
const sourceUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === "https://mmadecisions.com" && !url.username && !url.password && !url.search && !url.hash
      && /^\/decision\/\d+\/[^/]+$/.test(url.pathname);
  } catch { return false; }
};
const parse = (json: string | null): any => { try { return JSON.parse(json ?? "null"); } catch { return null; } };

function validate(entry: Entry, since: number, createdAt: number): void {
  if (!identity.every(key => typeof entry[key] === "string") || !/^[a-f0-9]{16}$/.test(entry.id)
    || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !entry.method.endsWith("DEC")
    || !Number.isSafeInteger(entry.checkedAt) || entry.checkedAt < since || entry.checkedAt > createdAt)
    throw new Error("Invalid MMA Decisions entry identity or successful-read date");
  if (entry.deductions !== null) {
    const record = storedDeductions(entry.deductions);
    if (!record || !sourceUrl(record.sourceUrl)) throw new Error("Invalid deduction provenance or points");
  }
  if (entry.media !== null) {
    const record = parse(entry.media);
    if (!sourceUrl(record?.sourceUrl) || record.source !== "MMA Decisions" || !Array.isArray(record.items)
      || !record.items.every((card: any) => card && [card.name, card.outlet, card.url].every(value => typeof value === "string")
        && [card.f1Score, card.f2Score].every(value => Number.isInteger(value) && value > 0 && value <= 50))
      || (record.dropped !== undefined && !Array.isArray(record.dropped))) throw new Error("Invalid media provenance or scores");
  }
  if (entry.judges !== null) {
    const record = parse(entry.judges);
    const cards: JudgeCard[] = record?.judges;
    if (!sourceUrl(record?.sourceUrl) || !Array.isArray(cards) || !cards.length || cards.length > 3
      || compatibleJudgeCards([], cards).length !== cards.length
      || cards.some(card => card.rounds?.length !== Number(entry.round))) throw new Error("Invalid round-card provenance, totals or bout length");
  }
}

/** Only stamps from this explicitly bounded successful crawl can clear an
 * unread item, including a completed search that found no matching page. */
export function exportMmaDecisions(source: DatabaseSync, since: number, createdAt = Date.now()): MmaPatch {
  if (!Number.isSafeInteger(since) || since <= 0 || since > createdAt) throw new Error("Expected this import's start timestamp");
  const rows = source.prepare(`${select} WHERE e.complete = 1 AND f.method LIKE '%DEC' AND f.deductions_checked_at >= ?`).all(since) as Row[];
  const entries = rows.map(row => {
    const prior = parse(row.judge_rounds_json);
    const rounds = sourceUrl(prior?.sourceUrl) && Array.isArray(prior?.judges)
      ? compatibleJudgeCards([], prior.judges).filter((card: JudgeCard) => card.rounds?.length === Number(row.round)) : [];
    const entry: Entry = { ...Object.fromEntries(identity.map(key => [key, row[key]])) as Identity,
      checkedAt: row.deductions_checked_at!, deductions: row.deductions_json, media: row.media_scores_json,
      judges: rounds.length ? JSON.stringify({ ...prior, judges: rounds }) : null };
    validate(entry, since, createdAt);
    return entry;
  });
  return { version: 1, since, createdAt, entries };
}

export function replayMmaDecisions(target: DatabaseSync, patch: MmaPatch, apply = false) {
  if (patch.version !== 1 || !Number.isSafeInteger(patch.since) || patch.since <= 0
    || !Number.isSafeInteger(patch.createdAt) || patch.createdAt < patch.since || !Array.isArray(patch.entries)) throw new Error("Invalid MMA Decisions patch");
  for (const entry of patch.entries) validate(entry, patch.since, patch.createdAt);
  if (new Set(patch.entries.map(entry => entry.id)).size !== patch.entries.length) throw new Error("Duplicate patch bout");
  const result = { entries: patch.entries.length, fights: 0, fields: 0, checked: 0, conflicts: 0, identitySkipped: 0 };
  if (apply) target.exec("BEGIN IMMEDIATE");
  try {
    for (const entry of patch.entries) {
      const row = target.prepare(`${select} WHERE f.id = ?`).get(entry.id) as Row | undefined;
      if (!row || identity.some(key => row[key] !== entry[key])) { result.identitySkipped++; continue; }
      const fields: [string, string | number][] = [];
      for (const [column, value] of [["deductions_json", entry.deductions], ["media_scores_json", entry.media]] as const) {
        if (value === null || row[column] === value) continue;
        if (row[column] !== null) { result.conflicts++; continue; }
        fields.push([column, value]);
      }
      const incoming = parse(entry.judges);
      if (incoming) {
        const detail = parse(row.detail_json), prior = parse(row.judge_rounds_json);
        const judges = mergeMmaJudgeRounds(Array.isArray(detail?.judges) ? detail.judges : [],
          Array.isArray(prior?.judges) ? prior.judges : [], incoming.judges, Number(row.round));
        if (judges) fields.push(["judge_rounds_json", JSON.stringify({ ...incoming,
          source: typeof prior?.source === "string" && prior.source.includes("Verdict") ? "MMA Decisions + Verdict MMA" : "MMA Decisions", judges })]);
      }
      if ((row.deductions_checked_at ?? 0) < entry.checkedAt) { fields.push(["deductions_checked_at", entry.checkedAt]); result.checked++; }
      if (!fields.length) continue;
      result.fights++; result.fields += fields.length;
      if (apply) target.prepare(`UPDATE fights SET ${fields.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .run(...fields.map(([, value]) => value), entry.id);
    }
    if (apply) target.exec("COMMIT");
    return result;
  } catch (error) { if (apply) target.exec("ROLLBACK"); throw error; }
}

if (import.meta.main) {
  const [mode, databaseFile, patchFile, option] = process.argv.slice(2);
  if (!databaseFile || !patchFile || !["export", "replay"].includes(mode)
    || (mode === "replay" && option && option !== "--apply"))
    throw new Error("Usage: replay-mma-decisions.ts export SOURCE.db PATCH.json --since=TIMESTAMP | replay TARGET.db PATCH.json [--apply]");
  const apply = mode === "replay" && option === "--apply";
  const database = new DatabaseSync(databaseFile, { readOnly: !apply });
  if (apply) database.exec("PRAGMA busy_timeout = 5000");
  try {
    if (mode === "export") {
      const patch = exportMmaDecisions(database, Number(option?.replace(/^--since=/, "")));
      writeFileSync(patchFile, JSON.stringify(patch), { mode: 0o600 });
      console.log(JSON.stringify({ exported: patch.entries.length }));
    } else {
      const patch = JSON.parse(readFileSync(patchFile, "utf8")) as MmaPatch;
      if (apply) {
        const destination = await preChangeBackupPath(databaseFile, "mma-decisions");
        await backup(database, destination);
        const copy = new DatabaseSync(destination, { readOnly: true });
        try { if (copy.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw new Error("MMA Decisions backup integrity failed"); }
        finally { copy.close(); }
        console.log("Verified backup before MMA Decisions replay");
      }
      console.log(JSON.stringify({ applied: apply, ...replayMmaDecisions(database, patch, apply) }));
      if (apply && database.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw new Error("Post-replay integrity failed");
    }
  } finally { database.close(); }
}

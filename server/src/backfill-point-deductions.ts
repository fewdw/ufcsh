import { pointDeductionCandidates, readPointDeductions } from "./point-deductions.ts";

/** Read every decision's MMA Decisions page once for points taken by the
 *  referee. Usage: node src/backfill-point-deductions.ts [--concurrency=2] [--recheck]
 *  Only stated deductions are stored; the matchup shows them only where they
 *  fit every judge's round card (point-deductions.ts). */

const options = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=", 2) as [string, string]));
const concurrency = Math.max(1, Math.min(8, Number(options.get("concurrency") ?? 2)));
const fights = pointDeductionCandidates(options.has("recheck"));
console.log(`Point deductions: ${fights.length} decisions to read`);
const result = await readPointDeductions(fights, concurrency, (stats, pages) =>
  console.log(`Point deductions: ${stats.events} events, ${stats.decisions}/${pages} pages, ${stats.matched} matched, ${stats.failed} failed`));
console.log(`Point deductions done: ${JSON.stringify(result)}`);

if (result.failed) process.exitCode = 1;

import type { ServerResponse } from "node:http";
import { OverloadedError } from "./response-cache.ts";
import { log } from "./util.ts";

const messages = new WeakMap<ServerResponse, string>();

/** A request that failed for a reason its handler did not expect (a bug, a
 *  locked database, a source that did not answer): logged, and kept with its
 *  response so Admin → Errors can show the error beside the address. Refusals
 *  a handler words itself (`ScoringError`) are not failures and never come here. */
export function reportFailure(res: ServerResponse, where: string, error: unknown): void {
  const message = String(error);
  // A full queue or a busy database is a known state, not a bug: one line, no stack.
  const known = error instanceof OverloadedError || /database is locked|SQLITE_BUSY/.test(message);
  log(`${where} failed:`, !known && error instanceof Error && error.stack ? error.stack : message);
  messages.set(res, message);
}

/** What `reportFailure` kept for this response, if it failed. */
export function failureMessage(res: ServerResponse): string | undefined {
  return messages.get(res);
}

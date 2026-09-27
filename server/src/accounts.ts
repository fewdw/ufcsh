import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { BugCheck } from "./bugs.ts";
import type { BetStore } from "./bets.ts";
import type { CommentStore } from "./comments.ts";
import type { PredictionStore } from "./predictions.ts";
import type { ScoringStore } from "./scoring.ts";
import { clerkClient, publicAccount } from "./scoring-http.ts";

/** Clerk owns accounts; this site keeps only what a profile shows. Whatever a
 *  reader does at Clerk — deleting the account, unlinking Google, changing
 *  their picture — is picked up here by asking Clerk, so nothing needs to be
 *  configured there and a missed notification cannot leave data behind. */

export type AccountStores = { scores: ScoringStore; comments: CommentStore; predictions: PredictionStore; bets: BetStore };
type Clerk = {
  users: {
    getUserList(params: { userId: string[]; limit: number }): Promise<{ data: { id: string; hasImage: boolean; imageUrl: string; createdAt: number }[] }>;
    getUser(userId: string): Promise<unknown>;
  };
};

/** Everything a deleted account leaves on the site, erased in one transaction:
 *  cards, picks and bets are removed from every average and board, comments
 *  become placeholders, and the username is freed. */
export function forgetAccount(stores: AccountStores, user: string): void {
  const { db } = stores.scores;
  db.exec("BEGIN IMMEDIATE");
  try {
    stores.comments.forgetAuthor(user);
    stores.predictions.forget(user);
    stores.bets.forget(user);
    stores.scores.forget(user);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Clerk user ids. Anything else (seeded test accounts on dev) is never asked
 *  about, so it cannot be mistaken for a deleted account. */
const CLERK_ID = /^user_[A-Za-z0-9]{20,40}$/;
const BATCH = 100;
export const ACCOUNT_SYNC_MS = 5 * 60_000;
const status = { lastSuccessAt: 0, lastError: "", running: false };

/** One pass over every account. Pictures follow Clerk; an account Clerk does
 *  not return is only forgotten after Clerk answers 404 for it by id, so an
 *  outage or a short page can never erase anyone. */
export async function syncAccounts(stores: AccountStores, clerk: Clerk | null = clerkClient()): Promise<{ checked: number; forgotten: number }> {
  if (!clerk || status.running) return { checked: 0, forgotten: 0 };
  status.running = true;
  let checked = 0, forgotten = 0;
  try {
    const accounts = stores.scores.accounts().filter(account => CLERK_ID.test(account.userId));
    for (let index = 0; index < accounts.length; index += BATCH) {
      const batch = accounts.slice(index, index + BATCH);
      const { data } = await clerk.users.getUserList({ userId: batch.map(account => account.userId), limit: BATCH });
      const found = new Map(data.map(user => [user.id, user]));
      for (const account of batch) {
        checked++;
        const user = found.get(account.userId);
        if (user) {
          const { imageUrl, joinedAt } = publicAccount(user);
          if (imageUrl !== account.imageUrl || (joinedAt != null && joinedAt !== account.joinedAt)) stores.scores.setImage(account.userId, imageUrl, joinedAt);
          continue;
        }
        try { await clerk.users.getUser(account.userId); }
        catch (error) {
          if (!isClerkAPIResponseError(error) || error.status !== 404) throw error;
          forgetAccount(stores, account.userId);
          forgotten++;
        }
      }
    }
    status.lastSuccessAt = Date.now();
    status.lastError = "";
    return { checked, forgotten };
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally { status.running = false; }
}

/** The admin Bugs board: a sync that keeps failing means deleted accounts are
 *  still on show. It retries by itself; the fix is usually the Clerk key. */
export function accountSyncCheck(): BugCheck {
  const stale = Boolean(clerkClient()) && Date.now() - status.lastSuccessAt > 4 * ACCOUNT_SYNC_MS && Boolean(status.lastError);
  const items = stale ? [{
    key: "account-sync", title: "Accounts are not syncing with Clerk", level: "must" as const,
    facts: [["Last success", status.lastSuccessAt ? new Date(status.lastSuccessAt).toISOString() : "not since this start"], ["Error", status.lastError]] as [string, string][],
    links: [], actions: [],
  }] : [];
  return {
    id: "account-sync", group: "Accounts", label: "Clerk account sync",
    description: "Deleted accounts are erased and pictures refreshed every five minutes. Retries on its own; check CLERK_SECRET_KEY if it keeps failing.",
    level: items.length ? "must" : "ok", total: items.length, items,
  };
}

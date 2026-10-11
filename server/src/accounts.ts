import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { BugCheck } from "./bugs.ts";
import type { BetStore } from "./bets.ts";
import type { CommentStore } from "./comments.ts";
import type { PredictionStore } from "./predictions.ts";
import { identifyScorer, type ScoringStore } from "./scoring.ts";
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

type ClerkDirectory = {
  users: {
    getUserList(params: { userId: string[]; limit: number }): Promise<{ data: {
      id: string; primaryEmailAddressId: string | null; emailAddresses: { id: string; emailAddress: string }[];
      lastSignInAt: number | null; lastActiveAt?: number | null; externalAccounts?: { provider: string }[];
    }[] }>;
  };
};
type ClerkFacts = { email: string | null; lastSignInAt: number | null; lastActiveAt: number | null; signIn: string[] };
let clerkFacts: { at: number; byUser: Map<string, ClerkFacts> } | null = null;
const CLERK_FACTS_MS = 5 * 60_000;

/** Emails and sign-in times, which only Clerk holds. Read in batches and kept
 *  five minutes, so paging through the list never hammers Clerk. */
async function readClerkFacts(userIds: string[], clerk: ClerkDirectory | null): Promise<Map<string, ClerkFacts> | null> {
  if (!clerk) return null;
  if (clerkFacts && Date.now() - clerkFacts.at < CLERK_FACTS_MS && userIds.every(id => clerkFacts!.byUser.has(id))) return clerkFacts.byUser;
  const byUser = new Map<string, ClerkFacts>();
  const ids = userIds.filter(id => CLERK_ID.test(id));
  for (let index = 0; index < ids.length; index += BATCH) {
    const { data } = await clerk.users.getUserList({ userId: ids.slice(index, index + BATCH), limit: BATCH });
    for (const user of data) {
      byUser.set(user.id, {
        email: user.emailAddresses.find(address => address.id === user.primaryEmailAddressId)?.emailAddress ?? null,
        lastSignInAt: user.lastSignInAt ?? null, lastActiveAt: user.lastActiveAt ?? null,
        signIn: [...new Set((user.externalAccounts ?? []).map(account => account.provider.replace(/^oauth_/, "")))],
      });
    }
  }
  clerkFacts = { at: Date.now(), byUser };
  return byUser;
}

/** Every account for Admin → Accounts: who, since when, how active, and
 *  whether comments are muted. Deleted accounts are listed as deleted. */
export async function adminAccounts(stores: Pick<AccountStores, "scores">, clerk: ClerkDirectory | null = clerkClient() as unknown as ClerkDirectory | null, now = Date.now()) {
  const rows = stores.scores.db.prepare(`
    SELECT s.user_id, s.public_id, s.username, s.username_key, s.image_url, s.created_at, s.deleted_at, s.comments_public,
      (SELECT COUNT(*) FROM scorecards c WHERE c.user_id = s.user_id) AS cards,
      (SELECT MAX(updated_at) FROM scorecards c WHERE c.user_id = s.user_id) AS card_at,
      (SELECT COUNT(*) FROM predictions p WHERE p.user_id = s.user_id AND p.pick_json IS NOT NULL) AS predictions,
      (SELECT MAX(updated_at) FROM predictions p WHERE p.user_id = s.user_id) AS prediction_at,
      (SELECT COUNT(*) FROM bets b WHERE b.user_id = s.user_id) AS bets,
      (SELECT MAX(placed_at) FROM bets b WHERE b.user_id = s.user_id) AS bet_at,
      (SELECT COUNT(*) FROM comments m WHERE m.user_id = s.user_id AND m.deleted_at IS NULL AND m.removed_at IS NULL) AS comments,
      (SELECT MAX(created_at) FROM comments m WHERE m.user_id = s.user_id) AS comment_at,
      (SELECT muted_until FROM commenter_sanctions x WHERE x.user_id = s.user_id AND x.muted_until > ?) AS muted_until
    FROM scorers s ORDER BY s.created_at DESC
  `).all(now) as Record<string, string | number | null>[];
  let facts: Map<string, ClerkFacts> | null = null;
  let clerkError: string | null = null;
  try { facts = await readClerkFacts(rows.filter(row => row.deleted_at == null).map(row => String(row.user_id)), clerk); }
  catch (error) { clerkError = error instanceof Error ? error.message : String(error); }
  const number = (value: unknown) => value == null ? null : Number(value);
  return {
    generatedAt: now,
    clerk: facts ? "ok" : clerk ? "unavailable" : "not configured",
    clerkError,
    accounts: rows.map(row => {
      const fact = facts?.get(String(row.user_id));
      const activity = [row.card_at, row.prediction_at, row.bet_at, row.comment_at].map(number).filter((at): at is number => at != null);
      return {
        ...identifyScorer(row as { public_id: string; username: string | null; username_key: string | null; image_url: string | null }),
        joinedAt: number(row.created_at), deletedAt: number(row.deleted_at),
        commentsPublic: row.comments_public === 1, mutedUntil: number(row.muted_until),
        cards: Number(row.cards), predictions: Number(row.predictions), bets: Number(row.bets), comments: Number(row.comments),
        lastActivityAt: activity.length ? Math.max(...activity) : null,
        email: fact?.email ?? null, lastSignInAt: fact?.lastSignInAt ?? null, lastActiveAt: fact?.lastActiveAt ?? null, signIn: fact?.signIn ?? [],
      };
    }),
  };
}

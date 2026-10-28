import type { Book } from "./polymarket.ts";
import { probability } from "./polymarket-math.ts";

export type Books = [Book | undefined, Book | undefined];
/** Full snapshots and sized price deltas only. Top-of-book frames alone
 * cannot establish depth. Every returned book belongs to its declared token. */
export function updateMarketBooks(
  tokens: [string, string],
  previous: Books,
  message: any,
): { books: Books; index: number }[] {
  if (!message || typeof message !== "object") return [];
  const changes =
    message.event_type === "price_change" &&
    Array.isArray(message.price_changes)
      ? message.price_changes
      : [message];
  const books = [...previous] as Books;
  const changed = new Set<number>();
  for (const change of changes) {
    if (!change || typeof change !== "object") continue;
    const index = tokens.indexOf(change.asset_id);
    if (index < 0 || index > 1) continue;
    if (
      message.event_type === "book" &&
      Array.isArray(message.bids) &&
      Array.isArray(message.asks)
    )
      books[index] = message;
    else if (
      message.event_type === "price_change" &&
      books[index] &&
      ["BUY", "SELL"].includes(change.side)
    ) {
      const p = probability(change.price),
        size = Number(change.size);
      if (
        p == null ||
        !Number.isFinite(size) ||
        size < 0 ||
        change.size == null ||
        change.size === ""
      )
        continue;
      const side = change.side === "BUY" ? "bids" : "asks";
      const levels = (books[index]![side] ?? []).filter(
        (l) => Number(l.price) !== p,
      );
      if (size > 0) levels.push({ price: String(p), size: String(size) });
      books[index] = { ...books[index]!, [side]: levels };
    } else continue;
    changed.add(index);
  }
  return [...changed].map((index) => ({ books, index }));
}

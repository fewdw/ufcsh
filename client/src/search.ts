import { normalizeSearch } from "./format.ts";

/** Forgiving matching for the filters typed into lists: case, accents,
 *  spacing and punctuation never matter ("tmobile" finds "T-Mobile Arena"),
 *  words can come in any order or be cut short, and when nothing matches that
 *  way a longer word may carry a typo or two ("harb dean" finds Herb Dean).
 *  The server's search follows the same rules (`server/src/fuzzy.ts`). */

/** Typos a typed word of this length may carry. */
const allowedEdits = (length: number) => (length < 4 ? 0 : length < 7 ? 1 : length < 10 ? 2 : 3);

/** Fewest edits turning `word` into some prefix of `target` (a swapped pair
 *  counts once), or Infinity past `limit`. */
function prefixDistance(word: string, target: string, limit: number): number {
  let prevPrev: number[] = [];
  let prev = Array.from({ length: target.length + 1 }, (_, j) => j);
  for (let i = 1; i <= word.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= target.length; j++) {
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (word[i - 1] === target[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && word[i - 1] === target[j - 2] && word[i - 2] === target[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1);
      row.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return Infinity;
    prevPrev = prev;
    prev = row;
  }
  const best = Math.min(...prev);
  return best <= limit ? best : Infinity;
}

type Needle = { words: string[]; joined: string; text: string };

function strictMatch(needle: Needle, haystack: string): boolean {
  if (haystack.includes(needle.text)) return true;
  const compact = haystack.replaceAll(" ", "");
  if (compact.includes(needle.joined)) return true;
  // A word of one or two letters has to start a word, or "t" would be found anywhere.
  const words = haystack.split(" ");
  return needle.words.every((word) => (word.length > 2 ? compact.includes(word) : words.some((target) => target.startsWith(word))));
}

function looseMatch(needle: Needle, haystack: string): boolean {
  const targets = haystack.split(" ");
  return needle.words.every((word) => {
    const limit = /\d/.test(word) ? 0 : allowedEdits(word.length);
    return targets.some((target) => target.startsWith(word) || (limit > 0 && prefixDistance(word, target, limit) <= limit));
  });
}

/** The rows a typed query finds: every row it matches as typed, or, only when
 *  there are none, the rows it matches allowing for typos. */
export function searchList<T>(rows: T[], query: string, text: (row: T) => string): T[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return rows;
  const words = normalized.split(" ");
  const needle: Needle = { words, joined: words.join(""), text: normalized };
  const haystacks = rows.map((row) => normalizeSearch(text(row)));
  const strict = rows.filter((_, index) => strictMatch(needle, haystacks[index]));
  return strict.length ? strict : rows.filter((_, index) => looseMatch(needle, haystacks[index]));
}

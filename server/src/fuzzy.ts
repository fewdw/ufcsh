import { normName } from "./util.ts";

/**
 * Typo-tolerant text matching for search fallbacks. Every query word must
 * match a different word of the target, either as a prefix ("volk" ->
 * "volkanovski") or within a few edits of one ("vilk" -> "volk…"). Words
 * containing digits ("300", "ufc 229") must match exactly so event numbers
 * never drift to a neighbour.
 */

/** Edits a query word of this length may carry and still count as a match. */
export function allowedEdits(length: number): number {
  if (length < 4) return 0;
  if (length < 7) return 1;
  if (length < 10) return 2;
  return 3;
}

/**
 * Smallest edit distance between `query` and any prefix of `target`
 * (optimal string alignment, so a swapped pair of letters is one edit).
 * Returns Infinity once the distance must exceed `limit`.
 */
export function prefixDistance(query: string, target: string, limit: number): number {
  const n = query.length;
  const m = target.length;
  if (!n) return 0;
  if (!m) return n <= limit ? n : Infinity;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = query[i - 1] === target[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && query[i - 1] === target[j - 2] && query[i - 2] === target[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return Infinity;
    prevPrev = prev;
    prev = row;
  }
  // Any prefix of the target may end the match, so take the best column.
  const best = Math.min(...prev);
  return best <= limit ? best : Infinity;
}

function wordDistance(query: string, target: string): number {
  if (target.startsWith(query)) return 0;
  if (/\d/.test(query) || /\d/.test(target)) return Infinity;
  const limit = allowedEdits(query.length);
  if (!limit) return Infinity;
  return prefixDistance(query, target, limit);
}

export type FuzzyTarget = { words: string[]; compact: string };

export function fuzzyTarget(...texts: (string | null | undefined)[]): FuzzyTarget {
  const words = texts.flatMap((text) => normName(text).split(" ")).filter(Boolean);
  return { words, compact: normName(texts[0]).replace(/ /g, "") };
}

/**
 * Total edits needed for `query` to match `target`, or Infinity when it does
 * not. Query words are matched to distinct target words in any order.
 */
export function fuzzyScore(query: string, target: FuzzyTarget, memo = new Map<string, number>()): number {
  const words = normName(query).split(" ").filter(Boolean);
  if (!words.length || !target.words.length) return Infinity;
  const used = new Set<number>();
  let total = 0;
  // Longer words are more distinctive, so they claim their target word first.
  for (const word of [...words].sort((a, b) => b.length - a.length)) {
    let best = Infinity;
    let bestIndex = -1;
    target.words.forEach((candidate, index) => {
      if (used.has(index)) return;
      // Names share most of their words, so one query scans few distinct pairs.
      const key = `${word} ${candidate}`;
      let distance = memo.get(key);
      if (distance === undefined) { distance = wordDistance(word, candidate); memo.set(key, distance); }
      if (distance < best) { best = distance; bestIndex = index; }
    });
    if (bestIndex < 0) return compactScore(words, target);
    used.add(bestIndex);
    total += best;
  }
  return Math.min(total, compactScore(words, target));
}

/** "jonjones" typed as one run against the whole name. */
function compactScore(words: string[], target: FuzzyTarget): number {
  const joined = words[0];
  if (words.length !== 1 || joined.length < 7 || !target.compact) return Infinity;
  if (target.compact.startsWith(joined)) return 0;
  if (/\d/.test(joined)) return Infinity;
  return prefixDistance(joined, target.compact, allowedEdits(joined.length));
}

/**
 * Splits "a vs b", "a v b", "a versus b" or "a @ b" into its two sides, or
 * returns null for a query that names only one side.
 */
export function splitMatchup(query: string): [string, string] | null {
  const parts = normName(query.replace(/@/g, " vs ")).split(/\s+(?:vs|v|versus)\s+/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}

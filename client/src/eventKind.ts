/**
 * Which tier a card belongs to. The promotion has never had a field for this:
 * it is carried entirely by how an event is named, and the naming has changed
 * several times in thirty years. Every event resolves to exactly one of the
 * two, so the pair always partitions the whole list.
 */
export type EventKind = "ppv" | "fight_night";

/** The broadcast and streaming series, in every spelling the archive uses.
 *  Checked before anything else so a numbered entry in one of them — "UFC
 *  Fight Night 42" — is read as the series it belongs to, not as a numbered
 *  pay-per-view. */
const FIGHT_NIGHT_SERIES = [
  /^ufc\s+fight\s*night\b/,
  /^ufc\s+on\s+/, // on FOX, FX, FUEL TV, Versus, ESPN, ABC
  /^ufc\s+live\b/,
  /^the\s+ultimate\s+fighter\b/,
  /^noche\s+ufc\b/,
];

const PPV_PATTERNS = [
  // The numbered run, UFC 1 to today: almost every pay-per-view ever sold.
  /^ufc\s+\d+\b/,
  // Before numbering settled, the pay-per-views carried names instead:
  // Ultimate Ultimate '95 and '96, Ultimate Japan, Ultimate Brazil.
  /^ufc\s*[-–—]\s*ultimate\b/,
  // A titled card that still carries a number is the promotion marking an
  // occasion rather than starting a series — UFC Freedom 250 in Washington.
  /^ufc\s+[a-z']+\s+\d+\b/,
];

/**
 * The tier of a card, from its name.
 *
 * Fight Night is the default rather than a third "unknown" bucket: the
 * promotion runs several of them for every pay-per-view, and a new
 * pay-per-view is numbered on announcement, so an unrecognised name is far
 * likelier to be a Fight Night than a card this function has never seen.
 */
export function eventKind(name: string): EventKind {
  const value = name.trim().toLowerCase();
  if (FIGHT_NIGHT_SERIES.some((pattern) => pattern.test(value))) return "fight_night";
  return PPV_PATTERNS.some((pattern) => pattern.test(value)) ? "ppv" : "fight_night";
}

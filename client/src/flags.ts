/**
 * A nationality drawn as its flag. The emoji is built from the ISO code, so
 * nothing is downloaded and it follows the reader's own font in either theme.
 */

/** Sherdog files the home nations separately; their flags are emoji tag
 *  sequences rather than a pair of regional indicators. */
const SUBDIVISIONS: Record<string, string> = {
  EN: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  SC: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
  WA: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}",
  UK: "\u{1F1EC}\u{1F1E7}",
};

export function flagEmoji(code: string | null | undefined): string | null {
  const upper = (code ?? "").trim().toUpperCase();
  if (SUBDIVISIONS[upper]) return SUBDIVISIONS[upper];
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  return String.fromCodePoint(...[...upper].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

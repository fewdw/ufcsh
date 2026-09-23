import { createHash } from "node:crypto";
import { ScoringError } from "./scoring.ts";

/**
 * What a comment has to pass before it is stored. The policy is light-touch:
 * no word is banned on its own, swearing included. What is refused is the
 * shape of abuse rather than its vocabulary — floods, screaming, link and
 * contact spam, invisible or spoofing characters, telling someone to harm
 * themselves, and comments that are nothing but profanity or slurs. Everything
 * refused is refused with a reason the writer can act on.
 */
export const COMMENT_MAX = 2000;
export const COMMENT_MAX_LINES = 40;

export class ModerationError extends ScoringError {
  constructor(message: string) { super(422, message); }
}

// Zero-width and joiner characters (except the ZWJ inside emoji sequences),
// byte-order marks, and every bidirectional override or isolate: they hide
// text, spoof names and reverse what a line appears to say.
const INVISIBLE = /[\u00AD\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const COMBINING_RUN = /(\p{M}{2})\p{M}+/gu;

/** The text as it will be stored and shown: normalised, invisible characters
 *  removed, stacked diacritics ("Zalgo") trimmed, runs of a single character
 *  shortened, and blank lines collapsed. */
export function cleanCommentBody(value: unknown): string {
  if (typeof value !== "string") throw new ModerationError("Write something first.");
  if (value.length > COMMENT_MAX * 4) throw new ModerationError(`Comments are at most ${COMMENT_MAX.toLocaleString("en-US")} characters.`);
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .replace(COMBINING_RUN, "$1")
    // "GOOOOOOOOOOOO" keeps its enthusiasm at six letters.
    .replace(/(\P{N})\1{6,}/gu, "$1$1$1$1$1$1")
    .split("\n").map(line => line.replace(/[ \u00A0]+$/u, "").replace(/ {3,}/g, "  ")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A stable fingerprint of what a comment says, ignoring case, spacing and
 *  punctuation, so a copy-pasted comment is recognised however it is dressed. */
export function bodyKey(body: string): string {
  const letters = body.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  return createHash("sha256").update(letters).digest("hex").slice(0, 32);
}
export const keyLength = (body: string) => body.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").length;

// Leetspeak folded back to letters for the density check only; the comment
// itself is never rewritten.
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
const fold = (word: string) => word.toLowerCase().replace(/[013457@$!]/g, char => LEET[char] ?? char).replace(/[^a-z]/g, "");

/** Strong language. Used only to measure how much of a comment is swearing. */
const PROFANE = /^(?:f+u+c*k+\w*|fk|fck\w*|sh+i+t+\w*|bullshit|cunts?|bitch\w*|dicks?|dickhead\w*|cocks?|cocksucker\w*|puss(?:y|ies)|twats?|wank\w*|ass|asses|asshole\w*|arse|arsehole\w*|bastards?|motherfuck\w*|mf|stfu|gtfo|damn\w*|piss\w*|whores?|sluts?|cum|cumming|jizz|pricks?|douche\w*)$/;
/** Slurs. Allowed, but a comment built out of them is not a comment. */
const SLUR = /^(?:nigg\w*|nig(?:a|as|ah|uh)|fags?|fagg\w*|retard\w*|tards?|kikes?|spics?|chinks?|gooks?|trann(?:y|ies)|wetbacks?|beaners?|coons?|dykes?|pakis?)$/;

const SELF_HARM = /\b(?:kys|kill\s*(?:your|ur|yo|you)\s*sel(?:f|ves)|neck\s*(?:your|ur|you)\s*sel(?:f|ves)|hang\s*(?:your|ur|you)\s*sel(?:f|ves)|end\s*(?:your|ur)\s*(?:own\s*)?life|drink\s*bleach)\b/i;
const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|io|co|gg|me|tv|ly|xyz|ru|info|biz|site|online|shop|top|app|link|live|bet|club|cc|to|us|uk|ca|au|de|fr|es|it|nl|pl|in|cn|jp|br|vip|win|fun|store|click|pro|tk|ml|ga|cf|gq)\b(?:\/\S*)?/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
// Grouped like a phone number (555-123-4567, (555) 123 4567, +44 20 7946 0958),
// so a row of scorecards like "29-28 29-28 29-28" never trips it.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\+\d{1,3}[\s.-]\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/;

export type CommentPolicy = {
  /** Accounts younger than a day cannot post links: the commonest spam. */
  newAccount: boolean;
};

export function linkCount(body: string): number {
  return body.match(URL_PATTERN)?.length ?? 0;
}

/** Throws a ModerationError naming the first rule a cleaned comment breaks. */
export function checkComment(body: string, policy: CommentPolicy): void {
  if (!body) throw new ModerationError("Write something first.");
  if (body.length > COMMENT_MAX) throw new ModerationError(`Comments are at most ${COMMENT_MAX.toLocaleString("en-US")} characters.`);
  if (body.split("\n").length > COMMENT_MAX_LINES) throw new ModerationError(`Comments are at most ${COMMENT_MAX_LINES} lines.`);
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(body)) throw new ModerationError("Say something about the fight.");

  const links = linkCount(body);
  if (links && policy.newAccount) throw new ModerationError("New accounts can’t post links yet. Try again tomorrow.");
  if (links > 2) throw new ModerationError("Comments can include at most two links.");
  if (EMAIL.test(body)) throw new ModerationError("Please don’t post email addresses — yours or anyone else’s.");
  if (PHONE.test(body)) throw new ModerationError("Please don’t post phone numbers.");

  const withoutLinks = body.replace(URL_PATTERN, " ");
  if (withoutLinks.split(/\s+/).some(word => [...word].length > 60)) throw new ModerationError("That comment has a word over 60 characters long.");

  const letters = withoutLinks.match(/\p{L}/gu) ?? [];
  const upper = withoutLinks.match(/\p{Lu}/gu) ?? [];
  if (letters.length >= 24 && upper.length / letters.length > 0.8) throw new ModerationError("Ease off the caps lock — it reads as shouting.");

  // Also read with spaced-out letters closed up: "k i l l yourself".
  const plain = body.replace(/[^\p{L}\s]/gu, "");
  if (SELF_HARM.test(plain) || SELF_HARM.test(plain.replace(/\b(\p{L}) (?=\p{L}\b)/gu, "$1"))) throw new ModerationError("Telling people to hurt themselves isn’t allowed here.");

  const words = withoutLinks.split(/[^\p{L}\p{N}@$!]+/u).map(fold).filter(Boolean);
  const slurs = words.filter(word => SLUR.test(word)).length;
  const profane = words.filter(word => PROFANE.test(word)).length + slurs;
  if (slurs >= 4) throw new ModerationError("Ease up on the slurs — make your point about the fight.");
  if (profane >= 3 && profane / words.length > 0.5) throw new ModerationError("That’s mostly swearing. Add something about the fight.");
}

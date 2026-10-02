/** A no contest's reason in a few plain words, first match wins. Records spell
 * the same cause dozens of ways ("Accidental Knee to the Groin", "Yvel Kicked
 * in Groin"); the full method stays wherever there is room for it. Shared with
 * the client, so it imports nothing. */
const NC_REASONS: [RegExp, string][] = [
  [/drug test/i, "Failed drug test"],
  [/overturn/i, "Result overturned"],
  [/weight/i, "Missed weight"],
  [/groin/i, "Groin strike"],
  [/\beye\b|thumb/i, "Eye poke"],
  [/illegal|soccer|back of (?:the )?head|spine|after (?:the )?bell|grounded/i, "Illegal strike"],
  [/head\s?butt|clash of heads/i, "Clash of heads"],
  [/rain/i, "Stopped by rain"],
  [/\bfell\b/i, "Fell from ring"],
  [/ring broke|cage|surface/i, "Unsafe ring"],
  [/riot/i, "Crowd riot"],
  [/double/i, "Double knockout"],
  [/judging|scoring/i, "Scorecard error"],
  [/timekeeping/i, "Timekeeping error"],
  [/referee|premature/i, "Referee error"],
  [/\bcut\b/i, "Accidental cut"],
  [/injur/i, "Accidental injury"],
];

/** A method that only says "no contest", with no cause to shorten. */
const BARE = /^(?:no contest|nc|nd|no decision)$/i;
const WRAPPED = /^(?:no contest|nc|nd|no decision)\b/i;

/** A no contest's method in a few words; null when it gives no cause, since
 * the NC mark already says what happened. Short UFC codes such as CNC stay. */
export function noContestReason(method: string | null): string | null {
  if (!method) return null;
  const reason = NC_REASONS.find(([pattern]) => pattern.test(method));
  if (reason) return reason[1];
  return WRAPPED.test(method.trim()) ? null : method;
}

/** True when a method names a cause no rule can put plainly, which the bugs
 * board lists so a rule can be added. */
export function noContestUnexplained(method: string | null): boolean {
  if (!method || BARE.test(method.trim())) return false;
  return noContestReason(method) === null;
}

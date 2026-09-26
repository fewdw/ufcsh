export function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

export function formatDateShort(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

export function formatDateShortWithYear(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" })
    .format(parsed)
    .replace(",", "");
}

/** Calendar-day distance from today to a date-only event. Event dates do not
 * carry a start time, so comparing local calendar midnights keeps "tomorrow"
 * at one day even late in the evening. */
export function daysUntil(date: string, now = Date.now()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = new Date(now);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((target - start) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

/** "in 12 days" for a future event, with a singular day when appropriate. */
export function futureDayLabel(date: string, now = Date.now()): string | null {
  const days = daysUntil(date, now);
  if (days == null || days <= 0) return null;
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** How a bout ended: the method, the round, and — for a finish — the clock it
 *  came at. A decision is only ever reached at the end of the final round, so
 *  its time says nothing that the round has not already said. */
/** Outside records spell decisions out ("Decision (Unanimous)"); UFC rows
 *  already say U-DEC. One spelling keeps a fighter's list reading as one. */
const DECISIONS: Record<string, string> = { unanimous: "U-DEC", split: "S-DEC", majority: "M-DEC" };
function shortDecision(method: string): string {
  const match = /^decision(?:\s*\((unanimous|split|majority)\))?$/i.exec(method.trim());
  if (!match) return method;
  return match[1] ? DECISIONS[match[1].toLowerCase()] : "DEC";
}

export function formatMethod(method: string | null, round: string | null, time: string | null): string {
  if (!method) return "";
  method = shortDecision(method);
  const parts = [method];
  if (round) parts.push(`R${round}`);
  if (time && !isDecision(method)) parts.push(time);
  return parts.join(" · ");
}

export function isDecision(method: string | null | undefined): boolean {
  return /dec$/i.test((method ?? "").trim());
}

/** "3 Rounds" — how long a bout is booked for; empty when that is unknown. */
export function roundsLabel(rounds: number | null | undefined): string {
  return rounds ? `${rounds} Round${rounds === 1 ? "" : "s"}` : "";
}

/** Generational suffixes are not the surname: "Raul Rosas Jr." is Rosas. */
const NAME_SUFFIX = /^(?:jr|sr)\.?$|^(?:ii|iii|iv)$/i;
/** Words that belong to the surname after them: "dos Anjos", "Della
 *  Maddalena", "de la Rosa", "Van der Merckt", "Saint Denis". Never the first
 *  word, so Joshua Van is still Van and a lone "Van" stays a first name. */
const SURNAME_PARTICLES = new Set(["da", "das", "de", "del", "della", "der", "di", "dos", "du", "la", "le", "st", "st.", "saint", "van", "von"]);

/** Surname only — how fighters are referred to on charts and in tight labels,
 *  and the one rule every such label uses. */
export function lastName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  while (words.length > 2 && NAME_SUFFIX.test(words.at(-1)!)) words.pop();
  if (words.length < 2) return words[0] ?? name;
  let start = words.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(words[start - 1].toLowerCase())) start -= 1;
  return words.slice(start).join(" ");
}

export function outcomeClasses(outcome: string | null | undefined): string {
  switch (outcome) {
    case "win":
      return "bg-emerald-100 text-emerald-700";
    case "loss":
      return "bg-rose-100 text-rose-700";
    case "draw":
      return "bg-amber-100 text-amber-700";
    case "nc":
      return "bg-zinc-200 text-zinc-600";
    default:
      return "bg-zinc-100 text-zinc-500";
  }
}

export function outcomeLabel(outcome: string | null | undefined): string {
  switch (outcome) {
    case "win":
      return "W";
    case "loss":
      return "L";
    case "draw":
      return "D";
    case "nc":
      return "NC";
    default:
      return "";
  }
}

/** "-330" / "+280" betting line, or empty. */
export function formatLine(line: string | null | undefined): string {
  return line ?? "";
}

export function rankLabel(ranking: { division: string; rank: string } | null): string {
  if (!ranking) return "";
  return ranking.rank === "C" ? "C" : ranking.rank === "IC" ? "IC" : `#${ranking.rank}`;
}

/** How long ago a synced copy of something arrived, in the coarsest unit that
 * still answers "is this current?". Null when nothing has ever been synced, so
 * a caller can say "not synced yet" rather than imply an age it does not know.
 * A timestamp ahead of this clock reads as "just now"; it never counts down. */
export function relativeAge(timestamp: number | null | undefined, now: number = Date.now()): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The full local timestamp, for the tooltip behind a rounded age. */
export function exactTime(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/** A start time in the reader's own zone: "7:27 PM". Times come from the API
 *  as absolute instants precisely so this is the only place a zone is chosen,
 *  and the browser's is the right one. */
export function clockTime(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** A start time in the reader's own zone, named: "9 PM EDT", "8:30 PM GMT+1". */
export function clockTimeWithZone(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", timeZoneName: "short" };
  if (date.getMinutes() !== 0) options.minute = "2-digit";
  return date.toLocaleTimeString([], options);
}

/** How long until something starts: "2h 05m", "12m", "40s". Null once it has.
 *  Deliberately coarse above an hour and exact under a minute — a countdown to
 *  a walkout is watched closely only at the end. */
export function countdown(target: number | null | undefined, now: number = Date.now()): string | null {
  if (target == null || !Number.isFinite(target)) return null;
  const seconds = Math.round((target - now) / 1000);
  if (seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A clock time at a venue, from its published UTC offset ("GMT-06:00"):
 *  "7:00 PM". Null when either is unknown — never the reader's zone passed off
 *  as the venue's. */
export function venueClock(timestamp: number | null | undefined, offset: string | null | undefined): string | null {
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? "");
  if (timestamp == null || !Number.isFinite(timestamp) || !match) return null;
  const minutes = (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  return new Date(timestamp + minutes * 60_000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** "GMT-06:00" as people write it: "UTC−6". */
export function offsetLabel(offset: string | null | undefined): string | null {
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? "");
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return `UTC${match[1] === "-" ? "−" : "+"}${hours}${minutes ? `:${match[3]}` : ""}`;
}

/** Height "5' 10"" or reach "70"" in inches; null when unreadable. */
export function inches(value: string | null | undefined): number | null {
  const text = value ?? "";
  const feet = text.match(/(\d+)'\s*(\d+(?:\.\d+)?)?/);
  if (feet) return Number(feet[1]) * 12 + Number(feet[2] ?? 0);
  const plain = text.match(/([\d.]+)"/);
  return plain ? Number(plain[1]) : null;
}

/** Lowercase, accent-free text for matching a typed filter against names. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A division as printed: a catchweight carries its agreed limit once known
 *  ("Catch Weight (160 lbs)"). */
export function divisionName(weightClass: string, catchWeight?: number | null): string {
  return catchWeight && /catch/i.test(weightClass) ? `${weightClass} (${catchWeight} lbs)` : weightClass;
}

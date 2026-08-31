export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

// NFKD decomposes accents into combining marks, but letters written with a
// stroke or as a ligature (ł, ø, đ, æ…) survive it intact and would otherwise be
// dropped as punctuation — "Błachowicz" has to normalize to "blachowicz".
const LETTER_MAP: Record<string, string> = {
  "ł": "l",
  "ø": "o",
  "đ": "d",
  "ð": "d",
  "ħ": "h",
  "ı": "i",
  "ŀ": "l",
  "ŧ": "t",
  "þ": "th",
  "æ": "ae",
  "œ": "oe",
  "ß": "ss",
};

/** Lowercase, accent-stripped, alphanumeric words only — used to match names across sources. */
export function normName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[łøđðħıŀŧþæœß]/g, (ch) => LETTER_MAP[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "michael venom page" -> "michael page": drops an embedded nickname. */
export function firstLastName(name: string | null | undefined): string {
  const tokens = normName(name).split(" ").filter(Boolean);
  if (tokens.length < 3) return tokens.join(" ");
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "August 15, 2026" | "Aug 15, 2026" | "2026-08-15" -> "2026-08-15" (or "" if unparseable). */
export function toIsoDate(value: string): string {
  const v = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = Object.entries(MONTHS).find(([name]) => name.startsWith(m[1].toLowerCase()))?.[1];
    if (month) return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  return "";
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

export function idFromUrl(url: string | undefined, kind: string): string {
  const m = (url ?? "").match(new RegExp(`${kind}/([a-f0-9]+)`));
  return m ? m[1] : "";
}

export function log(...args: unknown[]): void {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

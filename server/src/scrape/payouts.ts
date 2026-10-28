import { fetchHtml } from "../http.ts";
import { editDistance, firstLastName, normName } from "../util.ts";
import { namesCard, plainText } from "./wikipedia.ts";

/** What fighters were paid, as published: the purses an athletic commission
 *  disclosed (Wikipedia's "Reported payout" sections and MMA Payout's salary
 *  posts) and post-fight bonus amounts (Wikipedia's "Bonus awards").
 *  Parsing only: nothing here guesses an amount the text does not state. */

export type PayBout = {
  id: string; f1: string; f2: string; f1Outcome?: string | null; f2Outcome?: string | null;
  /** Names a corner fought under before (a maiden name, "Cris Cyborg"). */
  f1Aliases?: string[]; f2Aliases?: string[];
};
export type Corner = "f1" | "f2";
/** A purse as written: the total, and its parts only when the source names
 *  them. A total can include a weight-miss fine moved from the opponent, so
 *  show money is never derived as total minus win bonus. */
export type Purse = { total: number; show: number | null; win: number | null; note: string | null };
export type PurseRead = {
  purses: Map<string, Partial<Record<Corner, Purse>>>;
  /** Rows naming a fighter and an amount that could not be placed or read. */
  unread: string[];
  /** Winners whose lone amount may or may not hold the win bonus, by "boutId:corner". */
  unclear: Map<string, string>;
};
export type SourceLink = { label: string; url: string };

const MONEY = String.raw`\$\s?(\d[\d,.]*)\s*(k\b|K\b|million\b)?`;
const amount = (name: string) => String.raw`\$\s?(?<${name}>\d[\d,.]*)\s*(?<${name}Unit>k\b|K\b|million\b)?`;
// The amount and whatever states its parts: "(includes $X win bonus)", "($X
// win bonus)", "(no win bonus)", "($S/$W)", "+ $W win bonus", "($S + $W =
// $T)", "($S; $W win bonus)", "$S show/$W win", "$S/$W", and the 2006 form
// "($275,000—includes $150,000 win bonus)"; then a footnote mark ("^", "*").
const ENTRY = new RegExp(String.raw`(?<lead>\(\s*)?${amount("amount")}(?<total>\s*total)?(?:`
  + String.raw`\s*\(\s*${amount("base")}\s*(?:to\s+)?(?:show|fight)\s*[,;]\s*(?:${amount("baseWin")}\s*(?:to win|win bonus)|(?<baseNone>no win bonus))(?<adjustment>[^)]*)\)`
  + String.raw`|\s*\(?\s*[—–-]?\s*(?<includes>includes\s+)?${amount("win")}\s*(?:win(?:ning)?\s*bonus|to win|win\b)\)?`
  + String.raw`|\s*\(?\s*[—–;-]?\s*(?<none>no win bonus)\)?`
  + String.raw`|\s*\(\s*${amount("show")}\s*\/\s*${amount("split")}\s*\)`
  + String.raw`|\s*\+\s*${amount("plus")}\s*(?:win(?:\s*bonus)?)?(?:\s*=\s*\$\s?[\d,]+)?`
  + String.raw`|\s*;\s*${amount("semi")}\s*win(?:\s*bonus)?`
  + String.raw`|\s*(?:to\s+)?show\s*\/\s*${amount("shown")}\s*(?:to\s+)?win`
  + String.raw`|\s*\/\s*${amount("slash")}`
  + String.raw`)?(?<close>\s*\))?(?<marker>\s*[\^*+¹²³<>†‡]+)?`, "g");

/** A written amount in whole dollars; null for anything malformed ("$10,00"),
 *  which is a typo to report, never a number to guess at. */
export function money(raw: string | undefined, unit?: string): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[.,]+$/, "");
  if (unit) {
    if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
    const value = Number(digits) * (unit.toLowerCase() === "k" ? 1_000 : 1_000_000);
    return Number.isInteger(value) ? value : null;
  }
  if (!/^\d{1,3}(?:,\d{3})+$|^\d{4,}$/.test(digits)) return null;
  return Number(digits.replace(/,/g, ""));
}

const PARTICLES = new Set(["de", "da", "do", "dos", "das", "van", "von", "der", "den", "le", "la", "del", "della", "di", "bin", "al", "el", "e", "y", "jr", "jr.", "sr", "ii", "iii"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** The person a row names: the run of capitalised words just before its
 *  amount, decorations ("*", "(WEC)", ":") dropped. "def. Tyron Woodley" and
 *  "top earners include Henry Cejudo" name someone; prose that ends in a
 *  verb ("The Last Stylebender earned") does not: null. */
export function rowName(before: string): string | null {
  // A nickname in quotes is not part of the name: Mauricio "Shogun" Rua.
  const text = before.replace(/["“”][^"“”]{1,30}["“”]/g, " ").replace(/\((?:WEC|DWCS|LFA)\)/gi, " ").replace(/[*#^:•(]+/g, " ")
    .replace(/,\s*(Jr\.?|Sr\.?)\s*$/i, " $1").trimEnd();
  const run: string[] = [];
  // Headings and totals are capitalised too: "Disclosed Fighter Payroll: $539,000".
  if (/\b(?:Total|Payroll|Disclosed|Payouts?|Purses?|Bonus|Salar(?:y|ies)|Compliance|Card|Event)\W*$/i.test(text)) return null;
  for (const word of text.split(/\s+/).reverse()) {
    if (!word) continue;
    if (/^\p{Lu}[\p{L}'’.\-]*$/u.test(word) || (run.length && PARTICLES.has(word.toLowerCase()))) run.unshift(word);
    else break;
  }
  while (run.length && PARTICLES.has(run[0].toLowerCase())) run.shift();
  return run.length >= 2 && run.length <= 5 ? run.join(" ") : null;
}

function nameTokens(name: string): string[] {
  const tokens = normName(name).split(" ").filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens.at(-1)!)) tokens.pop();
  return tokens;
}

/** Which corner of which bout a written name is: the full name, first and
 *  last name, a surname no one else on the card shares, or one slip of the
 *  keyboard. Two equally good candidates is ambiguous: null. */
export function placeName(name: string, bouts: PayBout[]): { bout: PayBout; corner: Corner } | null {
  const written = nameTokens(name);
  if (!written.length) return null;
  const surnameOf = (tokens: string[]) => tokens.at(-1) ?? "";
  const people = bouts.flatMap((bout) => (["f1", "f2"] as const).map((corner) => ({
    bout, corner, tokens: nameTokens(bout[corner]),
    aliases: (bout[`${corner}Aliases`] ?? []).map(nameTokens).filter((tokens) => tokens.length >= 2),
  })));
  const surnames = people.map((person) => surnameOf(person.tokens));
  const sorted = (tokens: string[]) => [...tokens].sort().join(" ");
  const writtenText = written.join(" ");
  const score = (person: (typeof people)[number]) => {
    const full = person.tokens.join(" ");
    // In full, first and last, in either order ("Choi Doo-ho"), or a name they fought under.
    if ([person.tokens, ...person.aliases].some((tokens) => tokens.join(" ") === writtenText
      || firstLastName(tokens.join(" ")) === firstLastName(writtenText) || sorted(tokens) === sorted(written))) return 4;
    const surname = surnameOf(person.tokens);
    const unique = surname.length >= 3 && surnames.filter((other) => other === surname).length === 1;
    // "Carlos Diego Ferreira" is UFCStats' "Diego Ferreira".
    if (person.tokens.length >= 2 && writtenText.endsWith(` ${person.tokens.slice(-2).join(" ")}`)) return 3;
    // A surname alone, only when the given names could be one person's: "Zachary" for "Zach", never "Michael" for "Charles".
    if (unique && surnameOf(written) === surname && sameGiven(written[0], person.tokens[0])) return 2;
    if (writtenText.length >= 8 && editDistance(writtenText, full) <= 2) return 1;
    return 0;
  };
  const ranked = people.map((person) => ({ person, score: score(person) })).filter((entry) => entry.score > 0)
    .sort((x, y) => y.score - x.score);
  if (!ranked.length || (ranked[1] && ranked[1].score === ranked[0].score)) return null;
  return { bout: ranked[0].person.bout, corner: ranked[0].person.corner };
}

/** "Zach" and "Zachary", "Nate" and "Nathan", "Michel" and "Michael"; never "Michael" and "Charles". */
function sameGiven(a: string, b: string): boolean {
  return a === b || (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3)) || (a.length >= 5 && editDistance(a, b) <= 1);
}

/** `unclear`: a winner's lone amount from a source that doesn't say whether
 *  it holds the win bonus. */
type Entry = { name: string; purse: Purse | null; marker: string | null; raw: string; between: string; after: string; unclear: boolean };

/** Every name-and-amount on one line of text. */
/** How a source writes "$X ($W win bonus)": Wikipedia always means the win
 *  bonus is inside $X; MMA Payout has meant both, so it is read only where
 *  the figures settle it. */
export type WinBonusStyle = "included" | "unclear";

function lineEntries(line: string, outcomeOf: (name: string) => string | null | undefined, style: WinBonusStyle): Entry[] {
  const entries: Entry[] = [];
  let from = 0;
  for (const match of line.matchAll(ENTRY)) {
    const before = line.slice(from, match.index);
    from = match.index + match[0].length;
    const name = rowName(before);
    if (!name) continue;
    const g = match.groups!;
    const amount = money(g.amount, g.amountUnit);
    const raw = `${before.trim()} ${match[0].trim()}`.trim();
    const marker = g.marker?.trim() || null;
    let purse: Purse | null = null;
    if (amount != null) {
      if (g.base != null) {
        const show = money(g.base, g.baseUnit);
        const win = g.baseNone ? 0 : money(g.baseWin, g.baseWinUnit);
        const note = g.adjustment?.replace(/^[,\s]+/, "").trim() || null;
        // A transferred fine can make the stated total differ from show + win.
        purse = show != null && win != null && (show + win === amount || /fine|dock/i.test(note ?? ""))
          ? { total: amount, show, win, note } : null;
      } else if (g.none) purse = { total: amount, show: amount, win: 0, note: null };
      else if (g.win != null) {
        const win = money(g.win, g.winUnit);
        // A win bonus as large as the whole amount can't be inside it: show
        // money and win bonus, written apart ("$50,000 ($50,000 win bonus)").
        if (win == null) purse = null;
        else if (win === amount && !g.includes) purse = { total: amount + win, show: amount, win, note: null };
        else if (win < amount && (g.includes || style === "included" || win * 2 === amount)) purse = { total: amount, show: null, win, note: null };
        else purse = null;
      } else if (g.show != null) {
        const [show, win] = [money(g.show, g.showUnit), money(g.split, g.splitUnit)];
        purse = show != null && win != null && show + win === amount ? { total: amount, show, win, note: null } : null;
      } else if (g.plus != null || g.shown != null || g.slash != null || g.semi != null) {
        const win = money(...([[g.plus, g.plusUnit], [g.shown, g.shownUnit], [g.slash, g.slashUnit], [g.semi, g.semiUnit]].find(([raw]) => raw != null) as [string, string]));
        // "$S show/$W win", "$S/$W" and "($S; $W win bonus)" are the contract:
        // a fighter who did not win was paid the show money. "+ $W" was paid.
        const won = outcomeOf(name) === "win";
        purse = win == null ? null : won || g.plus != null ? { total: amount + win, show: amount, win, note: null } : { total: amount, show: amount, win: 0, note: null };
      } else purse = { total: amount, show: null, win: null, note: null };
    }
    const unclear = style === "unclear" && purse != null && purse.win == null && outcomeOf(name) === "win";
    entries.push({ name, purse, marker, raw, between: before, after: "", unclear });
  }
  if (entries.length) entries.at(-1)!.after = line.slice(from);
  return entries;
}

/** Purses written one fighter after another: bullet lines of a Wikipedia
 *  section, or the paragraphs of a salary post. A line with two corners
 *  must name the two corners of one bout. */
export function readPurses(lines: string[], bouts: PayBout[], notes: Map<string, string> = new Map(), style: WinBonusStyle = "included"): PurseRead {
  const purses: PurseRead["purses"] = new Map();
  const unread: string[] = [];
  const outcomeOf = (name: string) => {
    const placed = placeName(name, bouts);
    return placed ? placed.bout[`${placed.corner}Outcome`] : null;
  };
  const twice = new Set<string>();
  const unclear = new Map<string, string>();
  // "Lyoto Machida: $200,000 (no win bonus)" / "def. Mauricio Rua: $155,000" is one row.
  const rows = lines.reduce<string[]>((joined, line) => {
    if (joined.length && /^\s*(?:def(?:eated|eats)?\.?|vs\.?|drew with)\s/i.test(line)) joined[joined.length - 1] += ` ${line.trim()}`;
    else joined.push(line);
    return joined;
  }, []);
  for (const line of rows) {
    const entries = lineEntries(line, outcomeOf, style);
    const placed = entries.map((entry) => ({ entry, at: placeName(entry.name, bouts) }));
    // "A def. B", "A vs. B": the two corners of one bout. A list of many
    // fighters on one line (2006's payrolls) is placed one by one.
    const paired = entries.length === 2 && /\b(?:def(?:eated|eats)?|vs|drew)\b|[–—]/i.test(entries[1].between);
    if (paired) {
      if (placed[0].at && placed[1].at && placed[0].at.bout.id !== placed[1].at.bout.id) { unread.push(line.trim()); continue; }
      // One corner known places the other, whatever name it was written under.
      const [known, other] = placed[0].at ? [placed[0], placed[1]] : [placed[1], placed[0]];
      if (known.at && !other.at) other.at = { bout: known.at.bout, corner: known.at.corner === "f1" ? "f2" : "f1" };
      if (placed[0].at && placed[1].at && placed[0].at.corner === placed[1].at.corner) { unread.push(line.trim()); continue; }
    }
    // "Bobby Green: $300,000 def. Tony Ferguson": the opponent, named without an amount, places the one with it.
    const opponent = entries.length === 1 && !placed[0].at ? /^\s*(?:def(?:eated|eats)?\.?|vs\.?|drew with)\s+(.+)$/i.exec(entries[0].after)?.[1] : null;
    const theirs = opponent ? placeName(opponent.replace(/[*^¹²³<>:]+/g, " ").trim(), bouts) : null;
    if (theirs) placed[0].at = { bout: theirs.bout, corner: theirs.corner === "f1" ? "f2" : "f1" };
    for (const { entry, at } of placed) {
      if (!at || !entry.purse) { unread.push(entry.raw); continue; }
      if (entry.unclear) { unclear.set(`${at.bout.id}:${at.corner}`, entry.raw); continue; }
      const previous = purses.get(at.bout.id)?.[at.corner];
      if (previous && previous.total !== entry.purse.total) {
        unread.push(`${entry.name} is listed twice: ${usd(previous.total)} and ${usd(entry.purse.total)}`);
        twice.add(`${at.bout.id}:${at.corner}`);
      }
      const purse = { ...entry.purse, note: (entry.marker ? notes.get(entry.marker) : null) ?? entry.purse.note };
      purses.set(at.bout.id, { ...purses.get(at.bout.id), [at.corner]: purse });
    }
  }
  for (const key of twice) {
    const [id, corner] = key.split(":") as [string, Corner];
    const pair = purses.get(id)!;
    delete pair[corner];
    if (!pair.f1 && !pair.f2) purses.delete(id);
  }
  return { purses, unread, unclear };
}

export const usd = (value: number) => `$${value.toLocaleString("en-US")}`;

// ---------------------------------------------------------------------------
// Wikipedia

/** One section's wikitext, from its heading to the next heading at the same
 *  depth or shallower. */
export function articleSection(wikitext: string, heading: RegExp): string | null {
  const lines = wikitext.split("\n");
  const start = lines.findIndex((line) => {
    const match = /^(=+)\s*(.*?)\s*\1\s*$/.exec(line.trim());
    return match && heading.test(match[2]);
  });
  if (start < 0) return null;
  const depth = /^(=+)/.exec(lines[start].trim())![1].length;
  const end = lines.findIndex((line, i) => i > start && /^(=+)[^=].*?\1\s*$/.test(line.trim()) && /^(=+)/.exec(line.trim())![1].length <= depth);
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

const tagless = (text: string) => text.replace(/<br\s*\/?>/gi, " ").replace(/<\/?(?:small|span|sup|sub|i|b|u|div|center)\b[^<>]*>/gi, "")
  .replace(/<nowiki>([^<]*)<\/nowiki>/gi, "$1").replace(/&nbsp;/g, " ");
const tidy = (text: string) => plainText(tagless(text)).replace(/''+/g, "").replace(/\s+/g, " ").trim();

const OUTLETS: [RegExp, string][] = [
  [/mmajunkie/i, "MMA Junkie"], [/mmafighting/i, "MMA Fighting"], [/mmapayout/i, "MMA Payout"], [/sherdog/i, "Sherdog"],
  [/espn/i, "ESPN"], [/bloodyelbow/i, "Bloody Elbow"], [/latimes/i, "Los Angeles Times"], [/sportskeeda/i, "Sportskeeda"],
];

/** The citation behind a section: its first reference with an address,
 *  following a named reference back to where it is defined. */
export function sectionCitation(section: string, article: string): SourceLink | null {
  for (const match of section.matchAll(/<ref(?:\s+name\s*=\s*"?([^">/]+?)"?)?\s*(\/)?>([\s\S]*?<\/ref>)?/gi)) {
    let body = match[3] ?? "";
    if (!/url\s*=/.test(body) && match[1]) {
      const name = match[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      body = new RegExp(String.raw`<ref\s+name\s*=\s*"?${name}"?\s*>([\s\S]*?)<\/ref>`, "i").exec(article)?.[1] ?? "";
    }
    const url = /\burl\s*=\s*([^|}\s]+)/i.exec(body)?.[1];
    if (!url || !/^https?:\/\//.test(url)) continue;
    const field = (key: string) => new RegExp(String.raw`\|\s*${key}\s*=\s*([^|}]+)`, "i").exec(body)?.[1]?.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").trim();
    const label = field("website") || field("work") || field("publisher") || field("newspaper") || new URL(url).hostname.replace(/^www\./, "");
    return { label: OUTLETS.find(([pattern]) => pattern.test(label) || pattern.test(url))?.[1] ?? label, url };
  }
  return null;
}

export type CommissionPurses = PurseRead & { commission: string | null; caveat: string | null; citation: SourceLink | null };

const COMMISSION = /(?:reported|released|disclosed|filed)\s+(?:to|by|with)\s+the\s+([A-Z][^.(]+?)\s*(?:\(|\.|$)/;

/** The card's "Reported payout" section: each fighter's disclosed purse, the
 *  commission it was disclosed to, the article's own caveat, its footnotes
 *  (weight-miss fines, show money in a no contest) and its citation. */
export function wikipediaPurses(article: string, bouts: PayBout[]): CommissionPurses | null {
  const section = articleSection(article, /^Reported payouts?$/i);
  if (!section) return null;
  const raw = section.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const firstBullet = raw.findIndex((line) => line.trimStart().startsWith("*"));
  const intro = tidy(raw.slice(0, firstBullet < 0 ? undefined : firstBullet).join(" "));
  // 2006's payrolls are one line of names, not a list of bouts.
  const bullets = firstBullet < 0 ? raw.map(tidy).filter(Boolean)
    : raw.filter((line) => line.trimStart().startsWith("*")).map((line) => tidy(line.trimStart().replace(/^\*+/, "")));
  const notes = new Map<string, string>();
  for (const line of raw.slice(firstBullet < 0 ? raw.length : firstBullet)) {
    if (line.trimStart().startsWith("*") && !/^\s*<nowiki>/i.test(line)) continue;
    const text = tidy(line);
    const footnote = /^([\^*¹²³<>]+)\s*(.+)$/.exec(text);
    if (footnote) notes.set(footnote[1], footnote[2].trim());
  }
  const read = readPurses(bullets, bouts, notes);
  const named = COMMISSION.exec(intro)?.[1]?.replace(/^(\w+)'s /, "$1 ").replace(/^Nevada Athletic Commission$/, "Nevada State Athletic Commission");
  const commission = named && /Commission|Department|Authority|Board|Regulation/.test(named) ? named : null;
  const caveat = intro.split(/(?<=\.)\s+/).filter((sentence) => /\b(?:does|do) not include\b|\bnot reflect/i.test(sentence)).join(" ") || null;
  return { ...read, commission, caveat, citation: sectionCitation(section, article) };
}

export type BonusKind = "fotn" | "potn" | "kotn" | "sotn" | "finish";
export const BONUS_LABELS: Record<BonusKind, string> = {
  fotn: "Fight of the Night",
  potn: "Performance of the Night",
  kotn: "Knockout of the Night",
  sotn: "Submission of the Night",
  finish: "Finish bonus",
};
export type BonusAward = { kind: BonusKind; names: string[]; amount: number | null; note: string | null };
export type BonusSection = {
  awards: BonusAward[];
  /** From 2026, every other knockout or submission earns a smaller bonus. */
  finish: { amount: number; except: string[] } | null;
};

const AWARD_KINDS: [RegExp, BonusKind][] = [
  [/^Fight of the Night/i, "fotn"], [/^Performance of the Night/i, "potn"],
  [/^Knockout of the Night/i, "kotn"], [/^Submission of the Night/i, "sotn"],
];

/** The amounts stated in a piece of text, deduplicated. */
const amountsIn = (text: string) => [...new Set([...text.matchAll(new RegExp(MONEY, "g"))].map((m) => money(m[1], m[2])).filter((n): n is number => n != null))];

/** The card's "Bonus awards" section. An awardee keeps the amount only when
 *  the section states it plainly: the line's own figure, else the one figure
 *  the section opens with. Anyone a note names (a bonus forfeited for missing
 *  weight, split, or handed to the opponent) has no amount here; the note says
 *  why, and Admin → Bugs lists it. Fan bonuses voted by viewers are left out. */
export function wikipediaBonuses(article: string): BonusSection | null {
  const section = articleSection(article, /^Bonus awards?$/i);
  if (!section) return null;
  const raw = section.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const firstBullet = raw.findIndex((line) => line.trimStart().startsWith("*"));
  if (firstBullet < 0) return null;
  const intro = tidy(raw.slice(0, firstBullet).join(" "));
  const sentences = intro.split(/(?<=[.)])\s+(?=[A-Z($])/).filter(Boolean);
  const notes: string[] = [];
  let standard: number | null = null;
  let finish: BonusSection["finish"] = null;
  const explicit: BonusAward[] = [];
  for (const sentence of sentences) {
    const amounts = amountsIn(sentence);
    if (/other finishes received/i.test(sentence) && amounts.length) {
      const except = /exception of (.+?)(?:,| as |\.|$)/i.exec(sentence)?.[1];
      finish = { amount: amounts.at(-1)!, except: except ? except.split(/,\s*|\s+and\s+/).map((name) => name.trim()).filter(Boolean) : [] };
      continue;
    }
    // "$25,000 was given to Joselyne Edwards for the additional finish bonus."
    const given = /^\$[\d,]+ was (?:given|awarded) to (.+?) for the (?:additional )?finish bonus/i.exec(sentence);
    if (given && amounts.length === 1) {
      explicit.push({ kind: "finish", names: [given[1].trim()], amount: amounts[0], note: null });
      continue;
    }
    // "received $50,000 bonuses", "earned $65,000.", "received bonuses: $100,000",
    // "received two $50,000 bonuses totaling $100,000"; an aside in brackets is a note.
    const outside = sentence.replace(/\(.*?\)/g, "");
    const each = /\b(?:two|both) \$([\d,]+) bonuses/i.exec(outside);
    const stated = each ? [money(each[1])].filter((n): n is number => n != null) : amountsIn(outside);
    if (standard == null && stated.length === 1 && /\b(?:received|awarded|earned|given)\b/i.test(outside) && !/finish|chaos|fan bonus|crypto/i.test(outside)) {
      standard = stated[0];
      const aside = /\((.*)\)/.exec(sentence)?.[1];
      if (aside) notes.push(aside);
      continue;
    }
    if (amounts.length || /forfeit|missed weight|unable to receive|disqualif|instead|stripped|rescind/i.test(sentence)) notes.push(sentence);
  }
  // Notes under the list: ":{{note|...}} Ferreira was disqualified ...", "Fan Bonus" paragraphs aside.
  for (const line of raw.slice(firstBullet)) {
    if (line.trimStart().startsWith("*")) continue;
    const text = tidy(line);
    if (text && !/fan bonus|crypto\.com|bitcoin/i.test(text)) notes.push(text);
  }
  const awards: BonusAward[] = [];
  for (const line of raw.slice(firstBullet)) {
    if (!line.trimStart().startsWith("*")) continue;
    const text = tidy(line.trimStart().replace(/^\*+/, ""));
    const kind = AWARD_KINDS.find(([pattern]) => pattern.test(text))?.[1];
    if (!kind) continue;
    const [label, ...restParts] = text.split(":");
    let rest = restParts.join(":").trim();
    if (!rest || /^(?:no bonus|not awarded|none awarded|no award|n\/a)/i.test(rest)) continue;
    let lineAmount = amountsIn(label)[0] ?? null;
    const lineNotes: string[] = [];
    rest = rest.replace(/\(([^()]*)\)/g, (_, inside: string) => {
      const amounts = amountsIn(inside);
      if (amounts.length === 1 && /^\s*(?:split,?\s*)?\$[\d,]+(?:\s*each)?\s*$/i.test(inside)) lineAmount = amounts[0];
      else if (inside.trim()) lineNotes.push(inside.trim());
      return "";
    }).replace(/\{\{[^}]*\}\}|\[\d+\]/g, "").trim().replace(/[.;]+$/, "");
    const names = rest.split(/\s+vs\.?\s+|,\s*(?:and\s+)?|\s+and\s+/i)
      .map((name) => name.replace(/[\s\^*¹²³†‡]+$/, "").replace(/^["“]|["”]$/g, "").trim()).filter((name) => name && /\p{L}/u.test(name));
    for (const name of names) {
      const named = [...lineNotes, ...notes].find((note) => mentions(note, name));
      awards.push({ kind, names: [name], amount: named ? null : lineAmount ?? standard, note: named ?? null });
    }
  }
  return { awards: [...awards, ...explicit], finish };
}

/** Whether a note is about this person: their full name or surname. */
function mentions(note: string, name: string): boolean {
  const text = ` ${normName(note)} `;
  const tokens = nameTokens(name);
  return text.includes(` ${tokens.join(" ")} `) || (tokens.at(-1)!.length >= 3 && text.includes(` ${tokens.at(-1)} `));
}

// ---------------------------------------------------------------------------
// MMA Payout

const MMA_PAYOUT = "https://mmapayout.com/wp-json/wp/v2/posts";
export type PayoutPost = { date: string; link: string; title: string; text: string };

/** MMA Payout's salary posts published between two dates: purses a
 *  commission disclosed. Its compliance pay posts are compiled by hand before
 *  the card and contradict UFC's tiers often enough that they are not read. */
export async function mmaPayoutPosts(after: string, before: string): Promise<PayoutPost[]> {
  const posts: PayoutPost[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = `${MMA_PAYOUT}?categories=21&per_page=100&page=${page}&after=${after}T00:00:00&before=${before}T23:59:59&_fields=date,link,title,content`;
    let body: string;
    try {
      body = await fetchHtml(url, { retries: 1 });
    } catch (err) {
      // WordPress answers 400 past the last page.
      if (page > 1 && /HTTP 400/.test(String(err))) break;
      throw err;
    }
    const rows = JSON.parse(body) as { date: string; link: string; title: { rendered: string }; content: { rendered: string } }[];
    for (const row of rows) {
      const post = payoutPost(row.date, row.link, row.title.rendered, row.content.rendered);
      if (post) posts.push(post);
    }
    if (rows.length < 100) break;
  }
  return posts;
}

const decode = (html: string) => html
  .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—").replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "’")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, "\"").replace(/&#038;|&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ")
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));

/** A post reduced to its lines, or null when it is not a salary list. */
export function payoutPost(date: string, link: string, titleHtml: string, html: string): PayoutPost | null {
  const title = decode(titleHtml.replace(/<[^>]+>/g, ""));
  if (!/salar|payout|purse/i.test(title) || /compliance|uniform|promotional guideline|reebok|venum|perspective|analysis|discuss|dispute|comments|gofundme/i.test(title)) return null;
  // Photo captions and struck-through bouts (fell through before the card) go; tables stay, a row per line.
  const text = decode(html
    .replace(/<figcaption[\s\S]*?<\/figcaption>|<s>[\s\S]*?<\/s>|<del>[\s\S]*?<\/del>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<br\s*\/?>|<\/td>/gi, " ")
    .replace(/<\/(?:p|li|h\d|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ");
  return { date: date.slice(0, 10), link, title, text };
}

/** The post about this card: published from three days before it to sixty
 *  after, and naming at least half of its fighters. */
export function postForCard(posts: PayoutPost[], date: string, bouts: PayBout[]): PayoutPost | null {
  const day = Date.parse(date);
  const fighters = bouts.flatMap((bout) => [bout.f1, bout.f2]);
  return posts.find((post) => (Date.parse(post.date) - day) / 86_400_000 >= -3 && (Date.parse(post.date) - day) / 86_400_000 <= 60
    && namesCard(post.text, fighters)) ?? null;
}

export function postCommission(text: string): string | null {
  return /((?:[A-Z][a-z]+ )+(?:State )?(?:Athletic|Boxing)(?: and [A-Z][a-z]+)? (?:Commission|Authority)|(?:[A-Z][a-z]+ )+Department of Licensing)/.exec(text)?.[1]
    ?.replace(/^(?:The|Today|Yesterday)\s+/, "") ?? null;
}

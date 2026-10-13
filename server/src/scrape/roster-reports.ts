import { givenName, normName } from "../util.ts";
import type { RosterHistoryEvent } from "../roster-history.ts";
import { citationDate, plainText } from "./wikipedia.ts";

type Report = Pick<RosterHistoryEvent, "date" | "kind" | "reason" | "source_url">;

/** Dated citations that explicitly report this person's UFC contract change.
 * A debut, a booked bout, a future retirement or another promotion's signing
 * is not a roster report. The importer also checks the fighter's bout timeline. */
export function citedRosterReports(wikitext: string, names: string[]): Report[] {
  const reports: Report[] = [];
  const modifiers = "(?:with|by|the|a|an|new|exclusive|multi|fight|year|deal|contract|for|to|one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+)";
  const signing = new RegExp(`\\b(?:signs?|signed|joins?|joined|inks?|inked)(?: ${modifiers}){0,12} ufc\\b(?! (?:\\d|fight|on|lineup))`);
  const award = /\b(?:earns?|earned) (?:a )?ufc contracts?\b|\bawarded (?:a )?contracts? (?:with|by) (?:the )?ufc\b/;
  const ufcSigning = /\bufc(?: (?:has|had|officially|reportedly)){0,3} (?:signs|signed|inks|inked)\b/;
  const leaving = /\b(?:released|cut) (?:from|by) (?:the )?ufc\b|\b(?:announces?|confirms?|reveals?) (?:his |her )?ufc releases?\b/;
  const ufcLeaving = /\bufc(?: (?:has|had|officially|reportedly)){0,3} (?:releases|released|cuts|cut)\b/;
  const positions = (title: string): { start: number; end: number }[] => {
    const words = title.split(" ");
    const result: { start: number; end: number }[] = [];
    for (const name of names) {
      const parts = normName(name).split(" ").filter(word => !/^(?:jr|sr|junior|senior|ii|iii|iv)$/.test(word));
      if (parts.length < 2 || parts.at(-1)!.length < 4) continue;
      for (let last = 1; last < words.length; last++) {
        if (words[last] !== parts.at(-1)) continue;
        for (let first = Math.max(0, last - 3); first < last; first++) {
          if (givenName(words[first]) !== givenName(parts[0])) continue;
          const start = words.slice(0, first).join(" ").length + Number(first > 0);
          result.push({ start, end: start + words.slice(first, last + 1).join(" ").length });
        }
      }
    }
    return result;
  };
  for (const ref of wikitext.matchAll(/<ref\b[^>]*>([\s\S]*?)<\/ref>/gi)) {
    const field = (key: string) => ref[1].match(new RegExp(`\\|\\s*${key}\\s*=\\s*([^|}]*)`, "i"))?.[1].trim() ?? "";
    const title = normName(plainText(field("title"))).replace(/\bultimate fighting championship\b/g, "ufc");
    const who = positions(title);
    const url = field("url");
    if (!who.length || !/^https?:\/\//.test(url) || /\/forums?\b|reddit\.com/i.test(url)
      || /\b(?:not|never|denies|denied|rumor|rumour|could|might|set to|expected to|hopes? to|aims? to|wants? to|will (?:sign|earn|join))\b/.test(title)) continue;
    const date = citationDate(field("date"));
    if (!date) continue;
    const subject = (pattern: RegExp, after = false) => {
      const match = pattern.exec(title);
      return match && who.some(person => after
        ? person.start >= match.index + match[0].length && !/\b(?:vs|meets|faces|against|replaces|signs?|joins?|releases?|cuts?)\b/.test(title.slice(match.index + match[0].length, person.start))
        : person.end <= match.index && !/\b(?:vs|meets|faces|against|replaces|signs?|joins?|releases?|cuts?)\b/.test(title.slice(person.end, match.index)));
    };
    const awarded = award.exec(title);
    const directAward = awarded && who.some(person => person.end <= awarded.index
      && /^(?: (?:has|been|was|is|officially|now))* *$/.test(title.slice(person.end, awarded.index)));
    if (subject(signing) || subject(ufcSigning, true) || directAward) {
      reports.push({ date, kind: "signed", reason: null, source_url: url });
    } else if (subject(leaving) || subject(ufcLeaving, true)) {
      reports.push({ date, kind: "released", reason: "Released", source_url: url });
    } else if (/\bufc\b/.test(title) && !/\b(?:former|vet|veteran|bellator|pfl|rizin|will|plans|return|returns|retirement fight|final fight)\b/.test(title)
      && subject(/\b(?:announces? (?:his |her )?retirement|retires?|retired|notifies (?:the )?ufc of (?:his |her )?retirement)\b/)) {
      reports.push({ date, kind: "retired", reason: "Retired", source_url: url });
    }
  }
  return reports;
}

/** An exact date stated at the start of a biography paragraph. Bare months,
 * citation publication dates and dates of booked bouts are never substituted
 * for the stated contract date. An opening he/she refers to the biography's
 * subject; a named opponent is still checked by the citation-title matcher. */
export function datedRosterStatements(wikitext: string, names: string[]): Report[] {
  const reports: Report[] = [];
  const narrative = wikitext.split(/==\s*(?:Professional )?(?:Mixed martial arts|MMA) record\s*==/i)[0];
  for (const paragraph of narrative.split(/\n\s*\n/)) {
    const text = plainText(paragraph).replace(/\s+/g, " ").trim();
    const opening = /^On ((?:[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]+ \d{4})),? (.+?)(?:\.(?: |$)|$)/.exec(text);
    if (!opening) continue;
    let statement = opening[2].replace(/^it was (?:announced|reported|confirmed),? that /i, "");
    // Biography prose commonly uses its subject's surname: "Mokaev signed",
    // "it was announced that Murphy had signed". Only the opening subject
    // can be expanded; a different full name or a later opponent stays intact.
    const subject = /^((?:[\p{L}'’.-]+ ){0,3}?[\p{L}'’.-]+)(?= (?:was|is|has|had|signed|joined|announced|confirmed|revealed|retired|notified|earned|awarded)\b)/u.exec(statement);
    const written = normName(subject?.[1]);
    if (subject && (/^(?:he|she)$/.test(written) || names.some(name => normName(name) === written
      || (written.length >= 4 && normName(name).endsWith(` ${written}`))))) {
      statement = names[0] + statement.slice(subject[1].length);
    }
    statement = statement.replace(/^((?:the )?UFC (?:had |has )?(?:released|signed) )(?:him|her)\b/i, `$1${names[0]}`);
    // This synthetic citation only reuses the date/subject/action validation;
    // the retained source is the actual biography revision, set by the importer.
    reports.push(...citedRosterReports(`<ref>{{cite web|title=${statement}|date=${opening[1]}|url=https://en.wikipedia.org/}}</ref>`, names));
  }
  return reports;
}

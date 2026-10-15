import { citationDate, plainText } from "./wikipedia.ts";

export type ContenderContract = { name: string; date: string; source_url: string };

/** An appearance or a win is not a signing. Read only the explicit contract
 * award list for each dated episode, never subsequent call-ups or development
 * deals described in the other bullets. Retained reports are reviewed before
 * import; in particular, Hardy's first deal was developmental, not a UFC slot. */
export function contenderContracts(wikitext: string): ContenderContract[] {
  const contracts: ContenderContract[] = [];
  for (const section of wikitext.split(/\n==(?!=)/).slice(1)) {
    const date = citationDate(plainText(section.match(/\|\s*date\s*=\s*([^|}\n]+)/i)?.[1] ?? "").trim());
    if (!date) continue;
    const awards = section.match(/===\s*Contract awards\s*===([\s\S]*?)(?=\n===|$)/i)?.[1];
    if (!awards || !/following fighters[^:]*were awarded contracts with the UFC:/i.test(awards)) continue;
    const ref = awards.match(/<ref\b[^>]*>([\s\S]*?)<\/ref>/i)?.[1] ?? "";
    const source = ref.match(/\|\s*url\s*=\s*([^|}]+)/i)?.[1].trim();
    if (!source || !/^https:\/\//.test(source)) continue;
    for (const line of awards.split("\n").filter(line => /^\*[^*]/.test(line))) {
      const text = plainText(line.slice(1)).trim().replace(/\.$/, "");
      if (/\b(?:was|were|while|not|development|later|signed|brought|offered|awarded)\b/i.test(text)) continue;
      for (const name of text.split(/,\s*(?:and\s+)?|\s+and\s+/).map(name => name.trim())) {
        if (!/^[\p{L}'’.-]+(?: [\p{L}'’.-]+){1,5}$/u.test(name)) continue;
        // https://www.mmafighting.com/2018/6/12/17456682/dwtncs-results-greg-hardy-signed-by-ufc-after-57-second-ko-win-in-pro-debut
        if (date === "2018-06-12" && name === "Greg Hardy") continue;
        contracts.push({ name, date, source_url: source });
      }
    }
  }
  return contracts;
}

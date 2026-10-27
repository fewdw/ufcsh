import * as cheerio from "cheerio";
import { db, prepared } from "./db.ts";
import { fetchHtml } from "./http.ts";
import { cleanText, editDistance, givenName, normName } from "./util.ts";

/** How often each athlete was tested a year, from the UFC Anti-Doping
 *  Program's Test History (run by USADA until 2024; the program now counts
 *  test sessions, not samples). The source names athletes
 *  as they are registered, often with every family name ("Brandon Moreno
 *  Carrillo"), so each row is tied to a profile here, never by a guess that
 *  fits more than one fighter. */

export const ANTIDOPING_SOURCE = "https://ufcantidoping.com/tests";
export const FIRST_ANTIDOPING_YEAR = 2015;

/** Registered names nothing below can tie to a profile, by the stored name
 *  each one is: a legal name for a ring name, a maiden or married name. Each
 *  was checked against the years the fighter was on the roster. */
export const SOURCE_NAMES: Record<string, string> = {
  "Alexey Oleynik": "Aleksei Oleinik",
  "Antonio Filho": "Antonio Trocoli",
  "Antonio L Gravely": "Tony Gravely",
  "Ariane Lipski": "Ariane da Silva",
  "Ashton J Fletcher": "AJ Fletcher",
  "Athlone Dobson": "AJ Dobson",
  "Brendson Santos": "Brendson Ribeiro",
  "Brianna Vanburen": "Brianna Fortino",
  "Carlos B Vergara Jr": "CJ Vergara",
  "Carlos B Vergara Jr.": "CJ Vergara",
  "Carlos Ferreira": "Diego Ferreira",
  "Carlos Vergara Jr.": "CJ Vergara",
  "Cathia A Fairn": "Zarah Fairn",
  "Cesar De Oliveira": "Cesar Almeida",
  "Crystal Demopoulos": "Vanessa Demopoulos",
  "Crystal V Demopoulos": "Vanessa Demopoulos",
  "DaMon M Blackshear": "Da'Mon Blackshear",
  "Dmitry Smolyakov": "Dmitrii Smoliakov",
  "Dong Hyun -Maestro- Kim": "Dong Hyun Ma",
  "Elekana \"Billy\" Joseph": "Billy Elekana",
  "Elves B Oliveira": "Elves Brener",
  "Elves Oliveira": "Elves Brener",
  "Estevan Garcia": "Steve Garcia",
  "Felipe Souza": "Felipe dos Santos",
  "Gabriella Hermogenes": "Gabriella Fernandes",
  "Gautier Ateba Abega": "Ateba Gautier",
  "George Tokkos": "Tuco Tokkos",
  "Giovanna Canuto": "Gigi Canuto",
  "Godofredo Castro": "Godofredo Pepey",
  "Hannah Goldschmidt": "Hannah Goldy",
  "Hunter S Carlyle": "Spike Carlyle",
  "Iasmin Bezerra": "Iasmin Lucindo",
  "Iasmin L Bezerra": "Iasmin Lucindo",
  "Ignacio Silva Souza Valter": "Valter Walker",
  "Ignacio Silva Souza Walker": "Valter Walker",
  "Isaac Villanueva": "Ike Villanueva",
  "Jackson Jean Silva": "Jean Silva",
  "Jackson Silva": "Jean Silva",
  "Jaqueline Ramos": "Jaqueline Amorim",
  "Jason Perrin": "Jay Perrin",
  "Jaun-Pierre Buys": "JP Buys",
  "JaunPierre Buys": "JP Buys",
  "Joanne Calderwood": "Joanne Wood",
  "Jonathan Kaholokai Kamaka III": "Kai Kamaka III",
  "Jonathan M Cucciniello": "Jay Cucciniello",
  "Jose Mariscal": "Chepe Mariscal",
  "Joseph K Maness": "Nate Maness",
  "Joseph Maness": "Nate Maness",
  "Joshua Thawng": "Joshua Van",
  "Joshua V Thawng": "Joshua Van",
  "Josuely De Moura": "Eduarda Moura",
  "Josuely E De Moura": "Eduarda Moura",
  "Julia Shumate": "Julia Avila",
  "Junior Dos Santos Almeida": "Junior Dos Santos",
  "Kailyn Hansen": "Kay Hansen",
  "Kalinn F Williams": "Khaos Williams",
  "Kalinn Williams": "Khaos Williams",
  "Kanwarajit Bhullar": "KB Bhullar",
  "Karine de Almeida": "Karine Silva",
  "Karolline Cavedo": "Karol Rosa",
  "Katlyn Chookagian": "Katlyn Cerminara",
  "Kaue F Pinheiro": "Kaue Fernandes",
  "Kaue Pinheiro": "Kaue Fernandes",
  "Kevin Swanson": "Cub Swanson",
  "Landon Q Stewart": "Landon Quinones",
  "Landon Stewart": "Landon Quinones",
  "Leomana Martínez": "Mana Martinez",
  "Liana Dzhodzhua": "Liana Jojua",
  "Luana C Souza": "Luana Carolina",
  "Luana Souza": "Luana Carolina",
  "Luis F Colares": "Felipe Colares",
  "Maheshate Hayisaer": "Maheshate",
  "Marcus Vinicius Oliveira de Almeida": "Marcus Buchecha",
  "Maria G Godinez": "Loopy Godinez",
  "Maria Godinez": "Loopy Godinez",
  "Matheus Pereira": "Matheus Nicolau",
  "Melissa Regonha": "Melissa Gatto",
  "Miguel Bunes da Silva": "Felipe Bunes",
  "Miguel Felipe Bunes da Silva": "Felipe Bunes",
  "Mizuki Inoue": "Mizuki",
  "Mohammad Sanad": "Mohammad Yahya",
  "Nikolija Milosevic": "Nina Milosevic",
  "Oliver Schmid": "Ollie Schmid",
  "Patricio Andre de Sousa Freire": "Patricio Pitbull",
  "Patrick Holohan": "Paddy Holohan",
  "Patrick M Pimblett": "Paddy Pimblett",
  "Patrick Pimblett": "Paddy Pimblett",
  "Pedro Estevan Rodriguez": "Pete Rodriguez",
  "Pedro Rodriguez": "Pete Rodriguez",
  "Polo Reyes": "Marco Polo Reyes",
  "Raulian Frazao": "Raulian Paiva",
  "Renato Carneiro": "Renato Moicano",
  "Richard Harris": "RJ Harris",
  "Richard Ogden": "Trey Ogden",
  "Richard T Ogden": "Trey Ogden",
  "Rodolfo Srour": "Rodolfo Vieira",
  "Rodrigo Ferreira": "Rodrigo Nascimento",
  "Rodrigo Vargas Mejia": "Kazula Vargas",
  "Rony Mariano Bezerra": "Rony Jason",
  "Shaqueme Rock": "Shem Rock",
  "Suphisara Konlak": "Loma Lookboonmee",
  "Tamires da Silva": "Tamires Vidal",
  "Tejovan A Edwards": "Te Edwards",
  "Thomas Gantt": "Tommy Gantt",
  "Todd J Laramie": "TJ Laramie",
  "Trenton J Brown": "TJ Brown",
  "Veronica Macedo": "Veronica Hardy",
  "Victoria Mason": "Victoria Leonardo",
  "Walker Souza": "Johnny Walker",
  "Yana Kunitskaya": "Yana Santos",
  "Yanal Admuz": "Yanal Ashmouz",
  "Zachary Ottow": "Zak Ottow",
};

export interface AntidopingRow { year: number; name: string; tests: number }

/** The rows of one year's table. Throws on a page that isn't the table, so a
 *  challenge or error page can never empty a stored year. */
export function parseAntidopingTests(html: string, year: number): AntidopingRow[] {
  const $ = cheerio.load(html);
  const table = $("table.testResults--table");
  if (!table.length || !/test sessions/i.test(table.find("thead").text())) throw new Error("anti-doping test table not found");
  const rows = table.find("tbody tr").map((_i, tr) => {
    const cells = $(tr).children();
    const name = cleanText(cells.eq(1).text());
    const tests = Number(cleanText(cells.eq(2).text()));
    return Number(cleanText(cells.eq(0).text())) === year && name && Number.isInteger(tests) && tests >= 0 ? { year, name, tests } : null;
  }).get() as AntidopingRow[];
  const shown = Number($("#displayCount").text().match(/\d+/)?.[0]);
  if (!rows.length || (Number.isFinite(shown) && shown !== rows.length)) throw new Error(`anti-doping ${year}: read ${rows.length} of ${shown} rows`);
  return rows;
}

/** The names a source row may mean: as written, and without the nickname it
 *  sometimes carries in quotes, brackets or dashes ("Austin (Aj) Cunningham",
 *  "Luis -KLB- Henrique"). */
function sourceNames(name: string): string[] {
  const nickname = /"([^"]+)"|\(([^)]+)\)|(?:^|\s)-([^-\s][^-]*)-(?=\s)/;
  const bare = cleanText(name.replace(new RegExp(nickname, "g"), " "));
  const nick = name.match(nickname)?.slice(1).find(Boolean);
  const last = bare.split(" ").at(-1);
  return [...new Set([name, bare, ...(nick && last ? [`${nick} ${last}`] : [])].map(normName).filter(Boolean))];
}

// Words that join family names ("Chagas da Costa"), never a name on their own.
const PARTICLES = new Set(["da", "de", "do", "dos", "das", "del", "la", "e", "y", "jr", "junior"]);
const words = (norm: string) => norm.split(" ").filter((word) => !PARTICLES.has(word));
/** A name run together, either way round ("Yi Zha" / "Yizha", "Zhu Rong" / "Rongzhu"). */
const joined = (norm: string) => { const all = norm.split(" "); return [all.join(""), [...all.slice(1), all[0]].join("")]; };

/** The same person written longer or shorter: one name's words appear, in
 *  order, within the other's, starting with the same given name and keeping
 *  the shorter one's surname ("Diego Lopes Da Silva" for "Diego Lopes",
 *  "Christian Duncan" for "Christian Leroy Duncan"). Or the same words in
 *  another order or spacing ("Doo Ho Choi" for "Dooho Choi"). */
export function sameAthlete(source: string, stored: string): boolean {
  const a = words(source);
  const b = words(stored);
  if (source.replace(/ /g, "").length >= 5 && joined(source).some((name) => joined(stored).includes(name))) return true;
  if (a.length < 2 || b.length < 2) return false;
  if ([...a].sort().join(" ") === [...b].sort().join(" ")) return true;
  if (givenName(a[0]) !== givenName(b[0])) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let at = 1;
  for (const word of short.slice(1)) {
    while (at < long.length && long[at] !== word) at++;
    if (at++ >= long.length) return false;
  }
  return true;
}

/** A registered name for a ring name, said only of a fighter who fought that
 *  year with no tests found under their own name: the stored surname is one
 *  of the source's, and the given names begin alike ("Kamarudeen Usman" for
 *  Kamaru Usman, "Robert Lawler" for Robbie) or the source carries the stored
 *  one ("Mohammad Nasrat Haqparast"). */
export function registeredName(source: string, stored: string): boolean {
  const a = words(source);
  const b = words(stored);
  if (a.length < 2 || b.length < 2 || !a.slice(1).includes(b.at(-1)!)) return false;
  return a.includes(b[0]) || (a[0].length >= 3 && b[0].length >= 3 && a[0].slice(0, 3) === b[0].slice(0, 3));
}

/** The same words transliterated another way, two letters apart at most
 *  ("Andrei Puliaev" / "Andrey Pulyaev"), each word beginning and ending
 *  alike, so a Bruna is never a Bruno. */
export function spelledAlike(source: string, stored: string): boolean {
  const a = source.split(" ");
  const b = stored.split(" ");
  const end = (word: string) => word.at(-1)!.replace("y", "i");
  return a.length >= 2 && a.length === b.length && source.length >= 10 && editDistance(source, stored) <= 2
    && a.every((word, i) => (word[0] === b[i][0] || (word.length > 3 && word.slice(1, 3) === b[i].slice(1, 3))) && end(word) === end(b[i]));
}

interface Candidate { id: string; norm: string; years: Set<number> }

/** Each row's fighter, or null. An exact name is trusted when it is one
 *  fighter (or one who fought within a few years of the tests); anything
 *  looser only when it fits a single fighter who fought within that window,
 *  no other row that year claims them, and no row already has them. */
export function matchAntidopingRows(rows: AntidopingRow[], fighters: Candidate[]): (string | null)[] {
  const near = (fighter: Candidate, year: number) => [...fighter.years].some((y) => y >= year - 3 && y <= year + 2);
  const index = new Map<string, Candidate[]>();
  const add = (key: string, fighter: Candidate) => { const list = index.get(key); if (list) list.push(fighter); else index.set(key, [fighter]); };
  for (const fighter of fighters) {
    add(`=${fighter.norm}`, fighter);
    for (const key of [...words(fighter.norm), ...joined(fighter.norm)]) add(key, fighter);
  }
  const byId = new Map(fighters.map((fighter) => [fighter.id, fighter]));
  const names = rows.map((row) => sourceNames(SOURCE_NAMES[row.name] ?? row.name));
  const out = rows.map((): string | null => null);
  const taken = new Set<string>();
  /** Takes each row's pick when no other row that year picks the same fighter. */
  const settle = (pick: (row: AntidopingRow, i: number) => string | null) => {
    const picks = rows.map((row, i) => {
      const id = out[i] ? null : pick(row, i);
      return id && !taken.has(`${row.year} ${id}`) ? id : null;
    });
    const claims = new Map<string, number>();
    rows.forEach((row, i) => { if (picks[i]) claims.set(`${row.year} ${picks[i]}`, (claims.get(`${row.year} ${picks[i]}`) ?? 0) + 1); });
    rows.forEach((row, i) => {
      if (!picks[i] || claims.get(`${row.year} ${picks[i]}`)! > 1) return;
      out[i] = picks[i];
      taken.add(`${row.year} ${picks[i]}`);
    });
  };
  const only = (found: Candidate[]) => { const ids = [...new Set(found.map((fighter) => fighter.id))]; return ids.length === 1 ? ids[0] : null; };
  settle((row, i) => {
    const found = names[i].flatMap((name) => index.get(`=${name}`) ?? []);
    return only(found) ?? only(found.filter((fighter) => near(fighter, row.year)));
  });
  settle((row, i) => only(names[i].flatMap((name) => [...words(name), ...joined(name)].flatMap((key) => index.get(key) ?? []))
    .filter((fighter) => near(fighter, row.year) && names[i].some((name) => sameAthlete(name, fighter.norm)))));
  // A name tied to a fighter in one year means them in the years around it.
  const carry = () => settle((row) => {
    const ids = [...new Set(rows.flatMap((other, j) => other.name === row.name && out[j] ? [out[j]!] : []))];
    return ids.length === 1 && near(byId.get(ids[0])!, row.year) ? ids[0] : null;
  });
  carry();
  // Fighters who fought that year and have no tests yet, by their registered
  // name or another spelling: few enough that one fitting is telling.
  const fought = new Map<number, Candidate[]>();
  for (const fighter of fighters) for (const year of fighter.years) { const list = fought.get(year); if (list) list.push(fighter); else fought.set(year, [fighter]); }
  settle((row, i) => only((fought.get(row.year) ?? [])
    .filter((fighter) => !taken.has(`${row.year} ${fighter.id}`) && !taken.has(`${row.year} ${fighter.id}`)
      && names[i].some((name) => registeredName(name, fighter.norm) || spelledAlike(name, fighter.norm)))));
  carry();
  return out;
}

/** Every fighter with a UFC bout (or booking), and the years they fought. */
function candidates(): Candidate[] {
  const byId = new Map<string, Candidate>();
  const rows = db.prepare(`SELECT fr.id, fr.norm_name, CAST(substr(e.date, 1, 4) AS INTEGER) AS year FROM fights f
    JOIN events e ON e.id = f.event_id JOIN fighters fr ON fr.id IN (f.f1_id, f.f2_id)`).all() as { id: string; norm_name: string; year: number }[];
  for (const row of rows) {
    const fighter = byId.get(row.id) ?? { id: row.id, norm: row.norm_name, years: new Set<number>() };
    fighter.years.add(row.year);
    byId.set(row.id, fighter);
  }
  return [...byId.values()];
}

/** Ties every stored row to its fighter again: fighters join the archive when
 *  first booked, often after their first tests. Writes only what changed. */
export function linkAntidopingRows(): void {
  const rows = db.prepare("SELECT year, name, tests, fighter_id FROM antidoping_tests ORDER BY year, name").all() as unknown as (AntidopingRow & { fighter_id: string | null })[];
  const ids = matchAntidopingRows(rows, candidates());
  const update = db.prepare("UPDATE antidoping_tests SET fighter_id = ? WHERE year = ? AND name = ?");
  db.exec("BEGIN");
  try {
    rows.forEach((row, i) => { if (row.fighter_id !== ids[i]) update.run(ids[i], row.year, row.name); });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Replaces one year's rows when the source's differ. */
function storeYear(year: number, rows: AntidopingRow[]): void {
  const stored = db.prepare("SELECT name, tests FROM antidoping_tests WHERE year = ? ORDER BY name").all(year) as { name: string; tests: number }[];
  const fresh = [...new Map(rows.map((row) => [row.name, row.tests])).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (JSON.stringify(stored.map((row) => [row.name, row.tests])) === JSON.stringify(fresh)) return;
  const insert = db.prepare("INSERT INTO antidoping_tests (year, name, tests) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM antidoping_tests WHERE year = ?").run(year);
    for (const [name, tests] of fresh) insert.run(year, name, tests);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** The source updates its current year weekly and may correct the one just
 *  ended: read those each day, and any earlier year not yet stored once. */
export async function syncAntidopingTests(now = new Date()): Promise<void> {
  const current = now.getUTCFullYear();
  const stored = new Set((db.prepare("SELECT DISTINCT year FROM antidoping_tests").all() as { year: number }[]).map((row) => row.year));
  for (let year = FIRST_ANTIDOPING_YEAR; year <= current; year++) {
    if (year < current - 1 && stored.has(year)) continue;
    const html = await fetchHtml(`${ANTIDOPING_SOURCE}?year=${year}`);
    // The current year's table is empty until its first tests are posted.
    if (year === current && !/<tbody>\s*<tr>/.test(html)) continue;
    storeYear(year, parseAntidopingTests(html, year));
  }
  linkAntidopingRows();
}

export interface AntidopingYear { year: number; tests: number }

/** A fighter's tests by year, oldest first. */
export function fighterAntidopingTests(id: string): AntidopingYear[] {
  return prepared("SELECT year, tests FROM antidoping_tests WHERE fighter_id = ? ORDER BY year").all(id) as unknown as AntidopingYear[];
}

export interface AntidopingGap { id: string; name: string; year: number; unmatched: string[] }

/** Fighters who fought in a year the source has read with no tests tied to
 *  them that year: almost always a registered name nothing here ties yet. The
 *  same year's unmatched rows that share a word with the name come along as
 *  leads. The program's first half-year (2015) is left out. */
export function antidopingGaps(today = new Date().toISOString().slice(0, 10)): AntidopingGap[] {
  const gaps = db.prepare(`SELECT DISTINCT fr.id, fr.name, CAST(substr(e.date, 1, 4) AS INTEGER) AS year
    FROM fights f JOIN events e ON e.id = f.event_id JOIN fighters fr ON fr.id IN (f.f1_id, f.f2_id)
    WHERE e.date >= '${FIRST_ANTIDOPING_YEAR + 1}-01-01' AND e.date <= ?
      AND CAST(substr(e.date, 1, 4) AS INTEGER) IN (SELECT DISTINCT year FROM antidoping_tests)
      AND NOT EXISTS (SELECT 1 FROM antidoping_tests a WHERE a.fighter_id = fr.id AND a.year = CAST(substr(e.date, 1, 4) AS INTEGER))
    ORDER BY year DESC, fr.name`).all(today) as { id: string; name: string; year: number }[];
  const unmatched = db.prepare("SELECT year, name FROM antidoping_tests WHERE fighter_id IS NULL").all() as { year: number; name: string }[];
  return gaps.map((gap) => {
    const mine = new Set(words(normName(gap.name)));
    return { ...gap, unmatched: unmatched.filter((row) => row.year === gap.year && sourceNames(row.name).some((name) => words(name).some((word) => mine.has(word)))).map((row) => row.name) };
  });
}

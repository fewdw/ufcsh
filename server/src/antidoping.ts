import * as cheerio from "cheerio";
import { readFileSync } from "node:fs";
import { db, getMeta, prepared, setMeta } from "./db.ts";
import { fetchHtml } from "./http.ts";
import { cleanText, givenName, normName } from "./util.ts";

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
  // Previously reviewed source variants: explicit so new names cannot be
  // attached merely by a similar spelling or a shared first-name prefix.
  "Abdul- Rakhman Iakhiaev": "Abdul Rakhman Yakhyaev",
  "Abusupiyan Magomedov": "Abus Magomedov",
  "Ailiin L Perez": "Ailin Perez",
  "Aleksander Rakic": "Aleksandar Rakic",
  "Alexandra Albu": "Aleksandra Albu",
  "Ana Talita Alencar": "Talita Alencar",
  "Andrei Puliaev": "Andrey Pulyaev",
  "Antonio Rogerio R Nogueira": "Rogerio Nogueira",
  "Asef Chopurov": "Asaf Chopurov",
  "Assu Almabayev": "Asu Almabayev",
  "Austin (Aj) Cunningham": "AJ Cunningham",
  "Avelina Montserrat Conejo Ruiz": "Montserrat Conejo Ruiz",
  "Avelina Montserrat Ruiz": "Montserrat Conejo Ruiz",
  "Beata Malecki": "Bea Malecki",
  "Ben Henderson": "Benson Henderson",
  "Bradley D Katona": "Brad Katona",
  "Bradley Katona": "Brad Katona",
  "Bradley S Riddell": "Brad Riddell",
  "Bradley Scott": "Brad Scott",
  "Bradley Tavares": "Brad Tavares",
  "Cameron Rowston": "Cam Rowston",
  "Carlos Diego Ferreira": "Diego Ferreira",
  "Carlos Gabriel Silva": "Gabriel Silva",
  "Caroline Foro Antunes": "Carol Foro",
  "Cathilee Zingano": "Cat Zingano",
  "Danut-Andrei Frunza": "Daniel Frunza",
  "Dariya Zhelezniakova": "Daria Zhelezniakova",
  "David Grant": "Davey Grant",
  "David Joby Sanchez": "Joby Sanchez",
  "Diorden Santos": "Djorden Santos",
  "Dmitry Sosnoviskiy": "Dmitry Sosnovskiy",
  "Donrichard Shainis": "Don Shainis",
  "Enrique Hecher Sosa De Rada": "Hecher Sosa",
  "Ernesta Karechaite": "Ernesta Kareckaite",
  "Ezra Elliot": "Ezra Elliott",
  "Fernando Garcia": "Fernie Garcia",
  "Francisco Mir": "Frank Mir",
  "Frank Edgar": "Frankie Edgar",
  "Gabriel A Green": "Gabe Green",
  "Gabriel Green": "Gabe Green",
  "Gabriel Xavier Kamuela Kirk": "Kamuela Kirk",
  "Geoffrey Neal": "Geoff Neal",
  "Grigorii Popov": "Grigory Popov",
  "Ian D Garry": "Ian Machado Garry",
  "Ignacio (Valter) Silva Souza Walker": "Valter Walker",
  "Irwing Rivera": "Irwin Rivera",
  "Isabella De Padua": "Isabela de Padua",
  "James E Krause-Simmons, Jr.": "Jamey Simmons",
  "Jamey L Horth": "Jamey-Lyn Horth",
  "Joao Antonio Barbosa Arroyo": "Antonio Arroyo",
  "Jodierae Esquibel": "Jodie Esquibel",
  "John M Munoz Junior": "Johnny Munoz",
  "Juan Adrian Luna Martinetti": "Adrian Luna Martinetti",
  "Kamarudeen Usman": "Kamaru Usman",
  "Karen Alexa Grasso Montes": "Alexa Grasso",
  "Karolina Kowalkeiwicz": "Karolina Kowalkiewicz",
  "Karolline Rosa Cavedo": "Karol Rosa",
  "Kevin (Cub) Swanson": "Cub Swanson",
  "Khaled Taha": "Khalid Taha",
  "Kleidison D Rodrigues": "Kleydson Rodrigues",
  "Kleidison Rodrigues": "Kleydson Rodrigues",
  "Kristopher B Moutinho": "Kris Moutinho",
  "Kristopher Moutinho": "Kris Moutinho",
  "Landon Vannata": "Lando Vannata",
  "Livia Renata dos Santos Souza": "Livinha Souza",
  "Lok Yin Lawrence Lui": "Lawrence Lui",
  "Lone'er Kavanaugh": "Lone'er Kavanagh",
  "Luis Dias de Assis": "Luis Felipe Dias",
  "Luis Felipe Olivieri": "Felipe Olivieri",
  "Luiz -Frankenstein- Henrique da Silva": "Henrique da Silva",
  "Magomed Gadzhiiasulov": "Magomed Gadzhiyasulov",
  "Magomed Zainukov": "Magomed Zaynukov",
  "Mahammadeli Osmanli": "Mahammadali Osmanli",
  "Manny Gamburyan": "Manvel Gamburyan",
  "Manuel A Bermudez": "Manny Bermudez",
  "Mariachiara Borella": "Mara Romero Borella",
  "Mehdi Bagdad": "Mehdi Baghdad",
  "Michael Gall": "Mickey Gall",
  "Mitchell Ramirez": "Mitch Ramirez",
  "Mohammad Nasrat Haqparast": "Nasrat Haqparast",
  "Montserrat Rendón Fernández": "Montse Rendon",
  "Muhammadjon Naimov": "Muhammad Naimov",
  "Nadim S Narimani": "Nad Narimani",
  "Nathan Landwehr": "Nate Landwehr",
  "Nathan W Landwehr": "Nate Landwehr",
  "Omar Nurmagomedov": "Umar Nurmagomedov",
  "Patrick Ethan Mix": "Patchy Mix",
  "Phillip A Rowe": "Phil Rowe",
  "Phillip Hawes": "Phil Hawes",
  "Phillip Rowe": "Phil Rowe",
  "Pierangela Rodriguez": "Piera Rodriguez",
  "Pierangela Rodríguez": "Piera Rodriguez",
  "Rafael Garcia Jr": "Rafa Garcia",
  "Rafael Garcia Jr.": "Rafa Garcia",
  "Ramazonbek Temirov": "Ramazan Temirov",
  "Rick Glenn": "Ricky Glenn",
  "Robert Lawler": "Robbie Lawler",
  "Roberto Sanchez": "Robert Sanchez",
  "Ronald D Lawrence III": "Ronnie Lawrence",
  "Ronaldo Jacare Souza": "Jacare Souza",
  "Rostam Akman": "Rostem Akman",
  "Saigid Izagakhmaev": "Saygid Izagakhmaev",
  "Samantha Hughes": "Sam Hughes",
  "Samantha K Hughes": "Sam Hughes",
  "Sharabutdin Magomedov": "Shara Magomedov",
  "Stanley Dorsainvil": "Stan Dorsainvil",
  "Stephen Erceg": "Steve Erceg",
  "Timothy Cuamba": "Timmy Cuamba",
  "Valentine Woodburn": "Val Woodburn",
  "William Javier Reyes Rugeles": "Javier Reyes",
  "Yasin Mansur Abdul-Malik": "Mansur Abdul-Malik",
  "Zachary Pauga": "Zac Pauga",
  // Commission result sheets naming these athletes: docs/antidoping.md.
  "Alexia Pereira": "Alexia Thainara",
  "Claudio Ribeiro da Silva": "Claudio Ribeiro",
  "Eduardo Dos Santos": "Eduardo Chapolin",
  "Lucas Fernandes": "Lucas Rocha",
  "Manuel P Gomes": "Manel Kape",
  "Manuel Gomes": "Manel Kape",
  "Marco Costa": "Marco Tulio",
  "Miguel Martinez Aceves": "David Martinez",
  "Pascall Saumani Milo": "Junior Tafa",
  "Pascall Milo": "Junior Tafa",
  "Zhakwarius Y Johnson": "Jose Johnson",
  "Zhakwarius Johnson": "Jose Johnson",
};

/** The two Bruno Silvas cannot be distinguished by the display name. The
 *  commission/UFC evidence identifies these registered names individually. */
export const SOURCE_IDS: Record<string, string> = {
  "Bruno Arruda": "12ebd7d157e91701", // Blindado, 1989-07-13
  "Bruno Gustavo Aparecido": "294aa73dbf37d281", // Bulldog, 1990-03-16
  "Bruno Aparecido": "294aa73dbf37d281",
};

export interface AntidopingRow { year: number; name: string; tests: number }

/** The rows of one year's table. Throws on a page that isn't the table, so a
 *  challenge or error page can never empty a stored year. */
export function parseAntidopingTests(html: string, year: number, allowEmpty = false): AntidopingRow[] {
  const $ = cheerio.load(html);
  const table = $("table.testResults--table");
  if (table.length !== 1 || !/test sessions/i.test(table.find("thead").text())) throw new Error("anti-doping test table not found");
  const shown = $("#displayCount").text().match(/^\s*Displaying\s+([\d,]+)\s+Entries\s*$/i)?.[1];
  if (shown == null) throw new Error(`anti-doping ${year}: entry count missing`);
  const rows = table.find("tbody tr").map((_i, tr) => {
    const cells = $(tr).children();
    const name = cleanText(cells.eq(1).text());
    const count = cleanText(cells.eq(2).text());
    if (cells.length !== 3 || cleanText(cells.eq(0).text()) !== String(year) || !name || !/^\d+$/.test(count)) {
      throw new Error(`anti-doping ${year}: invalid row`);
    }
    return { year, name, tests: Number(count) };
  }).get() as AntidopingRow[];
  if (Number(shown.replaceAll(",", "")) !== rows.length || (!allowEmpty && !rows.length)) {
    throw new Error(`anti-doping ${year}: read ${rows.length} of ${shown} rows`);
  }
  if (!rows.length && $("#year option[selected]").attr("value") !== String(year)) {
    throw new Error(`anti-doping ${year}: empty table year not confirmed`);
  }
  validateRows(rows, year);
  return rows;
}

function validateRows(rows: AntidopingRow[], year: number): void {
  const names = new Set<string>();
  for (const row of rows) {
    if (row.year !== year || typeof row.name !== "string" || !row.name.trim()
      || !Number.isSafeInteger(row.tests) || row.tests < 0 || names.has(row.name)) {
      throw new Error(`anti-doping ${year}: invalid or duplicate athlete`);
    }
    names.add(row.name);
  }
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
  const aliases = new Map(Object.entries(SOURCE_NAMES).map(([source, stored]) => [normName(source), stored]));
  const identities = new Map(Object.entries(SOURCE_IDS).map(([source, id]) => [normName(source), id]));
  const names = rows.map((row) => sourceNames(aliases.get(normName(row.name)) ?? row.name));
  const out = rows.map((): string | null => null);
  const taken = new Set<string>();
  const conflicted = new Set<string>();
  /** Takes each row's pick when no other row that year picks the same fighter. */
  const settle = (pick: (row: AntidopingRow, i: number) => string | null) => {
    const picks = rows.map((row, i) => {
      const id = out[i] ? null : pick(row, i);
      return id && !taken.has(`${row.year} ${id}`) && !conflicted.has(`${row.year} ${id}`) ? id : null;
    });
    const claims = new Map<string, number>();
    rows.forEach((row, i) => { if (picks[i]) claims.set(`${row.year} ${picks[i]}`, (claims.get(`${row.year} ${picks[i]}`) ?? 0) + 1); });
    rows.forEach((row, i) => {
      if (!picks[i]) return;
      if (claims.get(`${row.year} ${picks[i]}`)! > 1) {
        conflicted.add(`${row.year} ${picks[i]}`);
        return;
      }
      out[i] = picks[i];
      taken.add(`${row.year} ${picks[i]}`);
    });
  };
  const only = (found: Candidate[]) => { const ids = [...new Set(found.map((fighter) => fighter.id))]; return ids.length === 1 ? ids[0] : null; };
  settle((row) => {
    const id = identities.get(normName(row.name));
    return id && byId.has(id) ? id : null;
  });
  settle((row, i) => {
    const found = names[i].flatMap((name) => index.get(`=${name}`) ?? []);
    return only(found) ?? only(found.filter((fighter) => near(fighter, row.year)));
  });
  settle((row, i) => only(names[i].flatMap((name) => [...words(name), ...joined(name)].flatMap((key) => index.get(key) ?? []))
    .filter((fighter) => near(fighter, row.year) && names[i].some((name) => sameAthlete(name, fighter.norm)))));
  // A name tied to a fighter in one year means them in the years around it.
  const carried = new Map<string, Set<string>>();
  rows.forEach((row, i) => {
    if (!out[i]) return;
    const ids = carried.get(row.name) ?? new Set<string>();
    ids.add(out[i]!);
    carried.set(row.name, ids);
  });
  settle((row) => {
    const ids = [...(carried.get(row.name) ?? [])];
    return ids.length === 1 && near(byId.get(ids[0])!, row.year) ? ids[0] : null;
  });
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
  db.exec("BEGIN IMMEDIATE");
  try {
    relinkAntidopingRows();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function relinkAntidopingRows(): void {
  const rows = db.prepare("SELECT year, name, tests, fighter_id FROM antidoping_tests ORDER BY year, name").all() as unknown as (AntidopingRow & { fighter_id: string | null })[];
  const ids = matchAntidopingRows(rows, candidates());
  const update = db.prepare("UPDATE antidoping_tests SET fighter_id = ? WHERE year = ? AND name = ?");
  rows.forEach((row, i) => { if (row.fighter_id !== ids[i]) update.run(ids[i], row.year, row.name); });
}

/** Replaces one year's rows when the source's differ. */
function storeYear(year: number, rows: AntidopingRow[]): void {
  const stored = db.prepare("SELECT name, tests FROM antidoping_tests WHERE year = ? ORDER BY name").all(year) as { name: string; tests: number }[];
  const fresh = [...new Map(rows.map((row) => [row.name, row.tests])).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (JSON.stringify(stored.map((row) => [row.name, row.tests])) === JSON.stringify(fresh)) return;
  const insert = db.prepare("INSERT INTO antidoping_tests (year, name, tests) VALUES (?, ?, ?)");
  db.prepare("DELETE FROM antidoping_tests WHERE year = ?").run(year);
  for (const [name, tests] of fresh) insert.run(year, name, tests);
}

const HISTORY_INTERVAL = 30 * 86_400_000;
let refreshing: Promise<void> | null = null;

/** Current and previous years daily; older years monthly so historical
 *  corrections are picked up too. Nothing is published until every page is
 *  validated, then counts and identity links commit together. */
export function syncAntidopingTests(now = new Date(), options: { history?: boolean } = {}): Promise<void> {
  // The scheduler and an admin repair can arrive together. Share the work.
  return refreshing ??= refreshAntidopingTests(now, options).finally(() => { refreshing = null; });
}

async function refreshAntidopingTests(now: Date, { history = false }: { history?: boolean }): Promise<void> {
  const current = now.getUTCFullYear();
  const stored = new Set((db.prepare("SELECT DISTINCT year FROM antidoping_tests").all() as { year: number }[]).map((row) => row.year));
  const checked = Number(getMeta("antidoping_history_checked_at"));
  const readHistory = history || !checked || now.getTime() - checked >= HISTORY_INTERVAL;
  const fresh = new Map<number, AntidopingRow[]>();
  for (let year = FIRST_ANTIDOPING_YEAR; year <= current; year++) {
    if (year < current - 1 && stored.has(year) && !readHistory) continue;
    const html = await fetchHtml(`${ANTIDOPING_SOURCE}?year=${year}`);
    const rows = parseAntidopingTests(html, year, year === current);
    // A genuinely empty new year is fine, but never erase an existing year.
    if (!rows.length && stored.has(year)) throw new Error(`anti-doping ${year}: stored year became empty`);
    fresh.set(year, rows);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [year, rows] of fresh) {
      storeYear(year, rows);
      setMeta(`antidoping_year_${year}_checked_at`, String(now.getTime()));
    }
    relinkAntidopingRows();
    if (readHistory) setMeta("antidoping_history_checked_at", String(now.getTime()));
    setMeta("antidoping_synced_at", String(now.getTime()));
    setMeta("antidoping_error", "");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface AntidopingSnapshot {
  source: string;
  checkedAt: string;
  years: { year: number; rows: [name: string, tests: number][] }[];
}

export function readAntidopingSnapshot(): AntidopingSnapshot {
  const snapshot: AntidopingSnapshot = JSON.parse(readFileSync(new URL("./antidoping-data.json", import.meta.url), "utf8"));
  const date = new Date(snapshot.checkedAt);
  if (snapshot.source !== ANTIDOPING_SOURCE || !Number.isFinite(date.getTime())
    || snapshot.years.length !== date.getUTCFullYear() - FIRST_ANTIDOPING_YEAR + 1) throw new Error("invalid anti-doping snapshot");
  snapshot.years.forEach(({ year, rows }, i) => {
    if (year !== FIRST_ANTIDOPING_YEAR + i || (!rows.length && year !== date.getUTCFullYear())) throw new Error("incomplete anti-doping snapshot");
    validateRows(rows.map(([name, tests]) => ({ year, name, tests })), year);
  });
  return snapshot;
}

/** Run before production starts its API/sync workers, and before local HTTP.
 *  Only public source rows are bundled; identities use the live local archive.
 *  A redeploy or rollback never replaces data checked more recently online. */
export function seedAntidopingTests(): void {
  const snapshot = readAntidopingSnapshot();
  if (getMeta("antidoping_seed_at") === snapshot.checkedAt) {
    // New aliases or newly booked fighters can change links independently
    // of the source snapshot. Re-evaluate, writing only changed identities.
    linkAntidopingRows();
    return;
  }
  const checked = Date.parse(snapshot.checkedAt);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { year, rows } of snapshot.years) {
      const existing = Number(getMeta(`antidoping_year_${year}_checked_at`) ?? getMeta("antidoping_synced_at"));
      if (existing >= checked) continue;
      storeYear(year, rows.map(([name, tests]) => ({ year, name, tests })));
      setMeta(`antidoping_year_${year}_checked_at`, String(checked));
    }
    relinkAntidopingRows();
    setMeta("antidoping_seed_at", snapshot.checkedAt);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface AntidopingYear { year: number; tests: number }

/** A fighter's tests by year, oldest first. */
export function fighterAntidopingTests(id: string): AntidopingYear[] {
  return prepared("SELECT year, tests FROM antidoping_tests WHERE fighter_id = ? ORDER BY year").all(id) as unknown as AntidopingYear[];
}

/** Include people not yet booked, inactive fighters, and years without a
 *  bout: missing identity links must stay visible to admins in every case. */
export function unlinkedAntidopingRows(): AntidopingRow[] {
  return db.prepare("SELECT year, name, tests FROM antidoping_tests WHERE fighter_id IS NULL ORDER BY year DESC, name").all() as unknown as AntidopingRow[];
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

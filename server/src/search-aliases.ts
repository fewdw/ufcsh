import { normName } from "./util.ts";

/** Other names fans type for a fighter, keyed by the fighter's stored name.
 *  Search finds a fighter by these, but they never show on the site. Only
 *  names search can't already reach belong here: the stored name and
 *  nickname are searched anyway, words may be cut short, and small typos
 *  are forgiven. The Bugs board lists keys that stop naming one fighter. */
export const SEARCH_ALIASES: Record<string, string[]> = {
  // Initials
  "Georges St-Pierre": ["GSP", "Georges Saint-Pierre"],
  "Ovince Saint Preux": ["OSP", "Ovince St. Preux"],
  "Junior Dos Santos": ["JDS"],
  "Rafael Dos Anjos": ["RDA"],
  "Dricus Du Plessis": ["DDP"],
  "Jack Della Maddalena": ["JDM"],
  "Jon Jones": ["JBJ", "Jonny Bones"],
  "Jiri Prochazka": ["BJP", "Denisa"],
  "Demetrious Johnson": ["DJ"],
  "Chan Sung Jung": ["TKZ", "KZ"],
  "Carlos Condit": ["NBK"],
  "Paige VanZant": ["PVZ"],
  "Germaine de Randamie": ["GDR"],
  "Joanna Jedrzejczyk": ["JJ", "Joanna Champion"],
  "Michael Page": ["MVP"],
  "Antonio Carlos Junior": ["ACJ", "Shoeface"],

  // Other nicknames
  "Aljamain Sterling": ["Aljo", "Funkmaster"],
  "Israel Adesanya": ["Izzy"],
  "Conor McGregor": ["Mystic Mac"],
  "Kamaru Usman": ["Marty"],
  "Jorge Masvidal": ["Street Jesus"],
  "Nate Diaz": ["Stockton"],
  "Nick Diaz": ["Stockton"],
  "Sean O'Malley": ["Sugar", "Sugar Sean"],
  "Sean Strickland": ["Tarzan"],
  "Robert Whittaker": ["Bobby Knuckles"],
  "Khamzat Chimaev": ["The Wolf"],
  "Paulo Costa": ["Borrachinha"],
  "Alex Pereira": ["Chama"],
  "Jan Blachowicz": ["Polish Power", "Legendary Polish Power"],
  "Cory Sandhagen": ["The Sandman"],
  "Henry Cejudo": ["The Messenger", "King of Cringe"],
  "Deiveson Figueiredo": ["Figgy", "God of War"],
  "Jose Aldo": ["Scarface", "King of Rio"],
  "Zabit Magomedsharipov": ["ZaBeast"],
  "Eddie Alvarez": ["The Underground King"],
  "Benson Henderson": ["Bendo"],
  "Arman Tsarukyan": ["Ahalkalakets"],
  "Alistair Overeem": ["Reem", "Ubereem"],
  "Brock Lesnar": ["The Beast Incarnate"],
  "Antonio Rodrigo Nogueira": ["Big Nog"],
  "Rogerio Nogueira": ["Little Nog", "Lil Nog", "Antonio Rogerio Nogueira"],
  "Mirko Filipovic": ["Crocop"],
  "Ben Rothwell": ["Big Ben"],
  "Khalil Rountree Jr.": ["The War Horse"],
  "Calvin Kattar": ["The Boston Finisher"],
  "Joseph Benavidez": ["Joe B", "Joe Jitsu"],
  "Renato Moicano": ["Money Moicano", "Renato Carneiro"],
  "Gray Maynard": ["The Bully"],
  "Kevin Holland": ["Big Mouth"],
  "Diego Sanchez": ["The Dream"],
  "Matt Serra": ["The Terror"],
  "Chael Sonnen": ["The American Gangster", "The Bad Guy"],
  "Randy Couture": ["Captain America"],
  "Tito Ortiz": ["Huntington Beach Bad Boy"],
  "Dan Ige": ["50K"],
  "Santiago Ponzinibbio": ["Gente Boa"],
  "Yoshihiro Akiyama": ["Sexyama"],
  "Cub Swanson": ["Killer Cub"],
  "Matt Mitrione": ["Meathead"],
  "Gegard Mousasi": ["The Dreamcatcher"],
  "Yves Edwards": ["Thoroughbred"],

  // Real, maiden and married names
  "King Green": ["Bobby Green"],
  "Jacare Souza": ["Ronaldo Souza"],
  "Loopy Godinez": ["Lupita Godinez"],
  "CM Punk": ["Phil Brooks"],
  "Manvel Gamburyan": ["Manny Gamburyan"],
  "Jussier Formiga": ["Jussier da Silva"],
  "Katlyn Cerminara": ["Katlyn Chookagian"],
  "Tecia Pennington": ["Tecia Torres"],
  "Joanne Wood": ["Joanne Calderwood"],
  "Nina Nunes": ["Nina Ansaroff"],
  "Yana Santos": ["Yana Kunitskaya"],
  "Ariane da Silva": ["Ariane Lipski"],
};

const byName = new Map(Object.entries(SEARCH_ALIASES).map(([name, aliases]) => [normName(name), aliases.map(normName)]));

/** A fighter's aliases, lowercased and spaced as `normName` leaves them. */
export function searchAliases(name: string): string[] {
  return byName.get(normName(name)) ?? [];
}

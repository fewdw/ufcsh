/** The World MMA Awards (Fighters Only magazine, fan-voted since 2008), as
 *  listed at https://en.wikipedia.org/wiki/World_MMA_Awards. Add each new
 *  ceremony at the top of its list.
 *
 *  A UFC fighter is written the way the archive stores the name, and a UFC
 *  bout carries its date, so both link to their pages; the Bugs board lists
 *  any that stop matching. Winners from elsewhere carry their promotion
 *  instead and show as plain text. */

export const AWARDS_SOURCE = { name: "World MMA Awards", url: "https://en.wikipedia.org/wiki/World_MMA_Awards" };

export interface AwardRow {
  /** The award year as printed: a calendar year, or "2019-20" once ceremonies moved mid-year. */
  period: string;
  winner: string;
  /** The promotion the award was won in, when it was not the UFC. */
  org?: string;
  opponent?: string;
  /** Method and round as the award lists them. */
  result?: string;
  event?: string;
  /** The UFC bout's date, which with the two fighters identifies it. */
  date?: string;
  /** What the award was for when it was not one bout. */
  note?: string;
  /** The award's name that year, when it differed. */
  title?: string;
}

export interface AwardCategory {
  id: string;
  label: string;
  /** Both fighters are honoured, so a profile shows it for either. */
  shared?: boolean;
  note?: string;
  rows: AwardRow[];
}

const fighters = (list: [period: string, winner: string, org?: string][]): AwardRow[] =>
  list.map(([period, winner, org]) => ({ period, winner, ...(org ? { org } : {}) }));
const ufc = (period: string, winner: string, opponent: string, result: string, event: string, date: string): AwardRow =>
  ({ period, winner, opponent, result, event, date });
const elsewhere = (org: string, period: string, winner: string, opponent: string, result: string, event: string, note?: string): AwardRow =>
  ({ period, winner, opponent, result, event, org, ...(note ? { note } : {}) });

export const AWARDS: AwardCategory[] = [
  {
    id: "fighter", label: "Fighter of the Year",
    note: "The Charles 'Mask' Lewis Fighter of the Year since 2010.",
    rows: fighters([
      ["2024-25", "Merab Dvalishvili"], ["2023-24", "Alex Pereira"], ["2022-23", "Leon Edwards"],
      ["2021-22", "Alexander Volkanovski"], ["2020-21", "Kamaru Usman"], ["2019-20", "Israel Adesanya"],
      ["2018", "Daniel Cormier"], ["2017", "Max Holloway"], ["2016", "Conor McGregor"], ["2015", "Conor McGregor"],
      ["2014", "Robbie Lawler"], ["2013", "Chris Weidman"], ["2012", "Jon Jones"], ["2011", "Jon Jones"],
      ["2010", "Jose Aldo", "WEC"], ["2009", "Georges St-Pierre"], ["2008", "Anderson Silva"],
    ]),
  },
  {
    id: "female-fighter", label: "Female Fighter of the Year",
    rows: fighters([
      ["2024-25", "Kayla Harrison"], ["2023-24", "Zhang Weili"], ["2022-23", "Alexa Grasso"],
      ["2021-22", "Valentina Shevchenko"], ["2020-21", "Rose Namajunas"], ["2019-20", "Amanda Nunes"],
      ["2018", "Amanda Nunes"], ["2017", "Rose Namajunas"], ["2016", "Amanda Nunes"], ["2015", "Holly Holm"],
      ["2014", "Ronda Rousey"], ["2013", "Ronda Rousey"], ["2012", "Ronda Rousey", "Strikeforce"],
      ["2011", "Miesha Tate", "Strikeforce"], ["2010", "Cristiane Justino", "Strikeforce"],
      ["2009", "Cristiane Justino", "Strikeforce"], ["2008", "Gina Carano", "EliteXC"],
    ]),
  },
  {
    id: "breakthrough-fighter", label: "Breakthrough Fighter of the Year",
    rows: fighters([
      ["2024-25", "Joshua Van"], ["2023-24", "Tom Aspinall"], ["2022-23", "Alex Pereira"],
      ["2021-22", "Paddy Pimblett"], ["2020-21", "Brandon Moreno"], ["2019-20", "Jorge Masvidal"],
      ["2018", "Israel Adesanya"], ["2017", "Brian Ortega"], ["2016", "Cody Garbrandt"], ["2015", "Holly Holm"],
      ["2014", "Kelvin Gastelum"], ["2013", "Travis Browne"], ["2012", "Chris Weidman"], ["2011", "Donald Cerrone"],
      ["2010", "Jon Jones"], ["2009", "Brock Lesnar"], ["2008", "Demian Maia"],
    ]),
  },
  {
    id: "international-fighter", label: "International Fighter of the Year",
    note: "For the leading fighter from outside the Americas; European Fighter of the Year until 2009.",
    rows: [
      ...fighters([
        ["2024-25", "Paddy Pimblett"], ["2023-24", "Dricus Du Plessis"], ["2022-23", "Leon Edwards"],
        ["2021-22", "Alexander Volkanovski"], ["2020-21", "Israel Adesanya"], ["2019-20", "Israel Adesanya"],
        ["2018", "Aung La Nsang", "ONE"], ["2017", "Robert Whittaker"], ["2016", "Khabib Nurmagomedov"],
        ["2015", "Conor McGregor"], ["2014", "Conor McGregor"], ["2013", "Alexander Gustafsson"],
        ["2012", "Michael Bisping"], ["2011", "Alistair Overeem", "Strikeforce"], ["2010", "Alistair Overeem", "Strikeforce"],
      ]),
      { period: "2009", winner: "Gegard Mousasi", org: "Strikeforce", title: "European Fighter of the Year" },
      { period: "2008", winner: "Michael Bisping", title: "European Fighter of the Year" },
    ],
  },
  {
    id: "fight", label: "Fight of the Year", shared: true,
    rows: [
      ufc("2024-25", "Joshua Van", "Brandon Royval", "UD, 3", "UFC 317", "2025-06-28"),
      ufc("2023-24", "Max Holloway", "Justin Gaethje", "KO, 5", "UFC 300", "2024-04-13"),
      ufc("2022-23", "Islam Makhachev", "Alexander Volkanovski", "UD, 5", "UFC 284", "2023-02-11"),
      ufc("2021-22", "Jiri Prochazka", "Glover Teixeira", "Sub, 5", "UFC 275", "2022-06-11"),
      ufc("2020-21", "Deiveson Figueiredo", "Brandon Moreno", "Majority draw, 5", "UFC 256", "2020-12-12"),
      ufc("2019-20", "Zhang Weili", "Joanna Jedrzejczyk", "SD, 5", "UFC 248", "2020-03-07"),
      ufc("2018", "Tony Ferguson", "Anthony Pettis", "TKO, 2", "UFC 229", "2018-10-06"),
      ufc("2017", "Eddie Alvarez", "Justin Gaethje", "KO, 3", "UFC 218", "2017-12-02"),
      ufc("2016", "Cub Swanson", "Dooho Choi", "UD, 3", "UFC 206", "2016-12-10"),
      ufc("2015", "Robbie Lawler", "Rory MacDonald", "TKO, 5", "UFC 189", "2015-07-11"),
      ufc("2014", "Jose Aldo", "Chad Mendes", "UD, 5", "UFC 179", "2014-10-25"),
      ufc("2013", "Jon Jones", "Alexander Gustafsson", "UD, 5", "UFC 165", "2013-09-21"),
      ufc("2012", "Joe Lauzon", "Jamie Varner", "Sub, 3", "UFC on Fox: Shogun vs. Vera", "2012-08-04"),
      ufc("2011", "Frankie Edgar", "Gray Maynard", "Split draw, 5", "UFC 125", "2011-01-01"),
      ufc("2010", "Anderson Silva", "Chael Sonnen", "Sub, 5", "UFC 117", "2010-08-07"),
      ufc("2009", "Diego Sanchez", "Clay Guida", "SD, 3", "The Ultimate Fighter: United States vs. United Kingdom Finale", "2009-06-20"),
      ufc("2008", "Chuck Liddell", "Wanderlei Silva", "UD, 3", "UFC 79", "2007-12-29"),
    ],
  },
  {
    id: "knockout", label: "Knockout of the Year",
    rows: [
      ufc("2024-25", "Mauricio Ruffy", "King Green", "KO, 1", "UFC 313", "2025-03-08"),
      ufc("2023-24", "Max Holloway", "Justin Gaethje", "KO, 5", "UFC 300", "2024-04-13"),
      ufc("2022-23", "Leon Edwards", "Kamaru Usman", "KO, 5", "UFC 278", "2022-08-20"),
      ufc("2021-22", "Michael Chandler", "Tony Ferguson", "KO, 2", "UFC 274", "2022-05-07"),
      ufc("2020-21", "Joaquin Buckley", "Impa Kasanganay", "KO, 2", "UFC Fight Night: Moraes vs. Sandhagen", "2020-10-10"),
      ufc("2019-20", "Jorge Masvidal", "Ben Askren", "KO, 1", "UFC 239", "2019-07-06"),
      ufc("2018", "Amanda Nunes", "Cristiane Justino", "KO, 1", "UFC 232", "2018-12-29"),
      ufc("2017", "Francis Ngannou", "Alistair Overeem", "KO, 1", "UFC 218", "2017-12-02"),
      elsewhere("Bellator", "2016", "Michael Page", "Evangelista Santos", "KO, 2", "Bellator 158"),
      ufc("2015", "Holly Holm", "Ronda Rousey", "KO, 2", "UFC 193", "2015-11-14"),
      ufc("2014", "Mark Hunt", "Roy Nelson", "KO, 2", "UFC Fight Night: Hunt vs. Nelson", "2014-09-20"),
      ufc("2013", "Vitor Belfort", "Luke Rockhold", "KO, 1", "UFC on FX: Belfort vs. Rockhold", "2013-05-18"),
      ufc("2012", "Edson Barboza", "Terry Etim", "KO, 3", "UFC 142", "2012-01-14"),
      ufc("2011", "Anderson Silva", "Vitor Belfort", "KO, 1", "UFC 126", "2011-02-05"),
      ufc("2010", "Mauricio Rua", "Lyoto Machida", "KO, 1", "UFC 113", "2010-05-08"),
      ufc("2009", "Dan Henderson", "Michael Bisping", "KO, 2", "UFC 100", "2009-07-11"),
      ufc("2008", "Wanderlei Silva", "Keith Jardine", "KO, 1", "UFC 84", "2008-05-24"),
    ],
  },
  {
    id: "submission", label: "Submission of the Year",
    rows: [
      ufc("2024-25", "Jean Silva", "Bryce Mitchell", "Ninja choke, 2", "UFC 314", "2025-04-12"),
      ufc("2023-24", "Diego Lopes", "Gavin Tucker", "Armbar, 1", "UFC on ESPN: Sandhagen vs. Font", "2023-08-05"),
      ufc("2022-23", "Alexa Grasso", "Valentina Shevchenko", "Face crank, 4", "UFC 285", "2023-03-04"),
      ufc("2021-22", "Charles Oliveira", "Dustin Poirier", "Rear-naked choke, 3", "UFC 269", "2021-12-11"),
      ufc("2020-21", "Khabib Nurmagomedov", "Justin Gaethje", "Triangle choke, 2", "UFC 254", "2020-10-24"),
      ufc("2019-20", "Demian Maia", "Ben Askren", "Rear-naked choke, 3", "UFC Fight Night: Maia vs. Askren", "2019-10-26"),
      ufc("2018", "Zabit Magomedsharipov", "Brandon Davis", "Suloev stretch, 2", "UFC 228", "2018-09-08"),
      ufc("2017", "Demetrious Johnson", "Ray Borg", "Armbar, 5", "UFC 216", "2017-10-07"),
      ufc("2016", "Nate Diaz", "Conor McGregor", "Rear-naked choke, 2", "UFC 196", "2016-03-05"),
      ufc("2015", "Ronda Rousey", "Cat Zingano", "Straight armbar, 1", "UFC 184", "2015-02-28"),
      ufc("2014", "Ben Saunders", "Chris Heatherly", "Omoplata, 1", "UFC Fight Night: Henderson vs. dos Anjos", "2014-08-23"),
      ufc("2013", "Urijah Faber", "Ivan Menjivar", "Rear-naked choke, 1", "UFC 157", "2013-02-23"),
      ufc("2012", "Frank Mir", "Antonio Rodrigo Nogueira", "Kimura, 1", "UFC 140", "2011-12-10"),
      ufc("2011", "Chan Sung Jung", "Leonard Garcia", "Twister, 2", "UFC Fight Night: Nogueira vs. Davis", "2011-03-26"),
      elsewhere("Strikeforce", "2010", "Fabricio Werdum", "Fedor Emelianenko", "Triangle armbar, 1", "Strikeforce: Fedor vs. Werdum"),
      elsewhere("Bellator", "2009", "Toby Imada", "Jorge Masvidal", "Inverted triangle choke, 3", "Bellator 5"),
      ufc("2008", "Georges St-Pierre", "Matt Hughes", "Armbar, 2", "UFC 79", "2007-12-29"),
    ],
  },
  {
    id: "comeback", label: "Comeback of the Year",
    rows: [
      ufc("2024-25", "Jared Cannonier", "Gregory Rodrigues", "TKO, 4", "UFC Fight Night: Cannonier vs. Rodrigues", "2025-02-15"),
      { period: "2023-24", winner: "Tom Aspinall", note: "Career" },
      ufc("2022-23", "Leon Edwards", "Kamaru Usman", "KO, 5", "UFC 278", "2022-08-20"),
      { period: "2021-22", winner: "Aljamain Sterling", note: "Ridicule and injury" },
      ufc("2020-21", "Charles Oliveira", "Michael Chandler", "TKO, 2", "UFC 262", "2021-05-15"),
      ufc("2019-20", "Stipe Miocic", "Daniel Cormier", "TKO, 4", "UFC 241", "2019-08-17"),
      elsewhere("ONE", "2018", "Angela Lee", "Mei Yamaguchi", "UD, 5", "ONE Championship: Unstoppable Dreams", "Car accident"),
      ufc("2017", "Justin Gaethje", "Michael Johnson", "TKO, 2", "The Ultimate Fighter: Redemption Finale", "2017-07-07"),
      ufc("2016", "Miesha Tate", "Holly Holm", "Sub, 5", "UFC 196", "2016-03-05"),
      ufc("2015", "Eddie Alvarez", "Gilbert Melendez", "SD, 3", "UFC 188", "2015-06-13"),
      { period: "2014", winner: "Dominick Cruz", note: "Career" },
      ufc("2013", "Travis Browne", "Alistair Overeem", "KO, 1", "UFC Fight Night: Shogun vs. Sonnen", "2013-08-17"),
      ufc("2012", "Frank Mir", "Antonio Rodrigo Nogueira", "Sub, 1", "UFC 140", "2011-12-10"),
      ufc("2011", "Cheick Kongo", "Pat Barry", "KO, 1", "UFC Live: Kongo vs. Barry", "2011-06-26"),
    ],
  },
  {
    id: "upset", label: "Upset of the Year",
    rows: [
      ufc("2024-25", "Reinier de Ridder", "Bo Nickal", "TKO, 2", "UFC on ESPN: Sandhagen vs. Figueiredo", "2025-05-03"),
      ufc("2023-24", "Sean Strickland", "Israel Adesanya", "UD, 5", "UFC 293", "2023-09-09"),
      ufc("2022-23", "Alexa Grasso", "Valentina Shevchenko", "Sub, 4", "UFC 285", "2023-03-04"),
      ufc("2021-22", "Julianna Pena", "Amanda Nunes", "Sub, 2", "UFC 269", "2021-12-11"),
      elsewhere("ONE", "2020-21", "Adriano Moraes", "Demetrious Johnson", "KO, 2", "ONE on TNT 1"),
      ufc("2019-20", "Alexander Volkanovski", "Max Holloway", "UD, 5", "UFC 245", "2019-12-14"),
      ufc("2018", "Amanda Nunes", "Cristiane Justino", "KO, 1", "UFC 232", "2018-12-29"),
      ufc("2017", "Rose Namajunas", "Joanna Jedrzejczyk", "TKO, 1", "UFC 217", "2017-11-04"),
      ufc("2016", "Michael Bisping", "Luke Rockhold", "KO, 1", "UFC 199", "2016-06-04"),
      ufc("2015", "Holly Holm", "Ronda Rousey", "KO, 2", "UFC 193", "2015-11-14"),
      ufc("2014", "TJ Dillashaw", "Renan Barao", "TKO, 5", "UFC 173", "2014-05-24"),
    ],
  },
];

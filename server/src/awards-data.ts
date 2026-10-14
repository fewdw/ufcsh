/** Sherdog's Year-End Awards, voted by its staff each December for that
 *  calendar year. Every row is taken from Sherdog's own article for that
 *  award (indexed at AWARDS_SOURCE.url). Add each new year at the top.
 *
 *  A UFC fighter is written the way the archive stores the name, and a UFC
 *  bout carries its date, so both link to their pages; the Bugs board lists
 *  any that stop matching. Winners from elsewhere carry their promotion
 *  instead and show as plain text. */

export const AWARDS_SOURCE = { name: "Sherdog Year-End Awards", url: "https://www.sherdog.com/tag/year-end-awards" };

export interface AwardRow {
  /** The calendar year honoured. */
  period: string;
  winner: string;
  /** The promotion the award was won in, when it was not the UFC. */
  org?: string;
  opponent?: string;
  /** Where a bout outside the UFC was fought; the archive names UFC cards. */
  event?: string;
  /** The UFC bout's date, which with the two fighters identifies it. */
  date?: string;
}

export interface AwardCategory {
  id: string;
  label: string;
  /** Both fighters are honoured, so a profile shows it for either. */
  shared?: boolean;
  rows: AwardRow[];
}

const fighters = (list: [year: number, winner: string, org?: string][]): AwardRow[] =>
  list.map(([year, winner, org]) => ({ period: String(year), winner, ...(org ? { org } : {}) }));
const ufc = (year: number, winner: string, opponent: string, date: string): AwardRow =>
  ({ period: String(year), winner, opponent, date });
const elsewhere = (org: string, year: number, winner: string, opponent: string, event: string): AwardRow =>
  ({ period: String(year), winner, opponent, event, org });

export const AWARDS: AwardCategory[] = [
  {
    id: "fighter", label: "Fighter of the Year",
    rows: fighters([
      [2025, "Joshua Van"], [2024, "Ilia Topuria"], [2023, "Islam Makhachev"], [2022, "Alex Pereira"],
      [2021, "Charles Oliveira"], [2020, "Deiveson Figueiredo"], [2019, "Israel Adesanya"], [2018, "Daniel Cormier"],
      [2017, "Robert Whittaker"], [2016, "Conor McGregor"], [2015, "Conor McGregor"], [2014, "Robbie Lawler"],
      [2013, "Chris Weidman"], [2012, "Benson Henderson"], [2011, "Jon Jones"], [2010, "Cain Velasquez"],
      [2009, "Jose Aldo", "WEC"], [2008, "Rashad Evans"],
    ]),
  },
  {
    id: "breakthrough-fighter", label: "Breakthrough Fighter of the Year",
    rows: fighters([
      [2025, "Joshua Van"], [2024, "Dakota Ditcheva", "PFL"], [2023, "Tom Aspinall"], [2022, "Alex Pereira"],
      [2021, "Ciryl Gane"], [2020, "Kevin Holland"], [2019, "Jorge Masvidal"], [2018, "Israel Adesanya"],
      [2017, "Volkan Oezdemir"], [2016, "Cody Garbrandt"], [2015, "Holly Holm"], [2014, "Conor McGregor"],
      [2013, "Khabib Nurmagomedov"], [2012, "Ronda Rousey", "Strikeforce"], [2011, "Michael Chandler", "Bellator"],
      [2010, "Anthony Pettis", "WEC"], [2009, "Jon Jones"], [2008, "Miguel Torres", "WEC"],
    ]),
  },
  {
    id: "comeback-fighter", label: "Comeback Fighter of the Year",
    rows: fighters([
      [2025, "Petr Yan"], [2024, "Youssef Zalal"], [2023, "Jon Jones"], [2022, "Rob Wilkinson", "PFL"],
      [2021, "Jose Aldo"], [2020, "Sean Strickland"], [2019, "Stipe Miocic"], [2018, "Fedor Emelianenko", "Bellator"],
      [2017, "Georges St-Pierre"], [2016, "Khabib Nurmagomedov"], [2015, "Demian Maia"], [2014, "Dominick Cruz"],
      [2013, "Robbie Lawler"], [2012, "Jamie Varner"], [2011, "Ian McCall", "Tachi Palace Fights"],
      [2010, "Chris Leben"], [2009, "Mauricio Rua"], [2008, "Frank Mir"],
    ]),
  },
  {
    id: "fight", label: "Fight of the Year", shared: true,
    rows: [
      ufc(2025, "Joshua Van", "Brandon Royval", "2025-06-28"),
      ufc(2024, "Max Holloway", "Justin Gaethje", "2024-04-13"),
      ufc(2023, "Islam Makhachev", "Alexander Volkanovski", "2023-02-11"),
      ufc(2022, "Jiri Prochazka", "Glover Teixeira", "2022-06-11"),
      ufc(2021, "Justin Gaethje", "Michael Chandler", "2021-11-06"),
      ufc(2020, "Zhang Weili", "Joanna Jedrzejczyk", "2020-03-07"),
      ufc(2019, "Israel Adesanya", "Kelvin Gastelum", "2019-04-13"),
      ufc(2018, "Dustin Poirier", "Justin Gaethje", "2018-04-14"),
      ufc(2017, "Justin Gaethje", "Michael Johnson", "2017-07-07"),
      ufc(2016, "Robbie Lawler", "Carlos Condit", "2016-01-02"),
      ufc(2015, "Robbie Lawler", "Rory MacDonald", "2015-07-11"),
      ufc(2014, "Johny Hendricks", "Robbie Lawler", "2014-03-15"),
      ufc(2013, "Jon Jones", "Alexander Gustafsson", "2013-09-21"),
      ufc(2012, "Chan Sung Jung", "Dustin Poirier", "2012-05-15"),
      ufc(2011, "Frankie Edgar", "Gray Maynard", "2011-01-01"),
      elsewhere("Sengoku", 2010, "Jorge Santiago", "Kazuo Misaki", "Sengoku Raiden Championship 14"),
      elsewhere("WEC", 2009, "Benson Henderson", "Donald Cerrone", "WEC 43"),
      elsewhere("Dream", 2008, "Eddie Alvarez", "Tatsuya Kawajiri", "Dream 5"),
    ],
  },
  {
    id: "knockout", label: "Knockout of the Year",
    rows: [
      ufc(2025, "Lerone Murphy", "Aaron Pico", "2025-08-16"),
      ufc(2024, "Max Holloway", "Justin Gaethje", "2024-04-13"),
      ufc(2023, "Josh Emmett", "Bryce Mitchell", "2023-12-16"),
      ufc(2022, "Michael Chandler", "Tony Ferguson", "2022-05-07"),
      elsewhere("Bellator", 2021, "Sergio Pettis", "Kyoji Horiguchi", "Bellator 272"),
      ufc(2020, "Joaquin Buckley", "Impa Kasanganay", "2020-10-10"),
      ufc(2019, "Jorge Masvidal", "Ben Askren", "2019-07-06"),
      ufc(2018, "Yair Rodriguez", "Chan Sung Jung", "2018-11-10"),
      ufc(2017, "Edson Barboza", "Beneil Dariush", "2017-03-11"),
      elsewhere("Bellator", 2016, "Michael Page", "Evangelista Santos", "Bellator 158"),
      ufc(2015, "Conor McGregor", "Jose Aldo", "2015-12-12"),
      ufc(2014, "Dong Hyun Kim", "John Hathaway", "2014-03-01"),
      ufc(2013, "Chris Weidman", "Anderson Silva", "2013-07-06"),
      ufc(2012, "Edson Barboza", "Terry Etim", "2012-01-14"),
      ufc(2011, "Lyoto Machida", "Randy Couture", "2011-04-30"),
      elsewhere("Strikeforce", 2010, "Robbie Lawler", "Melvin Manhoef", "Strikeforce: Miami"),
      elsewhere("Affliction", 2009, "Fedor Emelianenko", "Andrei Arlovski", "Affliction: Day of Reckoning"),
      ufc(2008, "Rashad Evans", "Chuck Liddell", "2008-09-06"),
    ],
  },
  {
    id: "submission", label: "Submission of the Year",
    rows: [
      elsewhere("PFL", 2025, "Costello van Steenis", "Johnny Eblen", "PFL Champions Series 2"),
      ufc(2024, "Khamzat Chimaev", "Robert Whittaker", "2024-10-26"),
      ufc(2023, "Alexa Grasso", "Valentina Shevchenko", "2023-03-04"),
      elsewhere("PFL", 2022, "Stevie Ray", "Anthony Pettis", "PFL 5: 2022 Regular Season"),
      ufc(2021, "Andre Muniz", "Jacare Souza", "2021-05-15"),
      elsewhere("Bellator", 2020, "A.J. McKee", "Darrion Caldwell", "Bellator 253"),
      ufc(2019, "Bryce Mitchell", "Matt Sayles", "2019-12-07"),
      ufc(2018, "Ryan Hall", "BJ Penn", "2018-12-29"),
      ufc(2017, "Demetrious Johnson", "Ray Borg", "2017-10-07"),
      ufc(2016, "Ben Rothwell", "Josh Barnett", "2016-01-30"),
      ufc(2015, "Ronda Rousey", "Cat Zingano", "2015-02-28"),
      ufc(2014, "Charles Oliveira", "Hatsu Hioki", "2014-06-28"),
      elsewhere("WSOF", 2013, "Joshua Burkman", "Jon Fitch", "World Series of Fighting 3"),
      elsewhere("Bellator", 2012, "Karl Amoussou", "Bryan Baker", "Bellator 72"),
      ufc(2011, "Frank Mir", "Antonio Rodrigo Nogueira", "2011-12-10"),
      elsewhere("Strikeforce", 2010, "Fabricio Werdum", "Fedor Emelianenko", "Strikeforce: Fedor vs. Werdum"),
      elsewhere("Bellator", 2009, "Toby Imada", "Jorge Masvidal", "Bellator 5"),
      ufc(2008, "Dustin Hazelett", "Joshua Burkman", "2008-06-21"),
    ],
  },
  {
    id: "upset", label: "Upset of the Year",
    rows: [
      ufc(2025, "Petr Yan", "Merab Dvalishvili", "2025-12-06"),
      ufc(2024, "Gabriella Fernandes", "Wang Cong", "2024-11-23"),
      ufc(2023, "Sean Strickland", "Israel Adesanya", "2023-09-09"),
      elsewhere("PFL", 2022, "Larissa Pacheco", "Kayla Harrison", "2022 PFL Championships"),
      ufc(2021, "Julianna Pena", "Amanda Nunes", "2021-12-11"),
      ufc(2020, "Roxanne Modafferi", "Maycee Barber", "2020-01-18"),
      ufc(2019, "Tristan Connelly", "Michel Pereira", "2019-09-14"),
      ufc(2018, "Henry Cejudo", "Demetrious Johnson", "2018-08-04"),
      ufc(2017, "Rose Namajunas", "Joanna Jedrzejczyk", "2017-11-04"),
      ufc(2016, "Michael Bisping", "Luke Rockhold", "2016-06-04"),
      ufc(2015, "Holly Holm", "Ronda Rousey", "2015-11-14"),
      ufc(2014, "TJ Dillashaw", "Renan Barao", "2014-05-24"),
      elsewhere("Bellator", 2013, "Emanuel Newton", "Muhammed Lawal", "Bellator 90"),
      ufc(2012, "Jamie Varner", "Edson Barboza", "2012-05-26"),
      ufc(2011, "Tito Ortiz", "Ryan Bader", "2011-07-02"),
      elsewhere("Strikeforce", 2010, "Fabricio Werdum", "Fedor Emelianenko", "Strikeforce: Fedor vs. Werdum"),
      elsewhere("WEC", 2009, "Mackens Semerzier", "Wagnney Fabiano", "WEC 43"),
      elsewhere("Sengoku", 2008, "Sergey Golyaev", "Takanori Gomi", "Sengoku 6"),
    ],
  },
];

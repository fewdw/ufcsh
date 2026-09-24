import type { JudgeCard } from "./judge-scorecards.ts";

type JudgeTotal = Pick<JudgeCard, "judge" | "f1Score" | "f2Score">;
type Correction = { from: JudgeTotal; to: JudgeTotal };

// Guard each correction with the exact UFCStats value we verified. If the
// source fixes a card later, a refresh will retain its new value.
const corrections: Record<string, Correction[]> = {
  // https://mmadecisions.com/decision/9304/Andrew-Sanchez-vs-Markus-Perez
  "5e3779f7c1c39679": [{ from: { judge: "Glenn Hamada", f1Score: 29, f2Score: 28 }, to: { judge: "Glenn Trowbridge", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/8849/Max-Griffin-vs-Mike-Perry
  "424a20da52b4f956": [
    { from: { judge: "Eric Colon", f1Score: 29, f2Score: 27 }, to: { judge: "Eric Colon", f1Score: 30, f2Score: 27 } },
    { from: { judge: "Chris Lee", f1Score: 30, f2Score: 27 }, to: { judge: "Chris Lee", f1Score: 29, f2Score: 27 } },
  ],
  // https://mmadecisions.com/decision/10657/Roosevelt-Roberts-vs-Alexander-Yakovlev
  "a7807ab56cb49cad": [{ from: { judge: "Lukasz Porebski", f1Score: 29, f2Score: 28 }, to: { judge: "Lukasz Bosacki", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/10655/Davey-Grant-vs-Grigorii-Popov
  "f0418c2c989a5cde": [{ from: { judge: "Lukasz Porebski", f1Score: 29, f2Score: 28 }, to: { judge: "Lukasz Bosacki", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/10528/Dhiego-Lima-vs-Luke-Jumeau
  "fd0fd9a2d6ef8c4f": [
    { from: { judge: "Garth Harriman", f1Score: 29, f2Score: 28 }, to: { judge: "Garth Harriman", f1Score: 28, f2Score: 29 } },
    { from: { judge: "Christopher Shen", f1Score: 28, f2Score: 29 }, to: { judge: "Christopher Shen", f1Score: 29, f2Score: 28 } },
  ],
  // https://mmadecisions.com/decision/10437/Tristan-Connelly-vs-Michel-Pereira
  "dadaee9624256e07": [
    { from: { judge: "Derek Cleary", f1Score: 29, f2Score: 28 }, to: { judge: "Derek Cleary", f1Score: 29, f2Score: 27 } },
    { from: { judge: "Dave Hagen", f1Score: 29, f2Score: 27 }, to: { judge: "Dave Hagen", f1Score: 29, f2Score: 28 } },
  ],
  // https://mmadecisions.com/decision/10567/Sean-Woodson-vs-Kyle-Bochniak
  "9c3fb95a1558b38d": [{ from: { judge: "Marcelo Vilhena", f1Score: 30, f2Score: 26 }, to: { judge: "Marcel Varela", f1Score: 30, f2Score: 26 } }],
  // https://mmadecisions.com/decision/10395/Zubaira-Tukhugov-vs-Lerone-Murphy
  "bef4df43d6052a02": [
    { from: { judge: "David Lethaby", f1Score: 29, f2Score: 28 }, to: { judge: "David Lethaby", f1Score: 28, f2Score: 28 } },
    { from: { judge: "Clemens Werner", f1Score: 28, f2Score: 28 }, to: { judge: "Clemens Werner", f1Score: 29, f2Score: 28 } },
  ],
  // https://mmadecisions.com/decision/10436/Uriah-Hall-vs-Antonio-Carlos-Junior
  "ece3a7a9e930ef9d": [
    { from: { judge: "Mike Bell", f1Score: 28, f2Score: 29 }, to: { judge: "Mike Bell", f1Score: 29, f2Score: 28 } },
    { from: { judge: "Sal D'amato", f1Score: 29, f2Score: 28 }, to: { judge: "Sal D'amato", f1Score: 28, f2Score: 29 } },
  ],
  // https://mmadecisions.com/decision/10390/Omari-Akhmedov-vs-Zak-Cummings
  "9a46f95c1c1e57f0": [{ from: { judge: "Pawel Harasim", f1Score: 29, f2Score: 28 }, to: { judge: "Pawel Harasim", f1Score: 30, f2Score: 27 } }],
  // https://mmadecisions.com/decision/10272/Felipe-Colares-vs-Domingo-Pilarte
  "c5259566abc552b1": [{ from: { judge: "Marcelo Vilhena", f1Score: 29, f2Score: 28 }, to: { judge: "Marcos Rosales", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/9924/Curtis-Blaydes-vs-Justin-Willis
  "9532ebf4d9405e65": [
    { from: { judge: "Brian Puccillo", f1Score: 30, f2Score: 27 }, to: { judge: "Brian Puccillo", f1Score: 30, f2Score: 26 } },
    { from: { judge: "Rick Winter", f1Score: 30, f2Score: 26 }, to: { judge: "Rick Winter", f1Score: 30, f2Score: 27 } },
  ],
  // https://mmadecisions.com/decision/9889/Dominick-Reyes-vs-Volkan-Oezdemir
  "826fb989c0e6208e": [{ from: { judge: "Mark Collett", f1Score: 29, f2Score: 28 }, to: { judge: "Junichiro Kamijo", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/9815/Petr-Yan-vs-John-Dodson
  "244aa8f002274344": [{ from: { judge: "Zdenek Ledvina", f1Score: 30, f2Score: 27 }, to: { judge: "Mark Collett", f1Score: 30, f2Score: 27 } }],
  // https://www.ufc.com/news/fight-island-kattar-vs-ige-results and
  // https://mmadecisions.com/decision/11135/Taila-Santos-vs-Molly-McCann
  "15def71ff1679e06": [{ from: { judge: "Lukasz Bosacki", f1Score: 30, f2Score: 26 }, to: { judge: "Lukasz Bosacki", f1Score: 30, f2Score: 27 } }],
  // https://mmadecisions.com/decision/16210/Jean-Paul-Lebosnoyani-vs-Seok-Hyeon-Ko
  "f2eb569176e46edf": [{ from: { judge: "Paul Sutherland", f1Score: 29, f2Score: 28 }, to: { judge: "David Sutherland", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/15974/Mario-Pinto-vs-Felipe-Franco
  "90187edeeda7e6d6": [{ from: { judge: "Kevin Manderson", f1Score: 29, f2Score: 28 }, to: { judge: "Anders Ohlsson", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/15886/Daniil-Donchenko-vs-Alex-Morono
  "f964d2dda87f25f0": [{ from: { judge: "Peter Adamcik", f1Score: 30, f2Score: 26 }, to: { judge: "Adalaide Byrd", f1Score: 30, f2Score: 26 } }],
  // https://mmadecisions.com/decision/15704/Veronica-Hardy-vs-Brogan-Walker
  "98883348ddb3be33": [{ from: { judge: "Chris Lee", f1Score: 30, f2Score: 27 }, to: { judge: "Michael Bell", f1Score: 30, f2Score: 27 } }],
  // https://mmadecisions.com/decision/15259/J.J.-Aldrich-vs-Andrea-Lee
  "1ada4b9ee5810e0f": [{ from: { judge: "Ron McCarthy", f1Score: 29, f2Score: 28 }, to: { judge: "John McCarthy", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/15835/Jan-Blachowicz-vs-Bogdan-Guskov
  "6d6ab10cbaa45e8c": [
    { from: { judge: "Junichiro Kamijo", f1Score: 29, f2Score: 28 }, to: { judge: "Junichiro Kamijo", f1Score: 28, f2Score: 28 } },
    { from: { judge: "Chris Lee", f1Score: 28, f2Score: 28 }, to: { judge: "Chris Lee", f1Score: 29, f2Score: 28 } },
  ],
  // https://mmadecisions.com/decision/15189/Bernardo-Sopaj-vs-Ricky-Turcios
  "95ba27bea09cd84e": [
    { from: { judge: "Felicia Oh", f1Score: 30, f2Score: 27 }, to: { judge: "Felicia Oh", f1Score: 29, f2Score: 28 } },
    { from: { judge: "Ron McCarthy", f1Score: 29, f2Score: 28 }, to: { judge: "Ron McCarthy", f1Score: 30, f2Score: 27 } },
  ],
  // https://mmadecisions.com/decision/11043/Krzysztof-Jotko-vs-Eryk-Anders
  "821a1c6f5d7fab14": [{ from: { judge: "Sal D'amato", f1Score: 29, f2Score: 28 }, to: { judge: "Chris Lee", f1Score: 29, f2Score: 28 } }],
  // https://www.ufc.com/news/ufc-fight-night-hall-vs-strickland-official-scorecards-judges-results-ufc-vegas-33
  "69397bbebdfa41d9": [{ from: { judge: "Mike Bell", f1Score: 29, f2Score: 27 }, to: { judge: "Mike Bell", f1Score: 27, f2Score: 29 } }],
  // https://www.ufc.com/news/official-scorecards-ufc-fight-night-reyes-vs-prochazka-swanson-chikadze-ufc-vegas-25
  "ec8d93ae99a7799d": [
    { from: { judge: "Dave Hagen", f1Score: 29, f2Score: 28 }, to: { judge: "Dave Hagen", f1Score: 28, f2Score: 29 } },
    { from: { judge: "Rick Winter", f1Score: 28, f2Score: 29 }, to: { judge: "Rick Winter", f1Score: 29, f2Score: 28 } },
  ],
  // https://www.ufc.com/news/ufc-fight-night-rozenstruik-vs-gane-official-scorecards-ufc-vegas-20
  "f3ad8ad8d242678e": [{ from: { judge: "Eric Colon", f1Score: 28, f2Score: 27 }, to: { judge: "Eric Colon", f1Score: 27, f2Score: 28 } }],
  // https://www.ufc.com/news/official-scorecards-ufc-fight-night-vera-vs-cruz-san-diego
  "e05a18b6ce22fa1f": [{ from: { judge: "Chris Crail", f1Score: 29, f2Score: 28 }, to: { judge: "Chris Crail", f1Score: 28, f2Score: 29 } }],
  // https://www.ufc.com/news/official-judges-scorecards-ufc-fight-night-kattar-vs-chikadze-ufc-vegas-46
  "8693027377658e61": [{ from: { judge: "David Douglas", f1Score: 29, f2Score: 28 }, to: { judge: "Douglas Crosby", f1Score: 29, f2Score: 28 } }],
  // https://www.ufc.com/news/official-judges-scorecards-ufc-295-prochazka-vs-pereira
  "83a0fff04494bfc4": [{ from: { judge: "Bryan Miner", f1Score: 29, f2Score: 28 }, to: { judge: "Bryan Miner", f1Score: 28, f2Score: 29 } }],
  // https://www.ufc.com/news/official-judges-scorecards-ufc-fight-night-almeida-vs-lewis
  "b5ea6535748edbce": [{ from: { judge: "Fabio Alves", f1Score: 29, f2Score: 28 }, to: { judge: "Fabio Alves", f1Score: 28, f2Score: 29 } }],
  // https://www.ufc.com/news/official-judges-scorecards-ufc-287-pereira-vs-adesanya-2
  "2cb34fc074f7a9ae": [{ from: { judge: "Sal D'amato", f1Score: 29, f2Score: 28 }, to: { judge: "Sal D'amato", f1Score: 29, f2Score: 27 } }],
  // https://www.ufc.com/news/official-judges-scorecards-ufc-atlantic-city-blanchfield-fiorot
  "17e8ab0065e9085f": [{ from: { judge: "Dave Tirelli", f1Score: 30, f2Score: 27 }, to: { judge: "Dave Tirelli", f1Score: 30, f2Score: 26 } }],
  // https://www.ufc.com/news/official-judges-scorecards-ufc-fight-night-barboza-vs-murphy
  "63605e9f3e71d738": [{ from: { judge: "Chris Lee", f1Score: 30, f2Score: 27 }, to: { judge: "Chris Lee", f1Score: 29, f2Score: 28 } }],
};

export const verifiedScorecardFightIds = Object.keys(corrections);

const card = (judge: string, f1: number[], f2: number[]): JudgeCard => ({
  judge, f1Score: f1.reduce((sum, score) => sum + score, 0),
  f2Score: f2.reduce((sum, score) => sum + score, 0),
  rounds: f1.map((f1Score, index) => ({ round: index + 1, f1Score, f2Score: f2[index] })),
});

// Transcribed from the UFC's published scorecard images where the other
// imports lack a complete, correct panel. Every card is checked against the
// independent UFCStats judge totals before storage.
export const verifiedOfficialRounds: { fightId: string; sourceUrl: string; judges: JudgeCard[] }[] = [
  {
    fightId: "a661c0bee7c8d5af", // Gauge Young vs Thiago Moises
    sourceUrl: "https://www.ufc.com/news/ufc-winnipeg-official-scorecards-judges-burns-vs-malott",
    judges: [
      card("Junichiro Kamijo", [9, 10, 10], [10, 9, 9]),
      card("David Therien", [9, 9, 10], [10, 10, 9]),
      card("Sal D'amato", [9, 10, 10], [10, 9, 9]),
    ],
  },
  {
    fightId: "138f719d370e8ba0", // Norma Dumont vs Felicia Spencer
    sourceUrl: "https://www.ufc.com/news/ufc-fight-night-font-vs-garbrandt-official-scorecards-results-ufc-vegas-27",
    judges: [
      card("Sal D'amato", [10, 10, 10], [9, 9, 9]),
      card("Bryan Miner", [10, 9, 9], [9, 10, 10]),
      card("Junichiro Kamijo", [10, 10, 9], [9, 9, 10]),
    ],
  },
  {
    fightId: "0cf7a4593fd44e59", // Jared Gordon vs Leonardo Santos
    sourceUrl: "https://www.ufc.com/news/official-scorecards-ufc-278-usman-vs-edwards-2-salt-lake-city",
    judges: ["Sal D'amato", "Derek Cleary", "Mike Bell"].map(judge => card(judge, [10, 10, 10], [9, 9, 9])),
  },
  {
    fightId: "f087a10a6f2bcc99", // Josiane Nunes vs Ramona Pascual
    sourceUrl: "https://www.ufc.com/news/official-judges-scorecards-ufc-fight-night-makhachev-vs-green-ufc-vegas-49",
    judges: [
      card("Doug Crosby", [10, 10, 10], [9, 9, 9]),
      card("Tony Weeks", [10, 10, 10], [9, 9, 9]),
      card("Chris Lee", [10, 10, 10], [9, 8, 9]),
    ],
  },
  {
    fightId: "b70313eae7c24b27", // Javid Basharat vs Trevin Jones
    sourceUrl: "https://www.ufc.com/news/official-judges-scorecards-ufc-fight-night-santos-vs-ankalaev-ufc-vegas-50",
    judges: [
      card("Mike Bell", [10, 10, 9], [9, 9, 10]),
      card("Sal D'amato", [10, 10, 10], [9, 9, 9]),
      card("Dave Hagen", [10, 10, 10], [9, 9, 9]),
    ],
  },
  {
    fightId: "3bbc222130d9dac7", // Martin Buday vs Andrei Arlovski
    sourceUrl: "https://www.ufc.com/news/official-judges-scorecards-ufc-303-pereira-vs-prochazka-2",
    judges: [
      card("Mike Bell", [10, 10, 9], [9, 9, 10]),
      card("Derek Cleary", [9, 10, 9], [10, 9, 10]),
      card("Sal D'amato", [10, 10, 10], [9, 9, 9]),
    ],
  },
  {
    fightId: "8d5b88e0ff253617", // Vitor Petrino vs Anton Turkalj
    sourceUrl: "https://www.ufc.com/news/official-judges-scorecards-ufc-fight-night-yan-vs-dvalishvili",
    judges: [
      card("Eric Colon", [10, 10, 10], [9, 9, 9]),
      card("Jacob Montalvo", [10, 10, 10], [9, 9, 9]),
      card("Bryan Miner", [10, 10, 10], [8, 9, 9]),
    ],
  },
  {
    fightId: "ecbece0cbd60029e", // Daniel Zellhuber vs Francisco Prado
    sourceUrl: "https://www.ufc.com/news/official-judges-scorecards-ufc-mexico-city",
    judges: [
      card("Miguel Jimenez", [9, 10, 10], [10, 9, 9]),
      card("Junichiro Kamijo", [9, 10, 10], [10, 9, 9]),
      card("Rick Winter", [10, 10, 10], [9, 8, 9]),
    ],
  },
  {
    fightId: "63605e9f3e71d738", // Alatengheili vs Kleydson Rodrigues
    sourceUrl: "https://www.ufc.com/news/official-judges-scorecards-ufc-fight-night-barboza-vs-murphy",
    judges: [
      card("Mike Bell", [10, 10, 10], [9, 9, 9]),
      card("Junichiro Kamijo", [10, 10, 10], [9, 9, 9]),
      card("Chris Lee", [10, 10, 9], [9, 9, 10]),
    ],
  },
  {
    fightId: "029f5c36820fdc09", // Kyung Ho Kang vs Batgerel Danaa
    sourceUrl: "https://www.ufc.com/news/official-judges-scorecards-ufc-275-teixeira-vs-prochazka-shevchenko-santos-singapore",
    judges: [
      card("Ben Cartlidge", [9, 10, 10], [10, 9, 9]),
      card("Anthony Dimitriou", [10, 9, 10], [9, 10, 9]),
      card("Howard Hughes", [9, 10, 10], [10, 9, 9]),
    ],
  },
  {
    fightId: "34cb6e9952cd30a4", // Lauren Murphy vs Joanne Wood
    sourceUrl: "https://www.ufc.com/news/ufc-263-adesanya-vettori-2-figueiredo-moreno-2-official-scorecards-results",
    judges: [
      card("Junichiro Kamijo", [10, 10, 9], [9, 9, 10]),
      card("Derek Cleary", [9, 9, 10], [10, 10, 9]),
      card("Dennis O'Connell", [10, 10, 9], [9, 9, 10]),
    ],
  },
];

export function correctOfficialJudges<T extends { judges?: JudgeTotal[] }>(fightId: string, detail: T): T {
  const changes = corrections[fightId];
  if (!changes || !Array.isArray(detail.judges)) return detail;
  let changed = false;
  const judges = detail.judges.map(judge => {
    const match = changes.find(({ from }) =>
      judge.judge === from.judge && judge.f1Score === from.f1Score && judge.f2Score === from.f2Score);
    if (!match) return judge;
    changed = true;
    return { ...judge, ...match.to };
  });
  return changed ? { ...detail, judges } : detail;
}

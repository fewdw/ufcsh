# Yearly anti-doping test sessions

The source is the [UFC Anti-Doping Program's Test History](https://ufcantidoping.com/tests).
These are **test sessions**, as the program reports them, rather than samples
or a guaranteed complete lifetime testing record. The published tables start
in 2015. A missing athlete/year is unknown, never an invented zero.

## Deployment and refresh

`server/src/antidoping-data.json` contains only the public tables: source URL,
scrape timestamp, and each year's athlete names and counts. It was freshly
scraped and validated across all 12 years, 2015–2026 (7,985 rows). It contains
no private database dump, credentials, accounts, or stored fighter links.

Production imports the snapshot after schema initialization and before opening
API/sync workers. Local previews import it before HTTP starts. Importing the
same snapshot again does not change data; a rollback or redeploy cannot replace
a year checked more recently online. Fighter identities come from the local
archive, so the public snapshot is usable with a different development seed.

The scheduler checks the current and previous years daily and retries failed
refreshes every three hours. It automatically discovers a new calendar year.
Older tables are checked every 30 days for corrections. Admin → Bugs → Read
again requests all years. Concurrent refresh calls share the running pass.

All requested pages must validate before any database write. Counts, fighter
links, per-year check times, and success metadata commit in one transaction.
Invalid tables, missing counts, malformed or duplicate athletes, wrong years,
short reads, and an existing year suddenly becoming empty abort the pass.
Only a confirmed empty current-year table is accepted at the start of a year.
Failures preserve the last valid data and surface in Admin → Bugs.

To regenerate the bundled public snapshot, use a private scratch archive:

```sh
DATA_DIR=/path/to/private-copy node server/src/export-antidoping.ts
```

The exporter fetches the website, not the archive data. It writes the JSON only
after every page has passed validation. Review its diff and rerun the
anti-doping tests against a private archive copy before committing.

## Identity and missing records

Exact names and unambiguous longer registered names link automatically.
Spelling similarity or a shared first-name prefix never establish a new
identity. Previously reviewed variants are explicit `SOURCE_NAMES` aliases;
`SOURCE_IDS` distinguishes the two Bruno Silvas. Normalized aliases tolerate
case, accents, and punctuation changes. Competing records at the same matching
stage stay unlinked, including on subsequent passes through the matcher.

Admin → Bugs lists both fighter-years with no linked tests and **every unlinked
source row**, including people without a booked UFC bout and inactive athletes.
Rows remain stored while identity evidence is reviewed. Some source records
cannot be assigned confidently or refer to people without UFC profiles; storing
all public rows is not a claim that every profile is complete. Source omissions
and publication delays also limit what the site can show accurately.

GSP's public source record is 2016: 2, 2017: 7, 2018: 5 (total 14).
Alex Pereira's is 2021: 1, 2022: 8, 2023: 9, 2024: 5, 2025: 6, 2026: 5
(total 34). Regression tests preserve these snapshot examples.

Additional identity evidence checked during the accuracy audit:

| Source variant → profile | Evidence |
| --- | --- |
| Manuel P Gomes / Manuel Gomes → Manel Kape | [Nevada, December 17, 2022](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2022_Results/12-17-22MMA.pdf), [December 13, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/12-13-25MMA_REDACTED.pdf) |
| Alexia Pereira → Alexia Thainara | [Nevada, September 24, 2024](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2024_Results/09-24-24%20MMA_Redacted.pdf): Alexia Thainara Silva Pereira |
| Bruno Gustavo Aparecido / Bruno Aparecido → Bruno Silva, Bulldog (1990-03-16) | [Nevada, TUF Brazil 4](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2015_Results/TUF_BRASIL4_SEASON_RESULTS.pdf): full registered name, nickname and birth date |
| Bruno Arruda → Bruno Silva, Blindado | [UFC statement naming Bruno Arruda da Silva](https://www.ufc.com/news/statement-bruno-arruda-da-silva), with his March 30, 2024 bout |
| Marco Costa → Marco Tulio | [Nevada, November 8, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/11-08-25MMA_REDACTED.pdf): Marco Tulio Silva Costa |
| Eduardo Dos Santos → Eduardo Chapolin | [Nevada, September 2, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/09-02-25MMA_REDACTED.pdf): Eduardo Henrique da Silva dos Santos, Chapolin |
| Pascall Saumani Milo / Pascall Milo → Junior Tafa; Lucas Fernandes → Lucas Rocha | [Nevada, October 12, 2024](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2024_Results/10-12-24%20MMA_Redacted.pdf): Pascall Saumani Milo, Junior Tafa; Lucas Fernandes Rocha |
| Miguel Martinez Aceves → David Martinez | [Nevada, October 29, 2024 agenda](https://boxing.nv.gov/uploadedFiles/boxing.nv.gov/content/schedule/24_Agendas/2024-10-29AG.pdf): Miguel David Martinez Aceves |
| Zhakwarius Y Johnson / Zhakwarius Johnson → Jose Johnson | [Nevada, January 11, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/01-11-25MMA_REDACTED.pdf): Zhakwarius Jose Ya'myl Johnson |
| Claudio Ribeiro da Silva → Claudio Ribeiro | [Full registered name reported in July 2026](https://diarioesp.com.br/sao-paulo/2026/07/23/ex-lutador-do-ufc-e-solto-apos-audiencia-de-custodia-por-agressao-a-esposa.html), [UFC identity and bouts](https://www.ufc.com/athlete/claudio-ribeiro) |

Additional identities reviewed on November 3, 2026. The abbreviated source
names are linked explicitly, rather than broadening the matcher for other
athletes with similar names:

| Source variant → profile | Identity evidence |
| --- | --- |
| Abdul Mubarak / Abdul K Mubarak → Abdul-Kareem Al-Selwady | [Nevada, March 2, 2024](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2024_Results/03-02-24_MMA_Redacted.pdf): Abdul-Kareem Husam Mubarak, Al-Selwady, against Loik Radzhabov |
| Akkararat Konlak → Loma Lookboonmee | [Nevada, April 5, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/04-05-25MMA_REDACTED.pdf): Suphisara Akkararat Konlak, against Istela Nunes |
| Andre Cardoso → Andre Lima | [Nevada, October 17, 2023 license agenda](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/schedule/23_Agendas/2023-10-17AG.pdf): Andre Luis Lima Cardoso |
| Halil Demiraslan / Halil I Demiraslan → Ibo Aslan | [Nevada, December 6, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/12-06-25MMA_REDACTED.pdf): Halil Ibrahim Demiraslan, against Iwo Baraniewski |
| Jhin H Yu → Jinh Yu Frey | [Nevada, June 27, 2020](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2020_Results/06-27-20MMA.pdf): Jhin Hie Yu Frey, against Kay Hansen; [June 3, 2023](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2023_Results/06-03-23MMA_Redacted.pdf) uses Jinh Hie Yu Frey, same federal id 124-633 |
| Jose Rivero → Jose Daniel Medina | [Nevada, August 24, 2024](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2024_Results/08-24-24%20MMA_Redacted.pdf): Jose Daniel Medina Rivero, against Zachary Reese |
| Lucas Dos Santos De Oliveira → Lucas Alexander | [Florida, December 12, 2020](https://www2.myfloridalicense.com/pro/sbc/documents/12-12-2020-Combat_Night-Results_without_med.pdf): Lucas Alexander Dos Santos De Oliveira, explicitly also known as Lucas Alexander |
| Michael Tambirai Mathetha → Blood Diamond | [UFC's January 27, 2022 interview](https://www.ufc.com/news/blood-diamond-wants-to-make-his-name-unforgettable-ufc-271): Mike Mathetha requested to compete as Blood Diamond when signing in 2021 |
| Montserrat Fernandez → Montse Rendon | [Nevada, October 17, 2023 license agenda](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/schedule/23_Agendas/2023-10-17AG.pdf): Montserrat Dolores Rendon Fernandez |
| Phillip Brooks → CM Punk | [UFC's May 2019 retrospective](https://www.ufc.com/news/5-ufc-fighters-who-were-wwe-superstars) explicitly identifies Phillip Brooks as CM Punk |
| Eduarda Neves Santanna → Duda Santana | [USADA's January 15, 2021 announcement](https://www.usada.org/sanction/eduarda-neves-santanna-receives-doping-sanction/): Eduarda Neves Santanna, Rio de Janeiro, aged 23; her UFC appearance was against Bea Malecki in 2019 |
| James Hettes → Jimy Hettes | [Nevada, December 30, 2011](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/MMA/2011/12-30-11-MMA.pdf): James Michael Hettes, against Nam Phan |
| Victor Da Silva → Victor Hugo | [Nevada, April 6, 2024](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2024_Results/04-06-24%20MMA_Redacted.pdf): Victor Hugo Ferreira da Silva, against Pedro Falcao |
| Bharat Vijay Kandare → Bharat Kandare | [UFC's official sanction announcement](https://www.ufc.com/news/sanction-announcement-bharat-vijay-kandare), also linked from his [UFC profile](https://www.ufc.com/athlete/bharat-kandare), gives his full name |
| Guan Wang → Wang Guan | The same source spelling links unambiguously in 2017–2020; [UFC profile](https://www.ufc.com/athlete/wang-guan) identifies the fighter who faced Alex Caceres in 2017. The explicit reversed-name alias also preserves his 2021 tests, beyond the automatic matching window |
| Igor Poterya → Ihor Potieria | [UFC's September 2021 preview](https://www.ufc.com/news/season-5-week-5-preview-dana-whites-contender-series) calls Sudolski's opponent Igor Potieria; [the fighter's identity record](https://www.tapology.com/fightcenter/fighters/91636-igor-poterya) retains Igor Poterya in its address and Ihor Alexeevich Potieria as the registered name |
| Melissa Sena → Melissa Amaya | [Florida, June 8, 2024](https://www2.myfloridalicense.com/pro/sbc/documents/06-08-2024-Combate_Global-Results_wout_med.pdf): Melissa Amaya Sena, born 1994-11-27, federal id WA-164-835; [June 19, 2025](https://www2.myfloridalicense.com/pro/sbc/documents/06-19-25-Combate_Global-Results_wout_med.pdf) uses Melissa Sena with the same birth date and id |
| Tina Lahdemaki Hanninen → Tina Lahdemaki | [Her July 2018 retirement interview](https://www.mmafighting.com/2018/7/17/17575278/after-injuries-sidelined-her-for-years-ufc-strawweight-pioneer-tina-lahdemaki-is-moving-on-from-mma) explains she took her husband's surname Hanninen; her only UFC fight was in 2014, outside the automatic window for 2018 tests |
| Trenton Brown → TJ Brown | [Nevada, August 27, 2019](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2019_Results/08-27-19MMA.pdf): Trenton Joseph Brown, against Dylan Lockard, born 1990-05-22 |
| Alisson Samuel Sanches dos Reis e Santos → Samuel Sanches | [Nevada, September 9, 2025](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2025_Results/09-09-25MMA_REDACTED.pdf): Alisson Samuel Sanches dos Reis Santos defeats Chasen Blair at 2:01 of round 1; [UFC's same-card report](https://www.ufc.com/news/week-5-results-scorecards-fight-recaps-contract-winners-interviews-dana-whites-contender-series-season-9) identifies him as Samuel Sanches |
| Jose Luiz Miranda da Silva → Jose Montanha | [Nevada, August 8, 2026](https://www.boxing.nv.gov/siteassets/results2/2026-results/08-08-26_MMA_REDACTED.pdf): Jose Luis Miranda da Silva, Montanha, against Louie Sutherland |
| Thomas Peterson → Thomas Petersen | [UFC profile](https://www.ufc.com.br/athlete/thomas-petersen) and [July 2026 results](https://us.ufcespanol.com/news/ufc-abu-dhabi-prelim-results) use Peterson for Petersen in the same Valter Walker bout; the 2023 source row precedes his February 2024 UFC debut |
| Carlos Felipe Cabral de Almeida → Carlos Felipe | [USADA's October 20, 2017 announcement](https://www.usada.org/sanction/carlos-felipe-accepts-doping-sanction/) explicitly gives both names and the July 2017 test; his suspension delayed his UFC debut until 2020 |
| Magomed Saidov → Muhammad Saidov | [MMA Series' own September 2025 report](https://www.mma-series.com/en/news/magomed-saidov-makes-successful-uae-warriors-debut) names Magomed Kubik Saidov of Gor MMA, his win over Valmir da Silva and his 17-second head-kick KO; [UFC's profile](https://www.ufc.com/athlete/muhammad-said) gives the same camp, nickname and distinctive KO history as Muhammad Saidov |
| Valesca Machado → Tina Black | [UFC's September 2026 preview](https://www.ufc.com.br/index.php/news/conheca-lutadores-brasileiros-ufc-vegas-121) explicitly names Valesca Tina Black Machado in the TUF 34 strawweight final; [the 2021 DWCS preview](https://www.ufc.com.br/news/os-brasileiros-no-dana-whites-contender-series-5a-temp-ep-8) gives Valesca Machado and the Tina Black nickname |

Same-year source rows for both a ring name and a registered name remain
unlinked when both claim a profile. Their counts cannot safely be summed,
selected, or deduplicated without evidence about overlapping test sessions.
Athletes without UFC profiles and unproven name variants also remain visible.

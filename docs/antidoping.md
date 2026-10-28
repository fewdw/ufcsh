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

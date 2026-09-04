# UFC.sh

A fast, local UFC events, fighter-history, rankings, odds, and matchup browser. It
runs from one Node server on `http://localhost:8000` and keeps its SQLite database
fresh in the background.

## What it includes

- Complete event cards. Every row carries each fighter's career and UFC record, age, last five results, and the streak they bring in; the header answers "was this card worth watching" with underdog wins, finishes, round-one stoppages, average bout length, bonuses and the biggest upset. An announced card is summarised the same way from what is at stake: ranked fighters, debutants, the closest matchup, the longest price and the longest active run.
- Fighter profiles with a single chronological professional history spanning UFC and verified outside-UFC bouts, career records entering every fight, rankings, and title narratives that distinguish undisputed titles, interim titles, defenses, regains, losses and unifications. UFC rows retain their local stats and matchup links; outside rows link to the verified source event and opponent. A **Records** panel appears when the fighter actually holds a place near the top of the sport, showing their best few.
- Matchup pages built in one order whether the bout has happened or not: what happened (judges' cards, fight totals, round by round), then where both fighters stood walking in (record, current run, last result, time out, age, belt standing, and their last five bouts), then **how they fight** — strike rate, accuracy, strikes avoided, knockdown rate, takedown rate, takedown accuracy, takedowns stopped, submission rate, control share, and how their wins and losses have been split between knockout, submission and decision. Every one of those is computed from the official round-by-round totals of their earlier UFC fights **as of that night**, so an old matchup reads the way it did then, and the physical tale of the tape, opening and closing prices with the line movement between them, previous meetings and common opponents sit around it.
- UFC Meta rankings, plus activity and scheduled-fight status. Every rank badge
  throughout events, matchups, profiles, and rankings comes from this same view.
- **Statistics**, in five cards, three to a row:
  - **Record** toggles between Bouts, Wins and Losses, covering appearances and career span, wins by method or share, winning and unbeaten runs, championship wins, defenses, wins over champions, divisions and age at a win.
  - **Finishing** takes one direction control, so finishing someone and being finished share the same round, method and share qualifiers, alongside finish speed, average fight time and total cage time.
  - **Output** ranks any of twelve tracked actions, given or taken, per bout, round, minute or career.
  - **Context** is who they faced and what they came back from: the combined record of their opponents, champions faced (reigning that night, or anyone who had already held a belt), streaks broken, bounce-back rate, rematches, returns from time off and durability.
  - **Market** reads the closing line from either side, plus wins above a vig-free expectation, flat-stake return and average price.

  Every statistic is reachable from exactly one menu entry, and a test asserts that no two entries produce the same ranking. Any fighter can be pinned into every card to see where they place.

  Turning on **Show more info** makes every row also name the bouts behind its number: the champions faced, the run of opponents in a streak, the belts defended, the fights each knockdown or takedown came from with its own count, the prices taken as an underdog, the two ends of a career. Names are coloured by how the bout went, with the outcome spelled out on hover so colour never carries it alone.
- **Labs**, a mode of Statistics: build a population of fighter-bouts from any combination of age, streak, layoff, experience, previous result, belt status, stance, reach, division, card position and closing odds, then read its combined record, outcome mix, output per round, trend over time and market return. Two populations can be compared side by side.

## Layout

```
server/   Node 26 + TypeScript (run natively, no build step), node:sqlite, cheerio
client/   Vite + React + TypeScript + Tailwind v4
```

## Run

Once dependencies are installed and the client has been built, running the app is only:

```bash
cd server
npm start
```

Open [http://localhost:8000](http://localhost:8000). This starts the API, serves the
client, and runs the background sync/backfill—there is no separate frontend server to
keep running.

The gear beside Search stores three browser-local preferences: light/dark theme,
Meta/Media rankings, and relative/calendar activity dates. Meta rankings and
relative dates are the defaults. The selected
ranking source is used by events, matchups, profiles, and the rankings page.

### First run after cloning

```bash
npm install --prefix server
npm install --prefix client
npm run build --prefix client

cd server
npm start
```

For frontend hot reload during development, run `npm run dev` from `client/`; it
proxies API requests to the server on port 8000.

On first start the server backfills every UFC event ever (~790 events, ~8k fights,
~4.6k fighters) from ufcstats.com. That takes ~30–45 minutes at a polite request rate;
the app is usable immediately and fills in as it goes. `GET /api/status` shows progress.

## How data stays fresh (all automatic, no admin)

| What                | Source           | Cadence                                          |
| ------------------- | ---------------- | ------------------------------------------------ |
| Events list         | ufcstats.com     | hourly                                           |
| Live/next event     | ufcstats.com     | every 3 min on fight day until results are final |
| Upcoming cards      | ufcstats.com     | next event hourly, others every 6h               |
| Past events         | ufcstats.com     | scraped once, immutable                          |
| Fighter roster      | ufcstats.com     | daily + right after each event completes         |
| Complete pro history| Sherdog + UFCStats reconciliation | booked/ranked/active first; weekly while active, quarterly when retired, immediately after a UFC result |
| Rankings            | ufc.com          | every 6h                                         |
| Fight detail pages  | ufcstats.com     | upcoming ≤14d + recent past; older pages lazily verified when needed |
| Odds                | bestfightodds.com| upcoming ≤30d every 6h, frozen after the event   |
| Fighter photos      | ufc.com          | 30-day cache, small batch per minute — ranked and upcoming-card fighters first; viewing any fighter without a photo queues them for the next batch |
| Birth dates         | ufcstats.com     | background batch — ranked and booked fighters first, then by number of UFC bouts; a page with no DOB is retried after 90 days |

Every sync step is independently error-guarded: one broken source never takes the
site down, it just serves the last good data (`last_sync_error` in `/api/status`).

## API

```
GET /api/events              all events (id, name, date, location, status)
GET /api/events/:id          event + fight card with stats, ranks, odds
GET /api/fights/:id          full matchup: tale of the tape, totals, judges,
                             recent form, head-to-head, common opponents
GET /api/fighters/:id        bio, REC + UFC records, verified professional history
GET /api/rankings            selected UFC ranking feed with activity status
GET /api/stats?...           five leaderboards; every control is a query parameter
GET /api/labs?...            one fighter-bout population: combined record, outcome
                             mix, per-round output, yearly trend, breakdown by any
                             dimension, its leaders, and the bouts behind it
GET /api/search?q=...        fighters + events + fights ("x vs y" works)
GET /api/status              sync/backfill progress
```

Endpoints that return ranks accept `?ranking=meta|media`; omitted means Meta.

Both analytics endpoints read one in-memory index of every completed fight
(`server/src/fight-index.ts`), rebuilt only when the underlying tables change.
The index carries each fighter's state *entering* every bout — record, streaks,
layoff, age, belt status, prior output — so a query costs one pass over the
fights rather than per-fighter SQL. A full leaderboard or Labs request answers
in well under a tenth of a second.

## How the numbers are defined

The rules that decide what a figure means, in one place:

- **Win rate** is wins over bouts with an official result. A draw sits in the
  denominator; a no contest is left out entirely.
- **A Labs observation is a fighter-bout**, so one fight contributes up to two.
  A population with no filters is therefore 50% by construction — the point of
  Labs is what happens when you constrain it.
- **Every "entering" figure is as of that night**, reconstructed from earlier
  bouts, never a career total projected backwards. That includes the whole
  matchup profile: there is one source for a fighter's rates, computed here,
  rather than a precomputed career average that keeps moving after the fight.
- **Accuracy and defence come from matched pairs.** A bout only contributes to
  a percentage when the source recorded both the landed count and the attempts,
  so the numerator and denominator always describe the same fights.
- **A title defense** counts only when the athlete entered as the recognized
  undisputed or interim champion of that division and won. The lineage is
  rebuilt from the division's complete belt sequence, so tournament and TUF
  finals never create a reign.
- **Odds are closing lines** from bestfightodds.com. Implied probabilities
  include the vig, so a bout's two sides sum above 100%. Return on investment
  assumes a flat $100 stake on that fighter in every priced bout.
- **Official fight statistics** come from the ufcstats detail page and are
  validated on ingest: targets and positions must sum to significant strikes,
  totals must not fall below them, and every figure must match the event
  summary or the page is rejected rather than stored.
- **Rate leaderboards carry a minimum sample**, shared across every card, so a
  one-for-one record cannot top a percentage board.
- **A champion is a champion as of that night.** "Champions at the time" means
  the opponent held a UFC undisputed or interim belt when the bout happened, in
  any division, so a champion moving weight still counts. "Current or former"
  adds everyone who had already won a belt by then, and never counts a fighter
  for titles they went on to win later. Both readings are one control on the
  Record and Context cards. Because the lineage is rebuilt from fight results,
  a vacated belt stays with its last winner until someone else wins it.
- **Opposition quality is the opponents' combined UFC record on the night they
  were faced.** A fighter met at 10-0 counts as 10-0 forever, whatever they did
  afterwards. Boards rank it by that record's win rate, with a floor on both
  the number of opponents and their combined bouts. Two controls decide what is
  read: whether an opponent's **UFC record** or their **complete career** counts,
  and whether it is read **at the time of the fight** or **as it stands today**.
  The UFC half of every reading is exact, because every UFC bout is dated.
  Outside-UFC fights are imported as individual dated professional bouts from
  Sherdog. A source identity is accepted only after an exact name plus two
  shared UFC bout/date/opponent matches (or, for debutants and one-fight UFC
  careers, stricter record and biography checks); ambiguous matches are kept
  out rather than guessed. Source summary totals must also equal the parsed
  history rows. UFCStats remains authoritative for UFC-specific statistics,
  while the verified full source timeline supplies complete-career totals and
  records at fight time; reconciled rows prevent duplicate display or counting.
  Consequently, a complete career read only includes bouts that had actually
  happened by then. Fighters whose external identity has not yet verified are
  omitted from complete-career analytics until it does.
- **A record on a fighter's profile is a top-five place across the whole
  promotion, or a top-three place inside a division deep enough for that to
  mean something.** The whole table is rebuilt whenever the fight data changes,
  so a record moves the night someone passes it.
- **Profile statistics include every qualifying top-50 placement** from the
  all-time UFC data, including alternate count/rate readings and youngest or
  oldest age at a win. Related readings are grouped into one profile category,
  while elite entries already shown under Records are not repeated.
- **Wins above the market** removes the bookmaker's margin first: each pair of
  closing prices is normalised to sum to one before it is treated as a forecast,
  so the figure is wins minus a fair expectation rather than a vig-inflated one.

`npm test --prefix server` checks these against independent SQL over the same
rows, including known reign lengths and the calibration of the closing line.

## Notes

- `server/data/ufc.db` is the local state; delete it to re-backfill from scratch.
- Complete-career backfill is resume-safe and runs in the background. Verified
  source URLs are refreshed directly; shared UFC bouts seed the opponent's
  source URL, reducing name-search dependence while preserving identity checks.
  Opening an unverified fighter profile also runs that fighter's sync immediately,
  with in-flight requests deduplicated and failures falling back to UFC-only data.
- ufcstats.com's records start at UFC 2 (Mar 1994) — UFC 1 isn't in their database.
- ufcstats.com fronts requests with a small proof-of-work interstitial; the fetcher
  in `server/src/http.ts` solves it like a browser would and stays throttled
  (~1 req/s per host) to be a polite client.
- Ages are only as complete as the birth-date backfill; every view that uses
  age says what share of its bouts have one.
- Rankings activity colors: light blue = has a fight booked, orange = fought in
  the last 45 days, plain = free. The window is `ACTIVE_WINDOW_DAYS` in
  `server/src/api.ts`. Last-fight label text uses green = win, red = loss,
  amber = draw and gray = no contest.

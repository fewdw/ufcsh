# UFC.sh

A fast, local UFC events, fighter-history, rankings, odds, and matchup browser. It
runs from one Node server on `http://localhost:8000` and keeps its SQLite database
fresh in the background.

## What it includes

- Complete event cards, broken by broadcast — early prelims, prelims and main card each under their own heading and their own announced start time, with every bout after that heading estimated from it at half an hour a bout and forty minutes for anything scheduled for five rounds. Every row carries each fighter's career and UFC record, age, last five results, and the streak they bring in.

  The header answers "was this card worth watching" in **five lines, chosen for this card**. Both a fought card and an announced one can be described a couple of dozen ways — finishes, round-one stoppages, knockdowns, the fastest finish, the biggest upset, bonuses, debut winners, split verdicts; or belts, champions, undefeated records, the closest matchup, the longest price, the longest active run, rematches, layoffs, ages and reach. Each of those is scored for how remarkable its number is on *this* card, and only the best five are shown, at most two from any one theme. So a night of first-round knockouts leads with the finishes, a card the favorites swept says so, and a card carrying two belts leads with the belts.
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

  Every statistic is reachable from exactly one menu entry, and a test asserts that no two entries produce the same ranking. Any fighter can be pinned into every card to see where they place. The five cards keep one fixed order and one fixed header height — a title, two lines of definition and the controls, whether a card takes one qualifier or five — so all five lists start on the same line.

  Turning on **Show more info** makes every row also name the bouts behind its number: the champions faced, the run of opponents in a streak, the belts defended, the fights each knockdown or takedown came from with its own count, the prices taken as an underdog, the two ends of a career. Names are coloured by how the bout went, with the outcome spelled out on hover so colour never carries it alone.
- **Labs**, a mode of Statistics: build a population of fighter-bouts from any combination of age, streak, layoff, experience, previous result, belt status, stance, reach, division, card position and closing odds. The interface focuses on Combined Record and its source bout list. Excluding a bout updates the study; restoring it is available even when all observations have been excluded.

  A study can also be filled from any announced matchup. That matchup implies
  one list of conditions — both ages narrowed to within two years of each
  fighter, experience, prices, layoffs and streaks tightened around their
  actual values, the reach, height and age edges with the size of each, and the
  bout's own shape stated either way (a three-round non-title undercard bout is
  as much a condition as a five-round title fight). Every one of them is a
  switch, named after the fighter whose fact it is, showing the population it
  leaves once it and everything above it has been applied.

  **Basic, Normal and Advanced are three selections over that one list, not
  three lists**: Basic applies only what makes the matchup itself — its
  division, both ages, belts and market role — Normal adds every condition that
  still leaves a sample worth reading, and Advanced adds every one with any
  precedent. So switching every box on by hand lands on exactly the Advanced
  study. Advanced can narrow all the way to no bouts at all; that is what
  asking for every condition at once means, and the running counts show which
  condition emptied it, with the list opening itself when that happens.
  **Switching one off keeps the matchup** and every other condition, and
  choices made by hand survive a change of corner. Conditions with no
  precedent are listed struck through and cannot be switched on.

  Conditions asked of both fighters are decided as one, and what belongs to the
  bout is decided before either corner, so reading the fight from the other
  side gives the mirror study: the same divisions, ages, stances, experience
  and prices, swapped. The exceptions are a fighter's previous result, streak
  and layoff — there is no opponent-side filter for those, so they follow the
  corner the record is read from, which is why they are named after them.

  Below the board, **two interactive explorers read the same population**.
  **The judges’ room** lets you filter verdicts and individual judges, compare
  dissent and eras, click scorelines, and open the actual three-card panels
  with both fighters’ totals. **The road to the UFC** freezes verified pro
  histories at debut, compares arrival profiles over debut/first-three/
  first-five/all matching UFC results, and cross-filters age and experience
  through a clickable heatmap. Both offer question presets, sample controls,
  exact tables, source links, and CSV exports. Main study filters and exclusions
  apply throughout; room filters respond immediately. [Definitions and
  limitations](docs/labs-categories.md) explain the counting units, coverage,
  debut cutoff, and result windows.
- **Card quality** appears only beside event titles as five gold Lucide stars, with quarter-star fills. Hover for the exact 0–100 score, coverage and factor breakdown. Not every bout is the card: the main event carries six times the weight of a prelim, the top two are read again on their own, and the headliner is a factor in its own right, so a dull opener costs almost nothing and a dull main event costs a lot. Completed cards are reviews, led by what the fights delivered — finishes weigh heavily, a knockout above a submission, a decision at zero unless the promotion called it the Fight of the Night — and each review keeps the pre-fight rating beside it, so the tooltip can say what the night added or cost. Reigning champions count as part of what is at stake, and the card's make-up carries a stated editorial preference toward the men's divisions. Announced cards are estimates: under six announced bouts there is no rating and no stars, and between six and eight the estimate is held near the middle of the scale until the card fills out. Ranked fighters count on announced cards only, because the rankings feed has no archive to rate a past card with. [The versioned formula](docs/card-quality.md) explains the evidence and limitations. Scores refresh with synced card and odds changes.
- **Activity dots** distinguish both outcome and method: solid green/red for wins/losses by KO/TKO or submission, hollow green/red for decisions. Hover text names the result; unknown methods are not presented as finishes.

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

Pages say how old their copy is rather than letting it look current: an event
header carries "Odds updated 3h ago" (and "Closing odds · frozen" once a card is
over), and the rankings header carries its own sync age. Past the expected
cadence — twelve hours for live prices, a day for rankings — the age turns amber
and says it may be stale, which is what a silently failing background sync looks
like from the page. The exact timestamp is in the tooltip. An age describes when
this copy arrived, never that the source has not changed since.
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
  A population with no filters has equal wins and losses. Its win rate is
  slightly below 50% when draws are present, because draws stay in the denominator.
- **Every "entering" figure is as of that night**, reconstructed from earlier
  bouts, never a career total projected backwards. That includes the whole
  matchup profile: there is one source for a fighter's rates, computed here,
  rather than a precomputed career average that keeps moving after the fight.
- **Accuracy and defence come from matched pairs.** A bout only contributes to
  a percentage when the source recorded both the landed count and the attempts,
  so the numerator and denominator always describe the same fights.
- **Missing action data is unknown, never zero.** Labs computes given/taken
  rates from paired observations for each action, with its own timed sample.
  Control shares in Labs, matchup profiles and profile records use only the
  elapsed time of bouts contributing recorded control. Sample sizes are displayed.
- **Probability filters use unrounded prices.** Rounding is for display only;
  decimal bounds constrain the underlying implied probability. Market calibration
  displays margin-free implied probability alongside actual wins from the same
  priced win/loss/draw sample. Draws return the stake; no contests are excluded.
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
`npm test --prefix client` checks shared-request deduplication, failure and retry,
out-of-order responses, and bounded cache retention. Page code is loaded on
demand, and failed analytics requests display a retry action with retained
results explicitly labelled as previous results.

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

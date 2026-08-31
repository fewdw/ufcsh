# UFC.sh

A fast, local UFC events, fighter-history, rankings, odds, and matchup browser. It
runs from one Node server on `http://localhost:8000` and keeps its SQLite database
fresh in the background.

## What it includes

- Complete event cards with closing odds, result details, bonus markers, and completed-card summaries: underdog wins, finishes, KO/TKOs, and submissions.
- Fighter profiles with career records, rankings, and title narratives that distinguish undisputed titles, interim titles, defenses, regains, losses, and unifications.
- Matchup pages with tale of the tape, judges' cards, round-by-round stats, recent form, common opponents, and odds.
- UFC Meta and Media rankings, plus activity and scheduled-fight status.

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
| Rankings            | ufc.com          | every 6h                                         |
| Fight detail pages  | ufcstats.com     | upcoming ≤14d + recent past; older pages lazily verified when needed |
| Odds                | bestfightodds.com| upcoming ≤30d every 6h, frozen after the event   |
| Fighter photos      | ufc.com          | 30-day cache, small batch per minute — ranked and upcoming-card fighters first; viewing any fighter without a photo queues them for the next batch |

Every sync step is independently error-guarded: one broken source never takes the
site down, it just serves the last good data (`last_sync_error` in `/api/status`).

## API

```
GET /api/events              all events (id, name, date, location, status)
GET /api/events/:id          event + fight card with stats, ranks, odds
GET /api/fights/:id          full matchup: tale of the tape, totals, judges,
                             recent form, head-to-head, common opponents
GET /api/fighters/:id        bio, record, ranking, full UFC history
GET /api/rankings?type=meta  UFC model rankings with activity status (default)
GET /api/rankings?type=media traditional media-panel rankings, including P4P
GET /api/search?q=...        fighters + events + fights ("x vs y" works)
GET /api/status              sync/backfill progress
```

## Notes

- `server/data/ufc.db` is the local state; delete it to re-backfill from scratch.
- ufcstats.com's records start at UFC 2 (Mar 1994) — UFC 1 isn't in their database.
- ufcstats.com fronts requests with a small proof-of-work interstitial; the fetcher
  in `server/src/http.ts` solves it like a browser would and stays throttled
  (~1 req/s per host) to be a polite client.
- Rankings activity colors: orange = has a fight booked, light blue = fought in
  the last 45 days, plain = free. The window is `ACTIVE_WINDOW_DAYS` in
  `server/src/api.ts`. Last-fight label text uses green = win, red = loss,
  amber = draw and gray = no contest.

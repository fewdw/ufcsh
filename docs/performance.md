# Performance

Measure first, then change what the measurement points at. This page records
the targets, how to measure against them, and the last measured results.

## Targets

| Measure | Target |
| --- | --- |
| API p50 for page data (event, matchup, fighter) | under 50 ms warm, under 150 ms cold |
| API p95 under a realistic mix at 2,000 req/s | under 500 ms |
| Errors under that load | none (no 5xx, no dropped connections) |
| Main client bundle (gzip) | under 130 KB; every page beyond Events loads on demand |
| Share image (`/og/*.jpg`) | under 100 KB, first render under 1.5 s alone |
| Added memory per query worker for a new feature | stated in the change |

## How to measure

```bash
# a production-shaped server: 2 query workers, rate limits per visitor
cd server
DATA_DIR=/path/to/data NO_SYNC=1 PORT=8012 API_WORKERS=2 TRUSTED_PROXY_IPS=127.0.0.1 node src/production.ts
# warm mix, 100 clients
node src/load-test.ts --url=http://localhost:8012 --seconds=20 --concurrency=100
# cold: spread across ~2,000 distinct pages so caches miss
node src/load-test.ts --url=http://localhost:8012 --seconds=20 --concurrency=100 --cold
# open loop: 2,000 requests a second, ~5,000 visitors at one page view per 20 s
node src/load-test.ts --url=http://localhost:8012 --seconds=20 --rate=2000
```

The mix includes page HTML, cards, matchups, fighter profiles and their stat
boards, officials, venues, search, images, share images and
page-view beacons, weighted roughly like real traffic.

## Last results (2026-09-24, V2 branch)

Measured on the production host (4 vCPU, 8 GB) while production and dev were
also running, so these are floors rather than ceilings.

| Run | Throughput | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| Warm, 100 concurrent | 3,605 req/s | 22.7 ms | 55.9 ms | 99.9 ms | none |
| Cold, 100 concurrent | 894 req/s | 5.7 ms | 379 ms | 614 ms | share images shed with 503 |
| Open loop, 2,000 req/s | 1,999 req/s | 4.0 ms | 601 ms | 1.8 s | none |

A single cold request costs 2–13 ms (matchup ~8–13 ms, fighter ~6 ms, stat
board ~6 ms), so the cold tail is queueing behind two workers,
not slow code. 404s in the mix are booked debutants, which have no profile.

Memory: the V2 indexes add about 25 MB of heap per query worker (full stat
boards 21 MB, officials 4 MB) on the full archive.

## Sync writes stalled readers (2026-09-25, `fast` branch)

Production metrics showed page data with a median near 10 ms but a p95 of
3.4–4.1 s (event, matchup, fighter, stat board, previews). Each sync write
bumps the analytics revision, and every query worker then rebuilt the fight
index (~2 s), the all-fighter record tables (~1.8 s) and the search index
inside the next request — about 60 rebuilds in four hours, in bursts. Requests
queued behind a rebuilding worker waited seconds.

Reproduced locally at 20 req/s over ~2,000 distinct pages while bumping the
revisions every 8 s (`load-test.ts --rate=20 --cold`
plus a loop running `UPDATE data_revisions SET value = value + 1`):

| Build | p50 | p95 | p99 | fighter p95 | matchup p95 | event p95 |
| --- | --- | --- | --- | --- | --- | --- |
| main | 7.9 ms | 3,199 ms | 3,923 ms | 3,747 ms | 3,681 ms | 3,228 ms |
| fast | 4.3 ms | 18.2 ms | 49.6 ms | 11 ms | 20 ms | 21 ms |

At 100 req/s over the same pages (2 workers), p95 17.5 ms and p99 52.5 ms,
every page type at or under 40 ms p99. An earlier version that refreshed
workers in place (taking one out of rotation) measured p99 144 ms and stalled
entirely with one worker, as dev runs.

What changed:

- Query workers keep the fight and search indexes they built; a request never
  rebuilds one. The main process watches the revision and, at most every 30 s,
  has the pool start a fresh worker, which builds its indexes and reads the
  newest cards, bouts and fighters (compiling each page's code) before it
  takes a request; then the worker it replaces finishes its job and stops. One
  replacement at a time, so capacity never drops and memory rises by one
  worker (~350 MB) for about ten seconds. Warm-up reads queue no source
  refreshes or photo checks.
- The shared response cache serves a stale copy while it rebuilds (10 minutes
  for event, matchup and fighter data, an hour for lists and page HTML), so a
  reader is answered from memory unless nobody has asked in that long.
- The main lists (`/api/events`, live, stats, both rankings, officials,
  venues, insights) are cached as soon as the workers are ready.
- Client: `index.html` starts the page's own data alongside the app's code;
  pointing at, focusing or pressing any internal link starts that page's code
  and first data; every page's code loads in the background once the first
  page is idle; the account button opens the profile by handle directly.

At 1,500 req/s the tail on the shared 4 vCPU host is set by CPU contention with
the load generator and the running production and dev apps (main process ~57%
idle, workers ~65% idle in a CPU profile), not by the server's code paths.

## Loading states on reload and between tabs (2026-09-25, `fast` branch)

Measured with headless Chromium, sampling every frame for visible
"Loading…" text. Production (main) showed it on every reload for 300 ms to
1.5 s (the route's code through Suspense, then the page's data). The `fast`
build, over 150 ms of added latency, showed none on first visits, reloads or
rapid profile tab switches, across events, matchups, fighters, rankings,
stats, officials, venues, judges and profiles.

- The last answer for each page is kept in localStorage (`snapshots.ts`,
  2.5 MB, dropped on a new build, ignored after a week). A reload paints it at
  once and always fetches the newest data behind it.
- The current page's code is awaited (at most 300 ms) before the first render,
  and a page whose code is already loaded renders without Suspense.
- Profile lists (predictions, bets, comments) are remembered by key, the
  other tabs are read while one is shown, and a tab opened again shows its rows
  while they refresh. The owner's own identity is remembered, so their
  controls and the account button are right before Clerk loads.
- The reader's own panels (their pick, their scorecard, the discussion as they
  see it) render from the account this browser last saw and their last answer
  while Clerk loads; requests wait for the session (`getToken`) and refresh
  them. The score editor and discussion ship with the matchup page: as lazy
  chunks they sat behind React's 300 ms Suspense reveal throttle.
- One Suspense boundary sits outside the per-section error boundary, so a
  section switch (a transition) keeps the current page until the next is ready;
  the header sections' code loads first, 300 ms after the first page, and their
  default data (events + the landing card, rankings, stats) after that.
- Fighter photos remember which copy is already in the browser's cache
  (versioned URLs, cached for a year), so a reload paints the sharp copy
  directly instead of placeholder then photo.
- Every remaining loading line stays invisible for its first 350 ms
  (`.appear-late`), and a list refreshing in place dims only after 200 ms.

## What changed because of the numbers

- Share images first rendered at up to 665 KB PNG and 1.6 s under load: they
  are now JPEG (60–75 KB), rendered at most two at a time with identical
  requests sharing one render, and shed with `503 Retry-After` past a short
  queue so a crawler burst cannot starve page requests.
- Share-card data is read inside query workers, so the main process never
  builds the fight index.

## Already in place

Route-level code splitting, hover prefetch, one shared request per URL with
stale-while-revalidate, polling with jitter and backoff that stops in hidden
tabs, a bounded server response cache, per-visitor rate limits with a stricter
bucket for expensive routes, and image variants (`?size=tiny|small`).

## Not yet claimed

The runs above do not prove capacity for thousands of simultaneous live-scoring
users on fight night: score submissions and comment writes go to SQLite in the
main process and were not part of the mix. Before claiming that, load-test the
write paths on a quiet host and put a CDN in front of the public read routes.

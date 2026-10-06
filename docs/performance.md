# Performance

Measure first, then change what the measurement points at. This page records
the targets, how to measure against them, and the last measured results.

## Stepping between event cards (2026-10-06)

Playwright on the VPS against the dev container's data: a 390×844 touch phone with
4× CPU throttling, tapping the floating Prev/Next pill with the neighbouring card
already cached. Time from the tap to the new card's name on screen (tap overhead
included), the median of seven steps.

| Build | Tap to new card |
| --- | --- |
| Before | ~2,070 ms |
| Date formatters built once | ~670 ms |
| Plus memoized events-list rows | ~450 ms |

Each step re-rendered the 800-row events list, which stays mounted under the
card on a phone. Each row built a fresh `Intl.DateTimeFormat` (~1 s of a 1.04 s
long task) and was a router `Link`, which re-renders on every navigation. The
formatters in `client/src/format.ts` are now module constants. The rows are
memoized plain anchors, and the list routes a plain click itself, so a step
redraws only the two rows whose selection changed.

## Local Tailscale previews (2026-10-05)

Measured with `/usr/bin/time ./start` on the home server (12 cores, 31 GiB RAM,
Node 26.10.0, ext4) against a 448 MB private copy of the VPS dev archive. "Ready"
means the API `/readyz` and the Vite page both answer.

| Operation | Wall time |
| --- | --- |
| Old launcher's mandatory client build (`tsc -b && vite build`) | 11.36 s |
| New worktree: `npm ci` for server and client, archive copy, start | 15.2 s |
| Start with dependencies and data in place | 1.6 s |
| Run again while it is up (prints the URL) | 0.06 s |

A new worktree's time is almost all `npm ci` through `tools/heavy.sh` (warm npm
cache); the archive copy is 0.5 s. Two previews ran side by side on ports 5101 and
5102, about 410 MiB each at idle against a 2 GiB cap. Hot reload connected over WSS
through Tailscale Serve. Vite returned 403 for an unknown `Host` and for `/@fs`
paths outside `client/`.

## Mobile sheet scrolling (2026-10-05)

The sheet drag handler used to claim downward gestures inside a scrolled list,
cancel the native touch events, and write `scrollTop` for each move. A fling
back up the list therefore stopped at finger release instead of carrying native
momentum. Gestures that begin inside a scrolled list now remain native until
release, even if they reach the top; a fresh downward pull at the top or on the
sheet header still dismisses.

Measured with Chromium touch input at 375 × 812, using the actual drag handler
in an isolated sheet with 112 rows of 40 px. An eight-step, 240 px downward swipe
from the bottom canceled 8 touch moves and made 8 JavaScript scroll writes
before the change; it traveled 0 px after release. After the change, 7 delivered
moves canceled none and made no JavaScript scroll writes; the browser carried
another 125 px in the following 500 ms. Distances depend on input timing; this
checks native gesture ownership and momentum, not a frame-rate target or an
iOS device measurement. Regression tests also cover reaching the top mid-swipe,
reversals, fresh top pulls, header pulls, taps, cancellation, and desktop behavior.

## Agent workflow and deployment (2026-10-04)

Baseline host: four CPU cores, 7.6 GiB RAM, 4 GiB swap. At inspection production
used 1.84 GiB, dev 1.19 GiB, and each of three Codex processes plus its launcher
used about 250 MiB before tools. This is a snapshot, not measured peak capacity.

[Main release 37207825236](https://github.com/fewdw/ufcsh/actions/runs/37207825236)
took 102 seconds: checks 43 s, host client build 24.6 s, and 16 s from container
start to reported healthy. One manual dev selection waited about 52 s before
its job started. The same feature commits also ran push and PR checks separately.

The new workflow removes push-triggered feature checks/deploys and release-time
dev rebuilds. Ready transitions request CI; completed tasks claim/queue dev with
local commands, so queued tasks launch no GitHub deployment runner. Healthy
identical deployments skip builds. Documentation/tests are excluded from the
client Docker COPY to preserve its build cache. Startup health probing changes
from the default 5-second start interval to 1 second; readiness criteria stay.

Heavy commands share one slot and have a 2 GiB systemd scope; Docker builds have
a separate 2 GiB/two-core builder. The optional session launcher caps three
sessions in a shared 2 GiB slice. Verified on this host via its actual cgroup and
systemd `MemoryHigh=1610612736`, `MemoryMax=2147483648`, `MemorySwapMax=536870912`.
These controls require their entrypoints; they cannot intercept direct T3 launches.
The real bounded builder reports 2,147,483,648-byte RAM/swap budgets and a
200,000-microsecond CPU quota. A cold dev image build took 80.6 s (new builder,
including downloads); repeating the unchanged build took 3.94 s. The resulting
image's baked revision matched the task commit. No existing dev review was reset.

The full archive suite ran in 245 s with 791,228 KiB peak RSS and no swaps.
418/419 checks passed; the existing HTTP integration check exceeded its 10-second
readiness window. Its deadline is now 30 seconds to accommodate full-archive
warm-up on this shared host; the affected check passed in 11.9 s after the change.
Do not repeat the entire suite for unrelated edits;
rerun affected checks. No browser was launched for infrastructure verification.

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

## Roster changes (2026-09-27, `feat/nav-more-menu`)

Measured on a copy of the dev archive, 5-run averages, warm fight index.

- `/api/roster` build: 55 ms → 7.6 ms. Unlinked names ran a spacing-blind
  scan of every fighter (`replace(norm_name, ' ', '')`) on each request; a
  signee's own profile is now looked up by id first, so the scan only runs for
  names with neither. Built at most once a minute and served from memory.
- ufc.com status queue (sync worker, once a minute): 30 ms to pick the next
  two fighters due. Each of the ~920 fighters with a bout in the last three
  years is re-read every 12 hours: ~1,850 athlete pages a day (~100 KB each).
- `/api/officials` build: 0.4 ms → 8 ms, for each judge's agreement with the
  rest of the panel and the fans (every card, ~12,000). Built once per fight
  index version and served from the response cache.
- `/api/stats` (uncached, default settings): ~320 ms, unchanged in kind; the
  Fights card (bouts, judges, referees) adds 10–15 ms, one pass over the
  filtered bouts with each bout's officials looked up by id. Every other card's
  cost is the shared aggregation loop, as before. Served from the response cache.

- ufc.com signings: one athlete-search page (newest 21 profiles) every 5
  minutes, plus one athlete page per new profile until it reads Active (re-read
  at most every 30 minutes). About 290 requests a day in all.
- News: 15 outlets every 10 minutes (8 feeds read directly, 7 through Google
  News, spaced a second apart on that host): ~6 s in the sync worker, ~2,200
  requests a day. Each `/api/news` page (30 stories, outlet filter and search
  applied) then takes under 5 ms and ~25 KB before compression, and is served
  from the response cache.
- Fighter news (2026-09-29, `feat/fighter-news`): items are kept a month
  instead of three weeks so a fighter's News tab has a month of history, and
  the story list is built over all of them. Measured on a month made from the
  dev copy (2,500 items): a cold build 270 ms, now done in each query worker's
  warm-up; a rebuild after a feed read 85 ms (was ~175 ms for three weeks),
  since each item is read against the fighter names once and kept while the
  worker's index stands, and stories are only matched within a day of each
  other. A fighter's page of news is a filter over the built list: ~2 ms. (Six
  months measured 250 ms a rebuild and 22 MB per worker; a year 400 ms and
  43 MB.)

## Judge baseline (2026-09-27, `feat/official-venue-pages`)

Judge profiles compare each rate with every UFC judge in the same years and
divisions, which reads all ~12,000 judge cards. The cards are read once per
fight-index version (about 350 ms, first request after a data change) and
reused; each uncached `/api/judges/:slug` then took 30–75 ms locally across
four filter combinations, before the response cache.

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

## Rankings hover results (2026-09-27)

On the dev archive, linked opponent results and scheduled opponent IDs add
29,714 bytes to the media rankings JSON, or 4,303 bytes with gzip, compared
with the same response without those fields. The response includes only
currently ranked opponents. Hover highlighting reads that response in memory
and introduces no per-hover data request.

## Career-stat evidence (2026-10-02)

Opponent evidence loads only when a stat opens, sharing one response per fighter
and matchup cutoff through the existing bounded caches. Profile averages use
normalized fight actions already held by the index; there is no new persisted
average or separate career index.

Opening a matchup category loads both fighters through those same caches;
changing the sort or opening another category adds no endpoint or per-sort
request. Numeric sorting runs locally on each fighter's small recorded list.

On a private development archive of 8,909 fights, 1,000 uncached calculations
for Jim Miller's 47-bout career measured 0.073 ms p50 and 0.273 ms p95. The full
evidence response was 35,842 bytes, 5,518 bytes gzipped, including raw takedown
attempts and control time for the compact opponent rows. Index heap retained after
GC was 117.00 MiB before and 117.76 MiB with this feature (about 0.76 MiB added
per query worker in this sample). The extra retained fields track time only for
bouts with recorded takedowns, knockdowns and submission attempts.

## Confirmed title updates (2026-10-04)

Confirmed undisputed results overlay the published rankings at read time;
there is no new polling, source request or stored rankings list. Result evidence
and current rankings are cached per profile revision and UTC day. Finishing a
weigh-in read invalidates the cache even when everyone made weight.

On a private development archive, the first current-rankings read took 11.1 ms;
1,000 cached fighter-rank lookups averaged 0.073 ms. Natalia Silva's timeline
over 200 reads measured 6.3 ms p50 and 9.6 ms p95. The initial mean comparison
was 6.4 ms before the title overlay and 7.0 ms after it. Existing API response
caches still reuse those results across visitors.

## Rankings date picker (2026-10-04)

The first React Aria implementation loaded its calendar with the rankings page:
the production page chunk measured 266.99 kB (84.43 kB gzipped). Loading the
picker when its calendar icon opens keeps the rankings chunk at 23.40 kB
(7.75 kB gzipped), with a separate 240.02 kB (76.44 kB gzipped) picker chunk. These are
Vite build measurements with the committed dependency lockfile; they measure
transfer size, not elapsed load time. Date changes retain the displayed list
and its date/source context until the replacement response arrives, avoiding a
blank loading state and preserving the existing cards and scroll position.

## Full ranking-history tooltips (2026-10-05)

The original full tooltip fetched `/api/rankings?date=…` after each pause in
mouse movement. On a private dev archive of 105,209 rows and 549 distinct
dates, 30 dated reads across six dates measured 14.75 ms p50 and 16.99 ms p95
(including JSON serialization, after index warm-up). Each response averaged
170,573 bytes of JSON or 17,107 bytes gzipped, including unused records/activity.

Profiles now preload one `/api/rankings/history` archive per relevant division
and source, even with the checkbox off. Names/identities are stored once and
only changed division lists are repeated. Every publication date remains so
unchanged lists and removed/reintroduced divisions select accurately. Hovering
uses binary searches in memory and makes zero requests. Division keys are shared
across fighters; P4P always uses the appropriate Media archive. The existing
bounded origin cache coalesces concurrent misses and retains compressed bodies;
browser/CDN caching and saved browser snapshots reuse transfers. There is no new
retained archive index in query workers, polling, database schema or source fetch.

Twenty uncached reads per archive measured:

| Division | Changed lists | JSON bytes | Gzip bytes | p50 ms | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bantamweight | 284 | 60,334 | 7,587 | 54.70 | 76.75 |
| Men's P4P | 313 | 63,472 | 8,874 | 53.70 | 89.09 |
| Women's Bantamweight | 253 | 53,945 | 6,757 | 62.50 | 79.76 |
| Women's Flyweight | 181 | 42,078 | 5,801 | 50.40 | 62.70 |
| Women's P4P | 116 | 28,016 | 4,265 | 35.56 | 64.61 |

Merab's full career preload totals 16,461 gzip bytes; Valentina's three classes
total 16,823, each less than the average single old hover response. All 14
divisions for both sources total 189,579 gzip bytes in the bounded origin cache.
100,000 local date selections averaged 0.00103 ms each. A 1,000-request burst
against the actual `ResponseCache` produced one archive build and one shared
compressed representation in 74.32 ms, retaining 7,605 bytes including its key.
This is an in-process cache/selection benchmark, not an HTTP capacity claim.

An isolated browser preview with the actual dev archive made two preload
requests before hovering, then zero additional requests across 30 hovered dates.
Both columns' #15 rows fit without scrolling in a 327 px tooltip at desktop and
390 px phone widths. Near the viewport top, the tooltip opens below the chart
when that fits. The checkbox defaults off and survives profile changes and
browser navigation through the existing local settings store.

## Roster timeline reports (2026-10-06)

Profiles attach every archived roster report whose name matches the fighter.
Adding 2,029 Wikipedia reports raised that per-request build from 11.5 ms to
48.5 ms on a production snapshot (5-call average after warm-up). Name matches
are now kept per `profiles` data revision: the first build after a change
takes 60 ms, later ones 6.7 ms.

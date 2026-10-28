# Performance

Measure first, then change what the measurement points at. This page records
the targets, how to measure against them, and the last measured results.

## Matchup Odds tab revisits (2026-10-28)

Measured in the local Vite preview with Chromium, using a 400 ms delay on the
Polymarket detail request. Before the fix, three returns from Matchup to Market
remounted the panel and started **six detail requests** (the development React
Strict Mode mount cycle starts two each time). Its chart controls were reset.

The combined Odds panel now stays mounted after its first visit, with fetching
paused while hidden. Three quick returns made **zero new detail requests**,
inserted **zero loading placeholders**, and retained the same panel DOM node,
Pre-fight selection and replay slider position. A hidden panel made no detail
requests over 5.5 seconds; returning after that resumed refresh in place without
a loading placeholder. Prices still expire by their own 15/90-second timestamps.

The replay slider was subsequently removed; the chart and its range selection
remain, with hover and keyboard point inspection.

The same check covered 375, 768 and 1280 px widths without horizontal overflow,
light/dark mode, and old Market links opening Odds. On the wide hero, the label
and Polymarket pill each sit 21 px inside the card edge (including its border),
with matching 8 px gaps above and below the sportsbook odds box.

## Anti-doping profile counts (2026-10-27)

Measured on the home server, Node 26, against an isolated archive copy with
7,985 public test-history rows and 2,778 booked UFC fighters. These are local
module timings, not whole-page latency or a VPS throughput claim.

- The profile's prepared indexed lookup, over 10,000 mixed fighter reads:
  median **0.007 ms**, p95 **0.019 ms**. It fetches no external pages and adds
  the counts to the existing profile response, with no extra browser request.
- Full background identity matching: **1,087 ms** before the accuracy audit;
  **113–150 ms** across six passes afterwards. Previously, each carry-forward
  lookup rescanned every source row. A map now resolves those names once, and
  reviewed aliases replace the first-name-prefix and edit-distance inference.
- The bundled public snapshot is **230,592 bytes** (about 231 KB), loaded only
  at bootstrap, never per profile request. Identical refreshes and repeated
  imports leave profile revisions unchanged. Count/link changes invalidate
  profiles, without rebuilding analytics or search.

A production-mode startup with background sync disabled and no test-history
rows in its private database copy imported the bundle before serving HTTP;
GSP and Alexia Thainara's profile APIs then returned their linked histories.

## Production baseline and worker memory (2026-10-14)

Five days of saved prod traffic (Oct 9–14, one event weekend): about 195,000
requests, nearly a third of them health probes. Of the 145,000 from readers,
46% were images. The site-wide average was
10.6 ms; the busiest hour was about 15,000 requests (4/s). The slowest routes
by average were admin (180 ms), `/api/stats` (143 ms), share images (247 ms)
and profiles (76 ms). Over 7 days the event loop's p95 never passed 27 ms, and
the response cache hit 36% of the time.

`/api/stats`: on a copy of the Oct 7 prod archive, a warm `getStats` takes
16 ms (one division) to 190 ms (`moreInfo=1`); the first build is 2.2 s,
done at startup. It runs in a query worker, so it never holds up other
readers. With about 170 Stats page views in those five days, it was left
as is.

Memory: the app used 2.0–2.7 GB RSS in prod on an 8 GB host that also runs
dev, buildkit and Grafana (lowest available memory over 7 days: 1.15 GB). A
local production-shaped server on the same archive, measured over its
process tree, after two 30 s cold load mixes at concurrency 50:

| `API_WORKERS` | Ready | After mix 1 | After mix 2 | Cold mix |
| --- | --- | --- | --- | --- |
| 2 (prod) | 1,246 MB | 1,881 MB | 2,027 MB | 5,374 req/s, p99 14 ms |
| 1 | 782 MB | 1,317 MB | 1,488 MB | 831 req/s, p99 1,540 ms |

Each query worker costs about 460–540 MB, mostly its own fight index, and
the response caches add about 750 MB as they fill. One worker would still be
far above prod's peak, but it has none of the headroom, so prod stays at 2.
If memory gets tight, shrinking the per-worker fight index is the lever,
not the worker count.

## Profile scorecard filters (2026-10-13)

Each profile filter, search and page used to work out the scorer's whole card
list again (bouts, rounds still scorable, fans' averages, judges' totals). On a
copy of the dev archive, the largest profile (111 cards) took a median 21 ms of
server time per request, so every first click on a filter paid it again
(23–37 ms measured in the dev container, plus the network).

The list is now worked out once per scorer and reused for every filter, search
and page: a median 0.06 ms per request after the first. It is replaced at once
by the scorer's own save, by any change to the fight database (the `analytics`
revision) and by rounds being trimmed or opened; other fans' new cards reach the
fans' average within a minute. At most 256 scorers' lists are kept. Opening the
filter menu also fetches the other filters' first pages, so the choice is on
screen without waiting for the network.

## Security: bounded request metrics (2026-10-11)

The legacy `/api/metrics` latency map kept arbitrary public-route slugs and
nested IDs for the process lifetime, even for rejected requests. A local
synthetic check with 10,000 distinct nonexistent judge URLs produced 10,000
keys before the fix and one with the existing fixed `routeGroup` labels.
No requests were sent to production for this measurement.

The HTTP regression check sends 96 rejected POST requests across four resource
families to an isolated loopback server: four metric entries now retain all 96
requests. This bounds label cardinality; it is not a load-capacity claim.

## First page load on a phone (2026-10-08)

Lighthouse 12 mobile preset (simulated slow 4G, 4× CPU) against a production
build on the VPS, served by `server/src/production.ts` over a copy of the dev
archive, built with the dev Clerk key. Median of five runs per page:

| Page | Score | FCP | LCP | TBT | CLS | DOM elements |
| --- | --- | --- | --- | --- | --- | --- |
| `/` before → after | 58 → 63 | 2.9 → 2.7 s | 4.6 → 3.9 s | 878 → 744 ms | 0 → 0 | 6,994 → 1,434 |
| Event card | 59 → 67 | 2.9 → 2.7 s | 4.7 → 3.9 s | 937 → 698 ms | 0 → 0 | 6,994 → 1,434 |
| Matchup | 50 → 59 | 2.9 → 2.7 s | 5.6 → 4.6 s | 1,140 → 906 ms | 0.061 → 0 | 6,454 → 894 |
| Fighter | 55 → 57 | 2.8 → 2.6 s | 5.2 → 5.0 s | 854 → 934 ms (noise: runs 826–1,107) | 0.001 | 2,921 → 2,922 |

What changed, by the measurement that pointed at it:

- **Events list on a phone.** The closed sheet still built all 800 rows (about
  5,600 elements) with the first card. They are now drawn the first time the
  list can be seen (docked, or opened). A throttled load without them blocked
  ~250 ms less. The first open of the sheet costs ~80 ms more (median 994 →
  1,073 ms, 4× CPU, 390 px phone); later opens are unchanged.
- **Page code waterfall.** The page's chunk was requested only after the main
  bundle had downloaded and run. The build now lists each page's chunks in
  `index.html`, which preloads the opening page's beside the main bundle.
- **`/` waited for the code to pick its card.** The inline preload now picks the
  same card as `landingEvent` once `/api/events` arrives
  (`client/tests/indexPreload.test.ts` keeps the two in step).
- **Matchup layout shift.** The phone's row of bouts appeared after the card
  loaded and pushed the matchup down 62 px; it is held open while loading.
- **Brotli.** Built JS/CSS is served Brotli (quality 11, made off the event loop
  on first read; gzip until then): 13.6% fewer bytes than gzip across the
  first load's 47 files (235 → 203 KB).
- **Placeholders.** The two PNG fighter placeholders are lossless WebP
  (35 → 16 KB, 96 → 39 KB, pixel-identical) with hashed, immutable URLs.

Checked and left alone: fonts are system fonts; photo placeholders and small copies are already WebP, sized, versioned and lazy below
the fold; static assets already carry `immutable`. Building `Intl` formatters
lazily would save nothing: Chromium spends ~100 ms (4× CPU) on whichever is
built first. The largest remaining cost is Clerk: ~650 ms of main-thread time
and ~300 KB of script on every load, signed in or not.

## Advanced Tale of the tape (2026-10-07)

`/api/fights/:id/tape-history` is only requested when a reader ticks Advanced.
Measured in Node 26.10.0 on the VPS (4 cores) against a production snapshot
(8,923 indexed fights, 8,767 decided), 200 random matchups:

| Step | Time |
| --- | --- |
| First request after an index build: both corners' tape values for every decided bout | ~390–470 ms |
| Every request after that, until the data changes | median ~3.5 ms, p95 ~8.5 ms |

The per-bout values are held against the fight index object, so they are thrown
away and rebuilt only when the archive changes; no timed cache can go stale.

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
| First load, every script and stylesheet `index.html` names (gzip) | under 185 KB, checked in CI (`client/scripts/bundle-budget.ts`); 166 KB on 2026-10-26 |
| Real readers' LCP at p75 (Admin → Traffic → Load times) | under 2.5 s on phones |
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

Fight night (`src/fight-night-load.ts`, setup in its header): readers arrive
over `--ramp`, open a live matchup and poll it as the client does, and a share
of them save their scorecards after every round bell, with sessions signed by
a key made for the run. Every read reaches the server, as if Cloudflare cached
nothing. Pin the server to four cores (`taskset -c 0-3`) and the load to the
rest to approximate the VPS.

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
  directly instead of placeholder then photo. A remembered copy that has left
  the cache stays hidden until fully loaded and falls back to the placeholder
  after 150 ms, so no photo ever paints top to bottom while downloading.
- The sharp level is a full-resolution WebP (`?size=large`, quality 85),
  not UFC's non-interlaced PNG. Measured on 12 photos from one card
  (2026-10-14): full bodies 329–394 KB → 32–53 KB, headshots 130–167 KB →
  16–22 KB, visually identical.
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

- Per-page share images (`/og/*.jpg`) were drawn on request, about 1 s each;
  crawlers asked for thousands of old bouts once apiece, so nearly every
  request was a cold render. Removed on 2026-10-28: every page now previews
  with one static `/og.jpg`.

## Already in place

Route-level code splitting, hover prefetch, one shared request per URL with
stale-while-revalidate, polling with jitter and backoff that stops in hidden
tabs, a bounded server response cache, per-visitor rate limits with a stricter
bucket for expensive routes, and image variants (`?size=tiny|small|large`).

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

## Saved traffic history (2026-10-09)

`server/src/traffic-history.ts` runs on the API's main thread. Measured in
memory with a synthetic year of 50 active routes every hour:

| Step | Cost |
| --- | --- |
| Counting a request (route row, hashed visitor for hour and day) | ~5 µs |
| Flush every minute | ~1 ms |
| Admin → Health History: 24 h / 7 d / 30 d / 90 d / all | 6 / 12 / 14 / 17 / 32 ms |

The first layout took 350 ms for "all": summing 22 columns over every route
row, then sorting them by route. A site-wide row per hour serves totals and
the timeline, the `(route, hour)` key lets the route table stream groups
without a sort, and route hours fold into days after eight days (29k rows a
year instead of about 447k).

## Judging analysis (2026-10-15)

`server/src/judging.ts` is built once per officials index and venue data,
on a dev archive snapshot (33,050 judged rounds with their numbers):

| Step | Cost |
| --- | --- |
| Build (round edges, stats model fit, controversy, per-judge entries) | ~300 ms |
| `/api/controversial`, first page / one judge's | 2.5 / 0.9 ms |
| A matchup's `judging` block | 1.6 ms |
| A judge's leanings under year filters | 2–3 ms |
| `/api/stats`: Fights → Controversial / Judges → What they score for | +28 / +40 ms over the other Fights boards (~107 ms) |

The first build took ~1 s: `venueOfEvent` checks the venue index's version
with a query on every call, 4,000 times. Reading `venueIndex()` once per
build fixed it. The leanings board likewise reads the state once for every
judge (it was +125 ms).

In production the state was keyed on the venue index's version, which moves
every few minutes as sync re-checks upcoming events. Each check made the next
matchup or event card rebuild it in every query worker: fight detail p95 went
from ~150 ms to ~900 ms after the release (admin Speed warning). Keying on each
event's country instead keeps it: the first matchup after a no-op check went
from ~250 ms to ~26 ms (the venue index's own rebuild) on the dev snapshot.


## Division medians (2026-10-16)

`divisionMedians` (`server/src/division-medians.ts`) takes one pass over the
fight index: 1.46 ms per call over 8,935 bouts (50 Lightweight windows, dev-pc,
archive copy). Answers are cached per index version, division and window end
(400 entries), so a profile or matchup pays it once until the data changes.

## Slow cold cards and matchups (2026-10-19)

Admin → Slow requests listed 247 slow requests in a day. Event cards (145,
~720 ms) and matchups (67, ~760 ms) were nearly all time spent in a query
worker, mostly one or two per address. Half of the single slow requests came
within 30 seconds of a worker rebuild, and two thirds within a minute (by
chance alone it would be under one in ten).

Two causes:

- Both workers were rebuilt about every 6 minutes (179 fight index builds in
  24 h, 2.7 s each) with no new results. Moving lines on the coming cards
  (`odds.f1_close`/`f2_close`) bumped the analytics revision, though the fight
  index reads odds only for bouts with a result. The `odds` trigger now moves
  analytics only for a decided bout; profiles still move every time.
- A fresh worker warmed only the 40 newest bouts. In fight week those are all
  on upcoming cards, so it never fit the judging model (`judging.ts`), and the
  first completed card with a decision, or a decision's matchup, paid for it.
  Warm-up now fits it and loads the latest completed cards too.

On a dev archive copy (dev-pc, one worker): the first old card after start
went from 307 ms to 9 ms. Warm-up grew from 5.6 s to 6.9 s (with the stats
warm-up below), while the worker it replaces keeps answering. The VPS is about
twice as slow, so 700–900 ms there.

The rest of the list, same day:

| Route | Cause | Change | dev-pc |
| --- | --- | --- | --- |
| `/api/stats` boards (22 a day at 250–1000 ms) | Every board walked each opponent's whole career for the complete record entering every bout; detail strings and first/last chips built for every bout | Records memoized per index; strings and chips built only when used; one value pass per leaderboard | Client's real boards, median 180 → ~115 ms; 124 variants byte-identical |
| `/api/news?fighter=` (330–730 ms) | Each feed read rebuilt the stories in the next request | Workers rebuild them on an idle timer | Rebuild ~95 ms on 6,739 items |
| Fighter images, `size=tiny` (300–700 ms) | First view of new art downloaded and encoded it | Main server fetches and encodes re-checked pictures every minute | — |
| `/api/profiles/mine` (430–500 ms) | Daily Clerk avatar lookup inside the request | Refreshed behind the answer; only a first visit waits | — |
| Locations, fighter pages (1 each) | Same cold judging as cards | Covered by the warm-up | ~10 ms cold |

`/api/profiles/mine` can also wait on Clerk's signing keys: production has no
`CLERK_JWT_KEY`, so the SDK fetches them over the network when its copy expires.

## MMA Decisions media scores (2026-10-19)

Reading decisions' MMA Decisions pages (point deductions and media scores) at
concurrency 2 on dev-pc: 200 decisions from 2025–26 in 180 s, 190 matched, so
~0.9 s a decision and about an hour for all 4,139. Adding media scores resets
every decision to unread once; the hourly pass reads recent decisions plus 200
older ones (~3 minutes) beside the sync tick instead of inside it, so the
archive fills in within a day and nothing else waits. Media writes skip
unchanged cards and don't move the data revisions (the matchup reads them
live), so the backfill rebuilds no query workers. Event lists never parse them.

## Production after the October 19 fixes (2026-10-20)

Read from production's saved traffic, slow and error logs and Prometheus. In
the 12 hours after #224 reached production: 4,306 requests, p95 within 100 ms,
p99 within 250 ms, no slow card or matchup. The host (4 vCPU, 7.6 GB) idled at
6–10% CPU with at least 1.75 GB available over four days; prod RSS 1.0–2.5 GB.
Most API traffic is crawlers (hundreds of addresses an hour, about one page view).

| What | Cause | Change |
| --- | --- | --- |
| `/api/stats` after each deploy (9 of 62 at 300–625 ms) | The warm-up built `/api/stats`, but the page asks with every option spelled out: another cache entry | The page's own opening request (`STATS_PAGE_OPENING`) is warmed too; a client test keeps the two equal |
| `/api/profiles/mine` (12 of 12 at 330–510 ms) | The Clerk SDK keeps its signing keys five minutes, so the first signed-in request after a gap fetched them | The server keeps Clerk's keys an hour (`SigningKeys`), refreshed behind requests; `CLERK_JWT_KEY` now reaches the container if set |
| One headshot, 502 after ~7 s on every request | ufc.com's original is 5474×3324, 10.7 MB, over the 10 MB cap; every request downloaded it again | Cap 30 MB, headshots wider than 1,040 px shrunk once; a failed picture is not fetched again for 10 minutes |
| Admin → Bugs (up to 5 s on a query worker) | Each opening built the report on one of the two workers readers use | Reused for a minute; a repair drops it |
| FightOdds.io board for UFC 193, every pass (~11 min) | Their API errors on that board; a failed board stayed due | Retried a day later |

### 2026-10-20: after the October 20 release

Production's slow log after that release: `/api/profiles/mine` still 394–403 ms (2
of 2), a first `small` headshot 6.3 s and a first `tiny` 582 ms; tape history 555 ms.
About 2,000 of 4,928 pictures had never been downloaded.

| What | Cause | Change |
| --- | --- | --- |
| `/api/profiles/mine` after each deploy | Each process (two API workers) held no signing keys until its first token | Every process reads Clerk's keys as it starts (`SigningKeys.warm`) |
| First view of a picture (0.3–6 s) | Only pictures re-checked since start were warmed | The rest of the roster is warmed 20 a minute after each start (`warmUncachedPhotos`) |
| `/api/fights/:id/tape-history` (277 ms locally, first call per index) | The tally of earlier bouts is built on first use | Query workers warm it with the rest of their pages |
| Schedule archive: ~8 ufc.com index pages every 2 minutes, in the tick | 14 cards have no ufc.com page, so the walk never finished | A full lap that times nothing rests the walk 30 days |
| `point_deductions` sync error every hour | MMA Decisions answers this server 403 (an Apache deny; home addresses get 200) | A refused pass is retried daily and listed once in Admin → Bugs, not as an hourly error |

## Production check (2026-10-21)

From production's slow log in the 19 hours after the October 20 release: six
slow requests, none on a card or matchup. Three default Stats boards (454–527
ms) and three `/api/news?fighter=` (300–394 ms). On a copy of production's
archive (dev-pc) the Stats opening is 995 ms cold and 140 ms warm, a card 481 ms
cold and 8 ms warm, so what remains is a first build after a worker rebuild, a
few a day. No change. No sync errors since the release; the 5xx in a week were
seven headshot requests while ufc.com refused two pictures.


## Errors, slow requests and the lock (2026-10-22)

Production's logs for the day after the October 21 release: one sync error, one
5xx, a few 404s that followed links on the site, and 16 slow requests (10
`/api/news?fighter=`, 5 Stats boards at 414–545 ms, 1 profile page).

| What | Cause | Change |
| --- | --- | --- |
| `roster_moves`: "database is locked" | Writes in the sync worker began with a plain `BEGIN`; one that reads first fails at once, without waiting, when the API process writes `meta` in between | Every write transaction is `BEGIN IMMEDIATE`; the sync worker waits up to 10 s for the lock (the API keeps 1 s) |
| 502 on one headshot | ufc.com serves some PNGs as `application/octet-stream`; anything not `image/*` was refused | The picture's type is read from its bytes |
| 404 on `/api/rankings/history?division=Open Weight` from profiles | The 1995–96 Superfight title is a line on its champions' charts but had no archive | A belt with confirmed title results gets an empty archive |
| 404s on `/assets/*.js` after each deploy | Tabs opened before a release name chunks the new image no longer has | Each build's chunks are copied to `/data/assets` at startup and served from there for two weeks after the last build that had them |
| 404s on `/apple-touch-icon-120x120(-precomposed).png` | iOS asks for sized icons no page names | Served the one icon |
| Stats boards, cold (VPS 414–545 ms) | Each fighter's 140-counter aggregate was an object literal, which V8 keeps in dictionary mode: every `+= 1` a hash lookup | A class; 110 board variants byte-identical, average build 273 → 197–212 ms on a copy of production's archive (this host, under production's load) |
| `/api/news?fighter=` (300–410 ms) | Every feed read (90 of 100 bring new items) rebuilds the stories; a worker noticed only every 20 s, so a fighter page opened in between paid ~350 ms | Workers check every 2 s (a few `meta` reads); the card lookup is kept until a card or bout changes. Rebuild 215 → 180 ms |

## Cancelled bouts from every source (2026-10-22)

A card's cancelled list now merges FightOdds.io's board, the article's scrapped
bouts and the pairings its replacements broke up (`cardCancellations`); a
profile builds it for each card that lists one of theirs. On a copy of
production's archive (this host, 400 profiles, 801 cards):

| What | Before | After |
| --- | --- | --- |
| A profile's cancelled bouts | 0.4 ms (board only) | 7.0 ms with one scan of every bout for whom the fighter replaced; 3.5 ms with partial indexes on `f1_replaced_id`/`f2_replaced_id` and one indexed query per corner |
| An event page's cancelled list | Parsed the stored article list | 0.9 ms per card on average |

Profiles are cached by data revision, so the cost is paid once per change.

## Week p95 review (2026-10-25)

Admin showed p95 109 ms, p99 229 ms over Oct 18–25 (142,000 requests). Read
from production's saved traffic and slow logs, probes inside the live container
and a copy of production's archive on dev-pc. Nothing was changed.

| What | Finding | Decision |
| --- | --- | --- |
| `/api/live/odds` | 4,100 of the week's 7,500 requests over 100 ms (fight night: 4,082 of 4,868). Each poll (3 s) finds the 2 s answer expired and waits on Polymarket. Without it the week's p95 is 51 ms, p99 201 ms | Kept: the pill is glanced at, not waited on |
| Cards and matchups at 0.6–1.2 s (`?ranking=media`) | Every one Oct 18–19, none since #224 | Already fixed |
| `/api/profiles/mine` (~400 ms), a headshot 502 after 6.9 s, first `tiny` pictures | None since Oct 20–22 | Already fixed |
| Stats views other than the opening | A cold board is ~420 ms in production (the warmed opening 6 ms); 1–3 a day since Oct 22, some only to answer 304 | Left: per-view caching would split a 1,400-line builder for two slow clicks a day |
| `/api/calendar/google` | 2.4–4 s, five in the week; the reader pressed Connect | Left |
| Detail reads in quiet hours | Often 100–250 ms (e.g. 10 of 14 fight reads in an hour), yet cold builds inside the container are 20–80 ms one at a time (p50 28, p95 80 over 150), 50–100 ms in bursts of six, and 10–50 ms through Cloudflare. Host idle all day (CPU 4–20%, no steal or iowait, 3.7 GB free). A browser-like parallel load put 2 of 12 in 100–250 ms | Not attributable from these logs, so no policy change; per-request queue and build times are needed first |

Query workers were replaced about every 15 minutes on the quiet Sunday: the
card's fan scorecards (`community_score_json`, read by the fan-average
analytics) still change after fight night, which is real data, so the cadence
stays.

## Steadier p95 (2026-10-26)

Admin showed p95 107 ms over Oct 19–26 (141,600 requests) and an hourly p95
line jumping between ~50 and 235 ms. From production's saved hourly
histograms, CPU profiles and timed probes inside the live container, and a copy
of the archive on dev-pc:

- **Fight night.** `/api/live/odds` was 4,174 of the week's 7,437 requests over
  100 ms, all on Oct 24: each 3 s poll found the 2 s answer expired and waited
  on Polymarket. Without them the week's p95 is 50 ms, p99 189 ms (was 226).
- **Quiet hours.** About 20 detail reads an hour (fights, fighters, events)
  take 100–250 ms whatever the traffic, so the hourly p95 rises as traffic
  falls: an hour of 200 requests puts them past 5%. Fighters were the worst,
  18% over 100 ms. Inside the container the same cold builds take 15–50 ms
  back to back and twice that when spaced seconds apart (an idle CPU); the
  remaining gap is still not attributed from these logs.

| What | Cause | Change | Before → after (dev-pc, archive copy, cold builds) |
| --- | --- | --- | --- |
| `/api/live/odds` | Expired answer rebuilt while the poll waited | An answer up to 10 s old is served while the next is read (`ODDS_STALE_MS`) | ~100–250 ms → cache hit; prices one poll (~3 s) later |
| Fighter profiles | 24% matching every roster report to a profile, 20% listing ranking dates (a recursive query, twice per bout), statements compiled per call | Reports matched once until a report or profile changes; list dates kept per data revision, the list before a date found by binary search; cached statements | mean 10.9 → 3.7 ms, p99 20.4 → 10.5 (360 profiles) |
| Event pages | Same ranking lookups per corner | Same | mean 7.4 → 5.8 ms (260 cards) |
| Fights | Division medians scanned all ~9,000 bouts per answer | Bouts grouped by division once per index | mean 7.1 → 5.9 ms (360 bouts) |

All 980 answers byte-identical to before. Next if quiet hours stay spiky: log
queue wait and build time separately for detail reads over 100 ms.

## Edge caching for fight-night bursts (2026-10-26)

Goal: ~1,000 readers at once on fight night, and quick loads on slow wifi.
Measured on production from the home server (Toronto edge):

- Inside the container, `/`, `/api/events`, `/api/rankings` and `/api/live`
  take 1–16 ms; through Cloudflare the same requests took 130–670 ms to the
  first byte. Every HTML page and `/api/*` answer was `CF-Cache-Status:
  DYNAMIC`, so each request crossed to the VPS.
- A reader on a live matchup polls odds and picks every 3 s, scores every 5 s,
  the card and `/api/live` every 15 s: about one request a second. 1,000
  readers is ~1,000 req/s on one 4-vCPU host shared with dev; the last open-loop
  run at 2,000 req/s (2026-09-24) had a 1.8 s p99. Live odds were `no-store`,
  and the public pick summary was `private, no-store` and rebuilt from SQLite on
  the main thread for every poll.
- Clerk's script (84 KB + 46 KB) was `BYPASS` at Cloudflare, every visit, because
  Clerk's CDN sets a cookie for its own domain on it; the major-version
  redirect in front of each script was `no-store` (one more round trip per
  page load).

Change: shared answers carry `Cloudflare-CDN-Cache-Control` (`EDGE` in
`api-policy.ts`), every other response defaults to `no-store`, the pick
summary is kept 2 s and dropped on a save, and Caddy strips the stray cookie
and lets the redirect be kept an hour. With the Cloudflare rule in
`docs/launch.md`, each location asks this server about once per lifetime per
address: for a live bout, a handful of requests a second instead of one per
reader. To be measured after release: `CF-Cache-Status` per route and origin
requests per second on the next card.

## Opening card on "/" (2026-10-26)

On a first visit, "/" asked for the card it opens only after `/api/events`
(802 cards, 128 KB, 25 KB gzip) had arrived and been read: HTML, then the
list, then the card, three round trips one after another. On slow wifi each
is the full network delay. The server now names that card on `<html
data-landing>` (`landingEvent`, shared with the client from
`server/src/landing-event.ts`), and the page's first script asks for it
beside the list: one round trip fewer. Picking it costs ~20 ms on a cold
call, then the page is served from cache. A name gone stale (the page is kept
up to a minute) costs one unused request; the old check after the list still
asks for the right card.

Checked and left alone: the list's fields are all used. Brotli would save
4–20% over gzip on the largest answers (list 25.2 → 23.7 KB, card 23.0 →
19.7 KB, rankings 21.9 → 17.4 KB at quality 9) for 15–20 ms of CPU each and a
second compressed copy in the response cache.

## Fight night without Cloudflare (2026-10-26)

`src/fight-night-load.ts` on dev-pc against a production-shaped server
(2 query workers, `NO_SYNC`, fresh copy of the dev archive each run), pinned to
4 cores, the load on the other 8. Every read reaches the server: the worst
case, as if Cloudflare cached nothing. Each reader polls about once a second;
30% of the readers on the live bout save their card after every bell.

| Readers (arriving over) | Code | Requests/s | p50 | p95 | p99 | Failed |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 (60 s) | develop | 865 | 1.3 ms | 4.7 ms | 9.4 ms | 0 of 155,785 |
| 3,000 (15 s) | develop | 2,123 | 53 ms | 236 ms | 30.4 s | 3,045 (timeouts) |
| 3,000 (15 s) | + pick summary cached 2 s (#295) | 2,939 | 0.6 ms | 5.3 ms | 13 ms | 3 resets* |
| 5,000 (15 s) | + #295 | 4,071 | 1.1 ms | 1.1 s | 9.3 s | 849 (timeouts) |

\* Within 68 ms: Node's client reusing a keep-alive socket the server had just
closed, not a slow answer.

At 3,000 readers on develop, the public pick summary (polled every 3 s,
rebuilt from SQLite on the main thread every time) saturated the API's main
thread and everything queued behind it. Cached for 2 s and dropped on a save
(#295), the same burst is answered in 13 ms p99 and every score save
succeeds. The ceiling without Cloudflare is then 3,000–5,000 readers on four
dev-pc cores; the VPS's cores are about half as fast, so roughly 1,500–2,500
there. With the Cloudflare rule (#295), reads at the edge don't reach the
server at all, so the reader count stops mattering to it.

A profile of the API process at 3,000 readers had it ~50% idle over the run.
`clientAddress` (1.2%) split `TRUSTED_PROXY_IPS` on every call, several times
per request; it now parses the list once and remembers each request's
address. Score saves at 1,500 per 90 s: p99 36 ms.

Not covered: TLS and Caddy in front, the sync process, comments, images
(Cloudflare serves them) and the VPS's own CPU.

Dev builds now wait while a card is live (`deploy/select-dev-branch.sh`,
exit 75; `UFC_DEV_DURING_CARD=1` overrides): a build holds two of the VPS's
four cores for a minute or more.

## Real readers' load times (2026-10-26)

Lighthouse and the load tests are lab numbers. Each visit's first page now
reports how it actually loaded, timed in the reader's browser: first byte,
first paint and largest paint (LCP), sent once as the tab is hidden, with the
network the browser reports (Chromium only). The server adds phone or desktop
from the browser's name and keeps them as `rum_*` rows in the hourly traffic
history, outside the request totals. Admin → Traffic → Load times shows the
median, p75 and p95 for any range, shaded at Google's "needs improvement" and
"poor" lines. Background tabs, admins and automated browsers are left out.

CI also fails when the first load's scripts and styles pass 185 KB gzip
(166 KB today, 29 files).

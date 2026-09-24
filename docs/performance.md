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

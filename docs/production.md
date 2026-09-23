# Production deployment

For the shortest purchase-to-launch path, start with [the launch guide](launch.md).

The supported layout is one host with persistent local storage. The production
supervisor migrates SQLite once, starts the HTTP process and a single scraper
process, and exits if either process fails so the container can restart them.
The HTTP process uses two query workers by default. Each worker holds its own
analytics index; budget memory for those copies and tune `API_WORKERS` from load
measurements (allowed range 0–8). Start with two workers and several GB of RAM.

## Deploy

1. Point the hostname at the server and allow inbound ports 80 and 443.
2. Copy `.env.example` to `.env`, set `DOMAIN`, and generate `ADMIN_TOKEN` with
   `openssl rand -hex 32`. Keep the token out of the client and source control.
3. Run `docker compose build`.
4. Seed the volume with your existing database **before the first startup**:

   ```sh
   node server/src/backup.ts server/data/ufc.db /tmp/ufc-launch.db
   docker compose run --rm --no-deps --user root -v /tmp/ufc-launch.db:/seed/ufc.db:ro app sh -c 'test ! -e /data/ufc.db && cp /seed/ufc.db /data/ufc.db && chown node:node /data/ufc.db'
   ```

   The command refuses to replace an existing database. You can also start with
   an empty volume, but the archive will populate in the background and pages
   will be incomplete until it does. Image files are a disposable cache and can
   be repopulated.
5. Run `docker compose up -d` and inspect `docker compose logs -f app`.
   Caddy provisions HTTPS automatically. Only Caddy publishes a host port.
6. Check `/healthz` and `/readyz`. Readiness waits for every query worker to warm
   its index and record tables. It indicates application readiness, not archive
   completeness or upstream scraper freshness.

The provided network reserves `172.30.86.0/24`. If it conflicts with your host,
change both the subnet/proxy address and `TRUSTED_PROXY_IPS`. Only explicitly
trusted peers may supply `X-Real-IP`, and Caddy overwrites that header. Caddy
currently trusts Cloudflare's published proxy CIDRs for `CF-Connecting-IP`;
update them if Cloudflare changes its published list. Direct origin connections
retain their socket address.

Without Docker, build the client and run `npm run start:production --prefix server`
with an absolute `DATA_DIR`, `ADMIN_TOKEN`, and a reverse proxy providing HTTPS.
Use a service manager to restart the supervisor. `npm start` remains the local
development entry point. `NO_SYNC=1` disables both scheduled and request-triggered
source refreshes, useful for isolated testing. Never run a second scheduler on
the production database. Do not place a WAL database on network storage or share
it between hosts.

## Cache and load behavior

- Public JSON responses and SEO-filled HTML pages share one origin cache,
  128 MiB by default (`RESPONSE_CACHE_MB`). Larger bodies are kept only as gzip,
  so it holds roughly every matchup, fighter and card at once. Identical misses
  share one calculation, including serialization and asynchronous compression.
  Build files are held in memory with their gzip bytes.
- Live/event/matchup/profile responses are fresh for 5 seconds and may serve the
  previous copy for another 5 seconds during refresh. Rankings and statistics
  are fresh for 60 seconds and may serve the previous copy for up to 6 hours
  while one refresh runs behind it, so no reader waits on a cold rebuild.
  Other public responses use 60 + 60 seconds. Sitemap responses use 300 + 300 seconds. Time-based expiry is
  deliberate: scraper writes cannot cause every visitor to miss simultaneously.
- Shared-cache headers allow another 2 seconds for live/detail data and 30 seconds
  for rankings; browsers keep rankings for 60 seconds and may show them for a
  day while revalidating. Filtered analytics require HTTP revalidation. Errors and admin
  responses use `no-store`; public JSON supports ETags and `Vary: Accept-Encoding`.
- Cache bounds also limit arbitrary query combinations. The worker queue is
  capped at 512 waiting jobs (a few hundred milliseconds of work); jobs have a 15-second deadline. Overload returns 503
  with `Retry-After`; per-client request limits return 429.
- Database revisions update transactionally when content changes. Heartbeats,
  queue writes, and unchanged scrape timestamps do not invalidate analytics.
- Query workers enqueue lazy source refreshes in SQLite; the separate sync
  process deduplicates, drains, retries, and recovers them after restart.
- Browser pollers share one timer per URL, pause when hidden/offline, spread
  requests with jitter, and back off after errors. Historical pages stop polling
  when settled. Browser requests have a 20-second deadline.

Caddy compresses static files. A CDN is optional but valuable for JS/CSS, fighter
images, and public APIs. Preserve the full query string in cache keys, honor the
origin cache headers, and never cache `/api/bugs*`, `/api/status`, or `/api/metrics`.
The HTML handler injects route-specific SEO, so do not serve every route as the
same cached HTML document. Keep old hashed client assets available through a
deployment overlap when using a CDN.

## Operations

`GET /api/status`, `/api/metrics`, and `/api/bugs` require
`Authorization: Bearer <ADMIN_TOKEN>` in production. `/bugs` is also protected.
The browser UI does not store the token: use an authenticated administrative
proxy or an API client. Interactive `/admin/bugs` repairs are enabled for
verified Clerk administrators in production, with one repair at a time, a
checked daily SQLite snapshot before the first change, and audit entries in
the app log. Set `DISABLE_REPAIRS=1` in `.env` to pause them.

The optional `observability` Compose profile runs Prometheus, node-exporter and
Grafana on the same host. Grafana binds to host loopback port 3001 and is reached
over SSH. The app's Prometheus endpoint runs on container port 9091 without a
published host port. Keep the Docker bridge private. The dashboard and alert
rules are provisioned from `deploy/observability`; notifications require a
contact point. Logs rotate rather than filling the SQLite disk.

Metrics include cache hits/misses and bytes, queued queries, HTTP failures,
per-route mean/maximum latency, event-loop delay, process memory, and uptime.
Monitor source timestamps and the sync worker heartbeat from `/api/status` as well
as readiness. A healthy HTTP server does not imply the upstream feeds are fresh.

Back up with SQLite's online backup API, not a copy of a live `.db` file without
its WAL. For example:

```sh
docker compose exec app node src/backup.ts /data/ufc.db /data/backups/ufc-2026-09-14.db
```

Use a unique filename each time, schedule this command daily, and copy backups
off the host with your backup service. A backup on the same disk is insufficient.
The command checks integrity and refuses to overwrite an existing backup.
Rehearse restoration into a new volume with the service stopped, then check
record counts, representative pages, and sync freshness before switching over.
Keep a backup before schema upgrades; rolling the application image back alone
does not roll the database schema back.

GitHub Actions runs CI on pull requests and pushes. After a successful CI run
on `main`, it connects through a restricted SSH key and runs
`deploy/update.sh` automatically. That script builds first, takes a backup,
then runs `docker compose up -d --wait`.
Shutdown stops accepting requests and gives active HTTP requests 10 seconds to
drain. The supervisor terminates child processes after 12 seconds if needed.
This single-container layout can have a brief interruption during deployment.

Before claiming a concurrent-user capacity, load-test the target host with warm
and cold caches, varied filters, image misses, and scraping enabled. Track tail
latency, memory, worker restarts, queue depth, 429/503 rates, and cache hits.
5,000 registered or daily users is not the same workload as 5,000 active tabs.

`npm run load:test` replays a weighted page mix (cards, matchups, fighter
pages, previews, images, search, rankings, HTML deep links) from 10,000
simulated visitors. Start the server under test with loopback trusted as its
proxy so each visitor is rate-limited separately:

```sh
TRUSTED_PROXY_IPS=127.0.0.1,::ffff:127.0.0.1,::1 NO_SYNC=1 PORT=8001 API_WORKERS=2 npm start --prefix server
npm run load:test --prefix server -- --url=http://localhost:8001 --rate=4000 --seconds=30 --cold
```

`--rate` is open-loop arrivals per second (10,000 visitors viewing a page every
~20 s at ~8 requests a view is about 4,000/s); omit it for closed-loop maximum
throughput at `--concurrency`. `--cold` spreads requests over ~2,000 distinct
pages of each kind. Reference results on a 10-core laptop with two workers:
4,000/s cold held p50 0.6 ms / p95 2.8 ms, and 8,000/s held p95 2.8 ms / p99
42 ms, with ~0.1% 503s confined to the first second after a restart; warm
closed-loop throughput was ~38,000 requests/s. The whole working set cached in
about 25 MB. Adding workers did not help at these rates and costs ~400 MB each.


## Fan scoring

Configure production Clerk keys and back up `scoring.db` alongside `ufc.db`.
See [fan scoring deployment and capacity](scoring.md#deployment-and-capacity) for
frontend build variables, allowed origins, persistence and concurrency limits.

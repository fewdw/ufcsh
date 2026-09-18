# Production deployment

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
trusted peers may supply `X-Real-IP`, and Caddy overwrites that header. When
adding a CDN, configure verified CDN proxy ranges at Caddy before trusting its
forwarded client addresses; otherwise visitors share the CDN's rate limit.

Without Docker, build the client and run `npm run start:production --prefix server`
with an absolute `DATA_DIR`, `ADMIN_TOKEN`, and a reverse proxy providing HTTPS.
Use a service manager to restart the supervisor. `npm start` remains the local
development entry point. `NO_SYNC=1` disables both scheduled and request-triggered
source refreshes, useful for isolated testing. Never run a second scheduler on
the production database. Do not place a WAL database on network storage or share
it between hosts.

## Cache and load behavior

- Public JSON responses share a 64 MiB / 512-entry origin cache. Identical misses
  share one calculation, including serialization and asynchronous compression.
- Live/event/matchup/profile responses are fresh for 5 seconds and may serve the
  previous copy for another 5 seconds during refresh. Other public responses use
  60 + 60 seconds. Sitemap responses use 300 + 300 seconds. Time-based expiry is
  deliberate: scraper writes cannot cause every visitor to miss simultaneously.
- Shared-cache headers allow another 2 seconds for live/detail data and 30 seconds
  for rankings. Filtered analytics require HTTP revalidation. Errors and admin
  responses use `no-store`; public JSON supports ETags and `Vary: Accept-Encoding`.
- Cache bounds also limit arbitrary query combinations. The worker queue is
  capped at 64 waiting jobs; jobs have a 15-second deadline. Overload returns 503
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
proxy or an API client. Interactive repair actions are disabled in production;
scheduled repairs and the refresh queue continue normally.

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

For updates, build first, take a backup, then run `docker compose up -d`.
Shutdown stops accepting requests and gives active HTTP requests 10 seconds to
drain. The supervisor terminates child processes after 12 seconds if needed.
This single-container layout can have a brief interruption during deployment.

Before claiming a concurrent-user capacity, load-test the target host with warm
and cold caches, varied filters, image misses, and scraping enabled. Track tail
latency, memory, worker restarts, queue depth, 429/503 rates, and cache hits.
5,000 registered or daily users is not the same workload as 5,000 active tabs.


## Fan scoring

Configure production Clerk keys and back up `scoring.db` alongside `ufc.db`.
See [fan scoring deployment and capacity](scoring.md#deployment-and-capacity) for
frontend build variables, allowed origins, persistence and concurrency limits.

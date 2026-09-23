# Cheapest practical launch

This project is a long-running Node API, one scraper process, and two local SQLite
WAL databases. A small always-on host is simpler and cheaper than splitting this
version across serverless compute and a new database. The supported host is
OVHcloud Canada **VPS-2** (4 vCores, 8 GB RAM, 75 GB NVMe). The advertised
C$11.64/month is a *from* price linked to a 12-month upfront selection. Choose
one-month billing if its checkout total fits your C$20 cap. If it does not,
start staging on VPS-1 (2 vCores, 4 GB RAM) and upgrade after a real load test.
The app does not depend on OVHcloud and can move to another Ubuntu host.

The temporary `sslip.io` address is for staging. Clerk development instances
support only 100 users and their users cannot be transferred directly to the
production instance. Clerk's Hobby production plan currently includes 50,000
monthly retained users at no charge. A domain you own, production Clerk keys,
and its DNS setup are necessary before inviting the public to score fights. The 5,000-active-user
goal still requires a load test on the actual server and a CDN for hot public
routes; it is not a guaranteed capacity of one VPS.

## One-time staging launch

1. Create an OVHcloud Canada account and order a VPS-2 with Ubuntu 24.04 in a
   Canadian datacentre. Select one-month billing, record the full checkout price,
   and use VPS-1 for staging if VPS-2 exceeds the cap. Then
   add your SSH public key, and allow inbound TCP 22, 80 and 443. Allow UDP 443
   if you want HTTP/3. Keep 9090, 9091 and 3001 closed publicly. If you do not
   have an SSH key, run `ssh-keygen -t ed25519` on your Mac and paste the contents
   of `~/.ssh/id_ed25519.pub` into OVHcloud during setup.

2. In your local repository, create the private staging config. Use the verified
   email on the Clerk account you want to have permanent `/admin` access:

   ```sh
   export SERVER_IP=YOUR_SERVER_IPV4
   ./deploy/prepare-staging.sh "$SERVER_IP" you@example.com
   ```

   This makes `.env` with unique machine and Grafana passwords and copies any
   local Clerk development keys without printing them. `.env` is ignored by Git.

3. Connect and install Docker from its official Ubuntu apt repository:

   ```sh
   ssh ubuntu@"$SERVER_IP"
   sudo apt-get update
   sudo apt-get install -y git
   git clone https://github.com/fewdw/ufcsh.git
   cd ufcsh
   sudo ./deploy/bootstrap-ubuntu.sh
   exit
   ```

   Reconnect once after bootstrap so the `ubuntu` user receives Docker access.

4. From the local repository, copy the private config and consistent snapshots
   of both local databases. The seed script refuses to overwrite an existing
   production database:

   ```sh
   scp .env ubuntu@"$SERVER_IP":~/ufcsh/.env
   ssh ubuntu@"$SERVER_IP" 'chmod 600 ~/ufcsh/.env'
   ./deploy/seed-remote.sh ubuntu@"$SERVER_IP"
   ```

5. Start everything, including the local monitoring dashboard:

   ```sh
   ssh ubuntu@"$SERVER_IP" 'cd ~/ufcsh && ./deploy/launch.sh'
   ```

   Open `https://SERVER-IP-WITH-DASHES.sslip.io/readyz`. For example,
   `203.0.113.7` becomes `203-0-113-7.sslip.io`. First boot may take a minute
   while Caddy obtains HTTPS and the query workers load their indexes. Run
   `ssh ubuntu@"$SERVER_IP" 'cd ~/ufcsh && docker compose logs --tail=80 app proxy'`
   if readiness fails. An empty or missing Clerk key allows public browsing but
   leaves scoring and admin sign-in unavailable.

## Monitoring and repairs

Grafana is accessible only through an SSH tunnel. On your Mac:

```sh
ssh -L 3001:127.0.0.1:3001 ubuntu@"$SERVER_IP"
```

Open `http://localhost:3001`, sign in as `admin` using
`GRAFANA_ADMIN_PASSWORD` from your private `.env`, and open **UFC production**.
The dashboard shows route traffic, 429/5xx errors, p95 latency, cache hit rate,
query queue, event-loop delay, memory, scraper freshness, CPU and disk space.
Prometheus retains 14 days or 512 MB of metrics, whichever limit comes first.
Prometheus evaluates local alert rules; inspect `ALERTS` in Grafana Explore.
Configure a contact point or an external uptime service for notifications.
Docker logs rotate at 10 MB × 5 files per service.

Install the checked daily SQLite backup timer once on the VPS:

```sh
cd ~/ufcsh
sudo install -m 644 deploy/systemd/ufcsh-backup.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/ufcsh-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ufcsh-backup.timer
sudo systemctl start ufcsh-backup.service
sudo systemctl status ufcsh-backup.timer --no-pager
```

It saves and verifies both databases daily and keeps seven of each in the app
volume. `journalctl -u ufcsh-backup.service -n 30 --no-pager` shows each result.
Set up the off-host R2 copy below before treating these local copies as disaster
recovery.

`/admin/bugs` is available to the permanent Clerk administrator in production.
The first repair of each UTC day takes and checks a SQLite snapshot before it
changes data; three daily repair snapshots remain on the host. Repairs run one
at a time, are rate limited, and produce audit log entries. To pause repairs,
set `DISABLE_REPAIRS=1` in the private `.env` and run `./deploy/update.sh`.

For a one-off repair script in `server/src`, SSH in and run:

```sh
cd ~/ufcsh
./deploy/maintenance.sh src/backfill-mmadecisions-scorecards.ts
```

The script stops the app, backs up both databases, runs the script against the
persistent volume, and restarts the app even if the command fails. Check the
actual script filename before running it. Keep off-host copies of user data;
the VPS and its local backups are one failure domain.

Routine code updates deploy automatically after a successful CI run for a push
or merge to `main`. Use the command below only for manual recovery:

```sh
ssh ubuntu@"$SERVER_IP" 'cd ~/ufcsh && ./deploy/update.sh'
```

It builds while the old app is still serving, backs up both databases, then
replaces containers. A brief interruption remains possible while query workers
warm up. Check `https://YOUR_HOST/readyz` and the Grafana dashboard afterward.

## Production Clerk on the sslip.io address

Clerk production instances expect CNAME records (`clerk.`, `accounts.`, mail),
which sslip.io cannot serve. Caddy therefore proxies Clerk's Frontend API at
`/__clerk`. In the private `.env` set the production `CLERK_PUBLISHABLE_KEY` and
`CLERK_SECRET_KEY`, plus `CLERK_PROXY_URL=https://$DOMAIN/__clerk`, run
`./deploy/update.sh`, then register that URL as the domain's proxy (Clerk
dashboard → Domains → Frontend API, or `PATCH /v1/domains/{id}` with
`proxy_url`). Social sign-in on a production instance needs your own OAuth
credentials in the Clerk dashboard. Remove `CLERK_PROXY_URL` once a real domain
has its DNS records.

After a deploy that adds new photos, generate the tiny and small copies every
picture is served in (`?size=tiny|small`); missing ones are also made on first
request:

```sh
docker compose exec -T app node src/backfill-image-variants.ts
```

## Public launch when you choose a domain

1. Buy an available domain through Cloudflare Registrar, checking the renewal
   price before paying. Add a proxied `A` record to the VPS IPv4 address. In
   Cloudflare, use Full (strict) TLS. Keep a separate SSH path to the server.
2. Use Clerk's `clerk deploy` CLI or dashboard to create the production instance
   on that domain and follow its DNS/OAuth prompts. The staging Clerk keys and
   users are not production keys or users. Decide whether the 12 local test
   scorecards in `scoring.db` should remain as historical public data, be
   migrated by account email, or be removed before changing keys.
3. Edit private `.env` on the VPS: set `DOMAIN` to the new hostname, replace
   `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` with production keys, and leave
   `ADMIN_TOKEN` and `GRAFANA_ADMIN_PASSWORD` private. Rebuild using
   `./deploy/update.sh` so the browser bundle gets the new Clerk key and
   canonical URL.
4. In Cloudflare **Caching → Cache Rules**, create one rule with **Edit
   expression** and the expression below. Set **Eligible for cache**, **Edge
   TTL → Use cache-control header if present, bypass cache if not**, and keep
   the default cache key including the full query string. Leave Browser TTL at
   Respect origin. The rule matches only public GET routes. The app's headers
   set a 2–3 second edge TTL for live data and a long TTL for images/assets.

   ```text
   http.request.method eq "GET" and (
     starts_with(http.request.uri.path, "/assets/") or
     starts_with(http.request.uri.path, "/api/images/") or
     http.request.uri.path eq "/api/live" or
     http.request.uri.path eq "/api/events" or
     http.request.uri.path eq "/api/rankings" or
     starts_with(http.request.uri.path, "/api/events/") or
     starts_with(http.request.uri.path, "/api/fighters/") or
     (starts_with(http.request.uri.path, "/api/fights/") and
       (not (http.request.uri.path contains "/scores") or
        ends_with(http.request.uri.path, "/scores")))
   )
   ```

   The client adds a one-time query key after saving a score so its immediate
   summary read misses an old edge entry. Verify `CF-Cache-Status` becomes `HIT`
   on repeated public GETs and never `HIT` for `/scores/mine` or `/api/admin`.
5. Before inviting 5,000 active users, test the real VPS with score polling,
   score writes, scraping enabled and cache misses. Watch p95/p99 latency,
   request queue, 429/503 rates, host CPU/RAM, and CDN hit ratio. Raise host
   size or change polling if the tested workload fails.

The app's current single SQLite writer and per-process caches make one-host
deployment appropriate. Moving to multiple API replicas would require shared
rate limits and a deliberate database migration. See [production details](production.md).

## Off-host backups after creating Cloudflare

Create a private `ufcsh-backups` R2 bucket using the Standard storage class.
In R2, create a bucket-scoped Object Read & Write API token and record its
Access Key ID, Secret Access Key, and S3 endpoint. On the VPS, install rclone
and run its interactive setup:

```sh
sudo apt-get install -y rclone
rclone version
rclone config
```

Create a remote named `r2`, choose S3 then Cloudflare R2, enter the two keys,
and set the endpoint shown by R2. Check that `rclone version` is at least 1.59;
use the [official installer](https://rclone.org/install/) if Ubuntu supplied
an older version. Add `BACKUP_REMOTE=r2:ufcsh-backups` to the VPS `.env`, then:

```sh
cd ~/ufcsh
./deploy/backup-offsite.sh
rclone lsf r2:ufcsh-backups
```

The script takes checked SQLite snapshots of both databases and uploads them
under a timestamp. In R2, set an object lifecycle rule to delete objects after
30 days to stay within the 10 GB-month Standard free tier at the current roughly
82 MB database size. Install the daily systemd timer:

```sh
sudo install -m 644 deploy/systemd/ufcsh-offsite.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/ufcsh-offsite.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ufcsh-offsite.timer
sudo systemctl start ufcsh-offsite.service
```

Check `journalctl -u ufcsh-offsite.service -n 30 --no-pager` and the bucket after the first scheduled
run. Restore a snapshot by stopping the app, copying both files into the app
volume as `node`, then restarting and checking `/readyz` and representative
scores. Keep the R2 token private and separate from the Git repository.

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo 'Missing private .env.' >&2; exit 2; fi
if [ "$(git branch --show-current)" != main ]; then echo 'Production checkout must be on main.' >&2; exit 2; fi
if [ -n "$(git status --porcelain)" ]; then echo 'Production checkout has uncommitted changes.' >&2; exit 2; fi
if [[ "${UFC_HEAVY_LOCK_HELD:-0}" != 1 ]]; then
  exec ./tools/heavy.sh "$0" "$@"
fi
if [[ "${UFC_UPDATE_PULLED:-0}" != 1 ]]; then
  flock -w 600 /tmp/ufcsh-git-fetch.lock git pull --ff-only origin main
  # Bash keeps reading the file it started; run the pulled one, so a change to
  # this script applies to the release that brings it.
  UFC_UPDATE_PULLED=1 exec "$0" "$@"
fi
./deploy/build.sh app-blue
# The release serving now (app-blue or app-green) keeps serving until the proxy
# routes to the next one, so a deploy never stops the site.
live=$(./deploy/live-app.sh || true)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [ -n "$live" ]; then
  for db in ufc scoring; do
    docker compose exec -T "$live" node src/backup.ts "/data/$db.db" "/data/backups/deploy-$db-$stamp.db"
  done
fi
next=app-blue
if [ "$live" = app-blue ]; then next=app-green; fi
abort() {
  docker compose stop "$next"
  echo "$1; ${live:-the previous release} is still serving." >&2
  exit 1
}
# Never recreate the proxy here: that drops every connection and stops the site
# for seconds. A change to its Compose definition waits for a quiet moment.
docker compose up -d --no-build --no-recreate proxy
if [ "$(docker compose config --hash proxy | cut -d' ' -f2)" != \
  "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$(docker compose ps -q proxy)")" ]; then
  echo 'The proxy definition in compose.yaml changed and is not applied yet; run docker compose up -d proxy when a few seconds offline are acceptable.' >&2
fi
proxy() { docker compose exec -T proxy "$@"; }
# The proxy must route to both releases before either changes.
routes=$(proxy caddy adapt --config /dev/stdin --adapter caddyfile < deploy/Caddyfile) \
  || { echo 'deploy/Caddyfile is invalid; nothing changed.' >&2; exit 1; }
for service in app-blue app-green; do
  grep -q "\"dial\":\"$service:8000\"" <<< "$routes" \
    || { echo "deploy/Caddyfile does not route to $service; nothing changed." >&2; exit 1; }
done
# The next release migrates /data and warms up beside the live one. If it never
# becomes ready it is stopped and the live one carries on.
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 "$next" \
  || abort "$next did not become ready"
# The mounted Caddyfile keeps the content the proxy started with (a pull
# replaces the file), so load the current one. Caddy keeps its running config if
# it rejects the new one.
proxy caddy reload --config /dev/stdin --adapter caddyfile < deploy/Caddyfile \
  || abort 'The proxy did not load deploy/Caddyfile'
# Hand over only once the proxy's running config routes to the next release and
# the proxy reaches its /readyz, as its health check does every second.
running=$(proxy wget -qO- http://127.0.0.1:2019/config/) || running=
grep -q "\"dial\":\"$next:8000\"" <<< "$running" \
  || abort "The proxy's running config does not route to $next"
proxy wget -qO /dev/null "http://$next:8000/readyz" \
  || abort "The proxy cannot reach $next"
sleep 3
# The old release fails /readyz for SHUTDOWN_DRAIN_MS while it still answers, so
# the proxy stops sending it requests, then it finishes the active ones. It is
# kept for a rollback: start it, then stop the new one.
if [ -n "$live" ]; then docker compose stop "$live"; fi
domain=$(proxy printenv DOMAIN)
if ! curl -fsSk -o /dev/null --max-time 15 --retry 3 --retry-all-errors --resolve "$domain:443:127.0.0.1" "https://$domain/readyz"; then
  echo "The site did not answer through the proxy after the handover; restarting ${live:-nothing}." >&2
  if [ -n "$live" ]; then docker compose start "$live"; fi
  exit 1
fi
docker compose --profile observability up -d --no-build --wait --wait-timeout 180 prometheus node-exporter grafana
# Prometheus keeps its scrape targets and alert rules until told to reload them.
docker compose --profile observability kill -s SIGHUP prometheus
docker compose --profile observability ps

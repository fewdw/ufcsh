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
# The release serving now (app-blue or app-green) keeps serving until the next
# one is ready, so a deploy never stops the site.
live=$(./deploy/live-app.sh || true)
# Before blue/green, production ran as the single Compose service "app".
legacy=$(docker ps -q --filter "label=com.docker.compose.project.working_dir=$PWD" --filter label=com.docker.compose.service=app)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for db in ufc scoring; do
  if [ -n "$live" ]; then
    docker compose exec -T "$live" node src/backup.ts "/data/$db.db" "/data/backups/deploy-$db-$stamp.db"
  elif [ -n "$legacy" ]; then
    docker exec "$legacy" node src/backup.ts "/data/$db.db" "/data/backups/deploy-$db-$stamp.db"
  fi
done
next=app-blue
if [ "$live" = app-blue ]; then next=app-green; fi
# The next release migrates /data and warms up beside the live one. If it never
# becomes ready it is stopped and the live one carries on.
if ! docker compose up -d --no-build --no-deps --wait --wait-timeout 180 "$next"; then
  docker compose stop "$next"
  echo "$next did not become ready; ${live:-the previous release} is still serving." >&2
  exit 1
fi
docker compose --profile observability up -d --no-build --wait --wait-timeout 180 proxy prometheus node-exporter grafana
# Caddy checks /readyz every second; let it send requests to the new release
# before the old one drains (SHUTDOWN_DRAIN_MS) and stops. The stopped release
# is kept for a rollback: start it, then stop the new one.
sleep 3
if [ -n "$live" ]; then docker compose stop "$live"; fi
if [ -n "$legacy" ]; then docker stop -t 20 $legacy >/dev/null && docker rm $legacy >/dev/null; fi
docker compose --profile observability ps

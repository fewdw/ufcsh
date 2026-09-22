#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -ne 1 ] || [[ ! "$1" =~ ^src/[A-Za-z0-9_./-]+\.ts$ ]]; then
  echo "Usage: ./deploy/maintenance.sh src/your-repair-script.ts" >&2
  exit 2
fi
script=$1
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose stop app
trap 'docker compose up -d --no-deps app' EXIT
docker compose run --rm --no-deps app node src/backup.ts /data/ufc.db "/data/backups/maintenance-ufc-$stamp.db"
docker compose run --rm --no-deps app node src/backup.ts /data/scoring.db "/data/backups/maintenance-scoring-$stamp.db"
docker compose run --rm --no-deps app node "$script"
echo "Repair completed. Backups are in the persistent volume under /data/backups/ with stamp $stamp."

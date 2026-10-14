#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date -u +%Y%m%dT%H%M%SZ)
app=$(./deploy/live-app.sh)
docker compose exec -T "$app" node src/backup.ts /data/ufc.db "/data/backups/daily-ufc-$stamp.db"
docker compose exec -T "$app" node src/backup.ts /data/scoring.db "/data/backups/daily-scoring-$stamp.db"
# Old copies are thinned to a fixed history (server/src/backup-retention.ts).
docker compose exec -T "$app" node src/backup-retention.ts /data
echo "Checked daily SQLite backups saved in the app data volume ($stamp)."
./deploy/housekeeping.sh

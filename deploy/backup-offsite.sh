#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v rclone >/dev/null; then echo 'Install rclone first.' >&2; exit 2; fi
remote=$(sed -n 's/^BACKUP_REMOTE=//p' .env | tail -n 1)
if [ -z "$remote" ]; then echo 'Set BACKUP_REMOTE in private .env.' >&2; exit 2; fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary=$(mktemp -d)
trap 'find "$temporary" -mindepth 1 -maxdepth 1 -type f -delete; rmdir "$temporary"' EXIT
docker compose exec -T app node src/backup.ts /data/ufc.db "/data/backups/offsite-ufc-$stamp.db"
docker compose exec -T app node src/backup.ts /data/scoring.db "/data/backups/offsite-scoring-$stamp.db"
docker compose cp "app:/data/backups/offsite-ufc-$stamp.db" "$temporary/ufc.db"
docker compose cp "app:/data/backups/offsite-scoring-$stamp.db" "$temporary/scoring.db"
rclone copy "$temporary" "${remote%/}/$stamp" --immutable
docker compose exec -T app rm "/data/backups/offsite-ufc-$stamp.db" "/data/backups/offsite-scoring-$stamp.db"
echo "Uploaded both checked SQLite snapshots to ${remote%/}/$stamp"

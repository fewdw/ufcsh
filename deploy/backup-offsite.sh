#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# History kept off-site: the newest DAILY snapshots, plus the first of each of
# the last MONTHLY months, so a problem found weeks later still has a clean
# copy from before it. Compressed, a snapshot is about 15 MB (ufc.db 108 MB at
# zstd -12), so this is under 0.5 GB; BUDGET_BYTES still drops the oldest if the
# databases ever grow enough to approach R2's 10 GB free tier.
DAILY=14
MONTHLY=12
BUDGET_BYTES=$((8 * 1024 * 1024 * 1024))

# Snapshot names (UTC stamps, oldest first) on stdin; prints the ones to delete.
stale() {
  local all
  all=$(grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort)
  [ -n "$all" ] || return 0
  local keep
  keep=$( { tail -n "$DAILY" <<<"$all"; awk '!seen[substr($0, 1, 6)]++' <<<"$all" | tail -n "$MONTHLY"; } | sort -u)
  comm -23 <(cat <<<"$all") <(cat <<<"$keep")
}
# `backup-offsite.sh --plan < names` shows what retention would delete.
if [ "${1:-}" = --plan ]; then stale; exit 0; fi

if ! command -v rclone >/dev/null; then echo 'Install rclone first.' >&2; exit 2; fi
if ! command -v zstd >/dev/null; then echo 'Install zstd first.' >&2; exit 2; fi
remote=$(sed -n 's/^BACKUP_REMOTE=//p' .env | tail -n 1)
if [ -z "$remote" ]; then echo 'Set BACKUP_REMOTE in private .env.' >&2; exit 2; fi
remote=${remote%/}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
app=$(./deploy/live-app.sh)
temporary=$(mktemp -d)
cleanup() {
  rm -rf -- "$temporary"
  docker compose exec -T "$app" rm -f "/data/backups/offsite-ufc-$stamp.db" "/data/backups/offsite-scoring-$stamp.db" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose exec -T "$app" node src/backup.ts /data/ufc.db "/data/backups/offsite-ufc-$stamp.db"
docker compose exec -T "$app" node src/backup.ts /data/scoring.db "/data/backups/offsite-scoring-$stamp.db"
docker compose cp "$app:/data/backups/offsite-ufc-$stamp.db" "$temporary/ufc.db"
docker compose cp "$app:/data/backups/offsite-scoring-$stamp.db" "$temporary/scoring.db"
zstd -q --rm -T0 -12 "$temporary/ufc.db" "$temporary/scoring.db"
rclone copy "$temporary" "$remote/$stamp" --immutable
echo "Uploaded both checked SQLite snapshots to $remote/$stamp"

# Retention runs only after a successful upload, so it never leaves fewer
# snapshots than were there before this one.
for name in $(rclone lsf --dirs-only "$remote" | sed 's:/$::' | stale); do
  rclone delete "$remote/$name" --rmdirs
  echo "Removed $name (retention)"
done
while :; do
  names=$(rclone lsf --dirs-only "$remote" | sed 's:/$::' | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort)
  bytes=$(rclone size --json "$remote" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  [ "$bytes" -gt "$BUDGET_BYTES" ] && [ "$(wc -l <<<"$names")" -gt 1 ] || break
  rclone delete "$remote/$(head -n 1 <<<"$names")" --rmdirs
  echo "Removed $(head -n 1 <<<"$names") (over the ${BUDGET_BYTES}-byte budget)"
done
echo "Off-site: $(wc -l <<<"$names") snapshots, $((bytes / 1048576)) MB"

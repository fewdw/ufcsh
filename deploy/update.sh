#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo 'Missing private .env.' >&2; exit 2; fi
if [ "$(git branch --show-current)" != main ]; then echo 'Production checkout must be on main.' >&2; exit 2; fi
if [ -n "$(git status --porcelain)" ]; then echo 'Production checkout has uncommitted changes.' >&2; exit 2; fi
git pull --ff-only origin main
docker compose build app
if [ -n "$(docker compose ps -q app)" ]; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  docker compose exec -T app node src/backup.ts /data/ufc.db "/data/backups/deploy-ufc-$stamp.db"
  docker compose exec -T app node src/backup.ts /data/scoring.db "/data/backups/deploy-scoring-$stamp.db"
fi
docker compose --profile observability up -d --wait --wait-timeout 180
docker compose --profile observability ps

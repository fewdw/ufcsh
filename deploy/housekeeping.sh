#!/usr/bin/env bash
# Keeps the host's Docker storage bounded; backup-local.sh runs it every day.
# Database copies are thinned by the app itself (server/src/backup-retention.ts).
set -euo pipefail
cd "$(dirname "$0")/.."

# Each dev review builds an image. Keep the one dev runs and the two newest.
running=$(docker inspect --format '{{.Image}}' ufcsh-app-dev-1 2>/dev/null || true)
docker image ls ufcsh-dev --no-trunc --format '{{.ID}} {{.Repository}}:{{.Tag}}' | tail -n +3 |
  while read -r id name; do
    # An image a stopped container still uses is refused and kept.
    [ "$id" = "$running" ] || docker image rm "$name" >/dev/null 2>&1 || true
  done
# Untagged leftovers of earlier builds. Images of stopped containers, such as
# the previous release kept for a rollback, are not touched.
docker image prune -f >/dev/null
# Build cache speeds up rebuilds; a few GB is plenty. Builds use the bounded
# builder; anything left in Docker's own builder is from before it existed.
docker buildx prune --builder "${UFC_BUILD_BUILDER:-ufcsh-bounded}" --max-used-space 4gb -f >/dev/null 2>&1 || true
docker builder prune --max-used-space 512mb -f >/dev/null 2>&1 || true
docker system df

#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo "Usage: ./deploy/seed-remote.sh SSH_TARGET" >&2
  exit 2
fi
target=$1
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
node server/src/backup.ts server/data/ufc.db "$temporary/ufc.db"
node server/src/backup.ts server/data/scoring.db "$temporary/scoring.db"
ssh "$target" 'mkdir -p ~/ufcsh/seed && chmod 700 ~/ufcsh/seed'
scp "$temporary/ufc.db" "$temporary/scoring.db" "$target:ufcsh/seed/"
ssh "$target" 'cd ~/ufcsh && docker compose run --rm --no-deps --user root -v "$PWD/seed:/seed:ro" app sh -c '\''test ! -e /data/ufc.db && test ! -e /data/scoring.db && cp /seed/ufc.db /data/ufc.db && cp /seed/scoring.db /data/scoring.db && chown node:node /data/ufc.db /data/scoring.db'\'' && rm -f seed/ufc.db seed/scoring.db'
echo 'Both databases copied into the persistent Docker volume.'

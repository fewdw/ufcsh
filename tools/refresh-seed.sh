#!/usr/bin/env bash
# Refreshes the local preview seed from the dev.ufc.sh volume (development data only).
#   ./tools/refresh-seed.sh            pull fresh ufc.db, scoring.db, and images
#   ./tools/refresh-seed.sh install    also run it nightly (user systemd timer)
# New previews copy the seed on first start; `./start reseed` re-copies it.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
seed="${TS_SEED_DIR:-$HOME/.local/share/ufcsh/dev-seed}"
vps="${SEED_HOST:-ufcsh-vps}"
container=ufcsh-app-dev-1
volume=/var/lib/docker/volumes/ufcsh_app-dev-data/_data

if [[ ${1:-} == install ]]; then
  # The timer runs the main clone's copy, which tools/merge.sh keeps on develop.
  clone="$(dirname -- "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")"
  units="$HOME/.config/systemd/user"
  mkdir -p "$units"
  printf '%s\n' '[Unit]' 'Description=Refresh the UFC.sh preview seed from dev' '[Service]' 'Type=oneshot' \
    "ExecStart=$clone/tools/refresh-seed.sh" > "$units/ufcsh-seed-refresh.service"
  printf '%s\n' '[Unit]' 'Description=Nightly UFC.sh preview seed refresh' '[Timer]' 'OnCalendar=*-*-* 05:30' \
    'RandomizedDelaySec=15m' 'Persistent=true' '[Install]' 'WantedBy=timers.target' > "$units/ufcsh-seed-refresh.timer"
  systemctl --user daemon-reload
  systemctl --user enable --now ufcsh-seed-refresh.timer
  systemctl --user list-timers ufcsh-seed-refresh.timer --no-pager
  exit
fi
[[ -z ${1:-} ]] || { echo 'Usage: ./tools/refresh-seed.sh [install]' >&2; exit 2; }

# One refresh at a time.
exec 8>"$seed.lock"
flock -n 8 || { echo 'A seed refresh is already running.' >&2; exit 1; }

next="$seed.next"
rm -rf "$next"
mkdir -p "$next"
chmod 700 "$next"
# Start from hard links to the current images so rsync only transfers changes;
# rsync replaces changed files by rename, so the old seed's files stay intact.
[[ -d $seed/images ]] && cp -al "$seed/images" "$next/images"

stamp="seed-$(date -u +%Y%m%dT%H%M%SZ)-$$"
for db in ufc scoring; do
  # SQLite's backup API inside the dev container gives a consistent, checked copy.
  ssh "$vps" "set -o pipefail; docker exec $container node src/backup.ts /data/$db.db /data/backups/$stamp-$db.db >/dev/null \
    && docker exec $container cat /data/backups/$stamp-$db.db | zstd -q -3 -T0 -c; \
    status=\$?; docker exec $container sh -c 'rm -f /data/backups/$stamp-$db.db*'; exit \$status" \
    | zstd -q -d -c > "$next/$db.db"
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const { quick_check } = db.prepare("PRAGMA quick_check").get();
    const { tables } = db.prepare("SELECT count(*) AS tables FROM sqlite_master WHERE type = ?").get("table");
    if (quick_check !== "ok" || !tables) { console.error(`${process.argv[1]}: ${quick_check}, ${tables} tables`); process.exit(1); }
  ' "$next/$db.db"
done
chmod 600 "$next"/*.db

rsync -a --delete --chmod=D700,F600 --rsync-path='sudo -n rsync' "$vps:$volume/images/" "$next/images/"

# Swap while no preview is copying the seed (./start holds the same lock).
exec 9>/tmp/ufcsh-start.lock
flock -w 600 9
rm -rf "$seed.old"
[[ ! -e $seed ]] || mv "$seed" "$seed.old"
mv "$next" "$seed"
flock -u 9
rm -rf "$seed.old"
echo "Seed refreshed from dev: $(du -sh "$seed" | cut -f1) in $seed"

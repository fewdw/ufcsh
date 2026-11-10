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
ssh_options=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=4)

if [[ ${1:-} == install ]]; then
  # The timer runs the main clone's copy, which tools/merge.sh keeps on develop.
  clone="$(dirname -- "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")"
  [[ -x $clone/tools/refresh-seed.sh ]] || { echo "Run install after this script reaches $clone." >&2; exit 1; }
  units="$HOME/.config/systemd/user"
  mkdir -p "$units"
  # The user manager may start without the login PATH (node lives in ~/.local/bin).
  printf '%s\n' '[Unit]' 'Description=Refresh the UFC.sh preview seed from dev' '[Service]' 'Type=oneshot' \
    "Environment=PATH=$PATH" 'TimeoutStartSec=1h' "ExecStart=$clone/tools/refresh-seed.sh" \
    > "$units/ufcsh-seed-refresh.service"
  printf '%s\n' '[Unit]' 'Description=Nightly UFC.sh preview seed refresh' '[Timer]' 'OnCalendar=*-*-* 05:30' \
    'RandomizedDelaySec=15m' 'Persistent=true' '[Install]' 'WantedBy=timers.target' > "$units/ufcsh-seed-refresh.timer"
  systemctl --user daemon-reload
  systemctl --user enable --now ufcsh-seed-refresh.timer
  systemctl --user list-timers ufcsh-seed-refresh.timer --no-pager
  exit
fi
[[ -z ${1:-} ]] || { echo 'Usage: ./tools/refresh-seed.sh [install]' >&2; exit 2; }

# One refresh at a time.
mkdir -p "$(dirname -- "$seed")"
exec 8>"$seed.lock"
flock -n 8 || { echo 'A seed refresh is already running.' >&2; exit 1; }

next="$seed.next"
trap 'rm -rf "$next"' EXIT
rm -rf "$next"
mkdir -p "$next"
chmod 700 "$next"
# Start from hard links to the current images so rsync only transfers changes;
# rsync replaces changed files by rename, so the old seed's files stay intact.
[[ -d $seed/images ]] && cp -al "$seed/images" "$next/images"

for db in ufc scoring; do
  # SQLite's backup API inside the dev container gives a consistent, checked copy.
  # It goes to the container's /tmp (never the dev data volume) and is removed on
  # exit, along with any copy an interrupted earlier refresh left behind.
  ssh "${ssh_options[@]}" "$vps" bash -s -- "$container" "$db" <<'REMOTE' | zstd -q -d -c > "$next/$db.db"
set -euo pipefail
container=$1 copy=/tmp/ufcsh-seed-$2.db
clean() { docker exec "$container" sh -c 'rm -f /tmp/ufcsh-seed-*' || true; }
trap clean EXIT; trap 'exit 1' HUP INT TERM
clean
docker exec "$container" node src/backup.ts "/data/$2.db" "$copy" >/dev/null
docker exec "$container" cat "$copy" | zstd -q -3 -T0 -c
REMOTE
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    const { quick_check } = db.prepare("PRAGMA quick_check").get();
    const { tables } = db.prepare("SELECT count(*) AS tables FROM sqlite_master WHERE type = ?").get("table");
    db.close();
    if (quick_check !== "ok" || !tables) { console.error(`${process.argv[1]}: ${quick_check}, ${tables} tables`); process.exit(1); }
  ' "$next/$db.db"
done
chmod 600 "$next"/*.db

# Exit 24 only means dev replaced a photo mid-transfer; the next refresh picks it up.
rsync -a --delete --chmod=D700,F600 -e "ssh ${ssh_options[*]}" --rsync-path='sudo -n rsync' \
  "$vps:$volume/images/" "$next/images/" || [[ $? -eq 24 ]]

# Swap while no preview is copying the seed (./start holds the same lock).
exec 9>/tmp/ufcsh-start.lock
flock -w 600 9
rm -rf "$seed.old"
[[ ! -e $seed ]] || mv "$seed" "$seed.old"
mv "$next" "$seed"
flock -u 9
rm -rf "$seed.old"
echo "Seed refreshed from dev: $(du -sh "$seed" | cut -f1) in $seed"

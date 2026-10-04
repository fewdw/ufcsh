#!/usr/bin/env bash
set -euo pipefail
[[ $# -gt 0 ]] || { echo 'Usage: tools/heavy.sh COMMAND [ARGS...]' >&2; exit 2; }
if [[ "${UFC_HEAVY_LOCK_HELD:-0}" == 1 ]]; then exec "$@"; fi
exec 8>"${UFC_HEAVY_LOCK:-/tmp/ufcsh-heavy.lock}"
if ! flock -n 8; then
  echo 'Another heavy job is running; waiting for the shared slot.' >&2
  flock -w "${UFC_HEAVY_WAIT_SECONDS:-600}" 8
fi
# Keep breathing room for production. This is admission control, not a RAM cap.
minimum_kb="${UFC_HEAVY_MIN_AVAILABLE_KB:-2621440}"
[[ "$minimum_kb" =~ ^[0-9]+$ ]] || exit 2
deadline=$((SECONDS + ${UFC_HEAVY_WAIT_SECONDS:-600}))
announced=0
while [[ "$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)" -lt "$minimum_kb" ]]; do
  if [[ "$announced" == 0 ]]; then
    echo 'Waiting for memory headroom before starting heavy work.' >&2
    announced=1
  fi
  (( SECONDS < deadline )) || { echo 'Insufficient memory; close idle sessions or retry later.' >&2; exit 1; }
  sleep 2
done
export UFC_HEAVY_LOCK_HELD=1
# A scope caps the command and its descendants, unlike NODE_OPTIONS.
# Docker builds have their own bounded builder because the daemon is outside it.
if systemctl --user show-environment >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet -p "MemoryMax=${UFC_HEAVY_MEMORY_MAX:-2G}" -p MemorySwapMax=512M -- "$@"
fi
echo 'User systemd is unavailable; heavy work is serialized but has no process memory cap.' >&2
exec "$@"

#!/usr/bin/env bash
set -euo pipefail
[[ $# -gt 0 ]] || { echo 'Usage: tools/agent-session.sh AGENT_COMMAND [ARGS...]' >&2; exit 2; }
if [[ "${UFC_AGENT_SCOPE:-0}" == 1 ]]; then
  systemctl --user set-property --runtime ufcsh-agents.slice \
    "MemoryHigh=${UFC_AGENTS_MEMORY_HIGH:-1536M}" "MemoryMax=${UFC_AGENTS_MEMORY_MAX:-2G}" MemorySwapMax=512M
  exec "$@"
fi
state_dir="${UFC_AGENT_STATE_DIR:-$HOME/.local/state/ufcsh/agent-slots}"
slots="${UFC_AGENT_SLOTS:-3}"
[[ "$slots" =~ ^[1-9][0-9]*$ ]] || exit 2
umask 077
mkdir -p "$state_dir"
announced=0
while true; do
  for ((slot=1; slot<=slots; slot++)); do
    exec {slot_fd}>"$state_dir/$slot.lock"
    if flock -n "$slot_fd"; then break 2; fi
    exec {slot_fd}>&-
  done
  if [[ "$announced" == 0 ]]; then
    echo "All $slots agent slots are occupied; waiting before starting another session." >&2
    announced=1
  fi
  sleep 2
done
if systemctl --user show-environment >/dev/null 2>&1; then
  export UFC_AGENT_SCOPE=1
  exec systemd-run --user --scope --quiet --slice=ufcsh-agents.slice -- "$0" "$@"
fi
echo 'User systemd is unavailable; session count is limited but memory is not capped.' >&2
exec "$@"

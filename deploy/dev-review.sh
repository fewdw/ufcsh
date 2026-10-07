#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
state_dir="${UFC_REVIEW_STATE_DIR:-$HOME/.local/state/ufcsh/dev-review}"
umask 077
mkdir -p "$state_dir"
# Every chat and the manual GitHub Action use the same lock and state.
exec 9>"${UFC_DEV_LOCK:-/tmp/ufcsh-development-deploy.lock}"
flock -w 600 9
export UFC_DEV_LOCK_HELD=1 UFC_REVIEW_STATE_DIR="$state_dir"
# The GitHub deploy arrives over SSH without a login shell, so ~/.profile never
# puts the user-installed Node on PATH.
export PATH="$HOME/.local/bin:$PATH"
exec node "$script_dir/dev-review.ts" "$@"

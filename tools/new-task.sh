#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 && "$1" =~ ^(feat|bug|perf|chore)/[a-z0-9][a-z0-9-]*$ ]] || {
  echo 'Usage: ./tools/new-task.sh CATEGORY/task-name (feat, bug, perf, chore)' >&2
  exit 2
}
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)"
clone="$(dirname -- "$common")"
target="$(dirname -- "$clone")/ufcsh-wt/${1#*/}"
flock -w 600 "${UFC_GIT_LOCK:-/tmp/ufcsh-git-fetch.lock}" git -C "$repo" fetch origin
git -C "$repo" worktree add "$target" -b "$1" origin/main
printf 'Task worktree: %s\nRun ./start ts there after building the feature.\n' "$target"

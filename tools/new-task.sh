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
flock -w 600 "${UFC_GIT_LOCK:-/tmp/ufcsh-git-fetch.lock}" git -C "$repo" fetch --prune origin
git -C "$repo" worktree add "$target" -b "$1" origin/develop
printf 'Task worktree: %s\n' "$target"
# A pushed branch deleted on origin was merged or dropped; its worktree (with
# dependencies and preview data, ~1 GB) is only taking space.
git -C "$repo" for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads |
  awk '$2 == "[gone]" { print $1 }' | while read -r branch; do
    path="$(git -C "$repo" worktree list --porcelain | awk -v ref="branch refs/heads/$branch" '/^worktree /{w=substr($0,10)} $0==ref{print w}')"
    if [[ -n $path ]]; then
      printf 'Finished task still on disk (%s): %s; run ./start stop there, then git worktree remove it\n' "$(du -sh "$path" | cut -f1)" "$path"
    fi
  done

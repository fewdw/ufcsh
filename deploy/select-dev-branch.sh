#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
dev_dir="$(dirname "$repo_dir")/ufcsh-dev"
branch="${1:?Usage: select-dev-branch.sh BRANCH}"

if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
  echo 'Invalid branch name.' >&2
  exit 2
fi
if [[ "$(git -C "$repo_dir" branch --show-current)" != main ]]; then
  echo 'The production checkout must stay on main.' >&2
  exit 2
fi

git -C "$repo_dir" fetch origin --prune
remote_ref="refs/remotes/origin/$branch"
if ! git -C "$repo_dir" show-ref --verify --quiet "$remote_ref"; then
  echo "No pushed branch named $branch exists on origin." >&2
  exit 2
fi

if [[ ! -e "$dev_dir/.git" ]]; then
  if [[ -e "$dev_dir" ]]; then
    echo "$dev_dir exists but is not a Git worktree." >&2
    exit 2
  fi
  git -C "$repo_dir" worktree add --detach "$dev_dir" origin/main
fi

if [[ "$(realpath "$(git -C "$dev_dir" rev-parse --git-common-dir)")" != "$(realpath "$repo_dir/.git")" ]]; then
  echo "$dev_dir belongs to another repository." >&2
  exit 2
fi
if [[ -n "$(git -C "$dev_dir" status --porcelain)" ]]; then
  echo "The dev worktree has uncommitted changes. Commit or stash them before switching branches." >&2
  exit 2
fi

# Dev only shows what was pushed, detached, so the branch itself stays free
# for the task's own worktree to have checked out.
git -C "$dev_dir" switch --detach "origin/$branch"

echo "Showing $branch ($(git -C "$dev_dir" rev-parse --short HEAD)) at https://dev.ufc.sh"
DEV_BUILD_CONTEXT="$dev_dir" "$repo_dir/dev.sh"

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="${UFC_PRODUCTION_DIR:-/home/ubuntu/ufcsh}"
dev_dir="${UFC_DEV_DIR:-$(dirname "$repo_dir")/ufcsh-dev}"
branch="${1:?Usage: select-dev-branch.sh BRANCH [SHA]}"
requested_sha="${2:-}"
if [[ -n "$requested_sha" && ! "$requested_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Invalid commit SHA.' >&2
  exit 2
fi
if [[ "${UFC_DEV_LOCK_HELD:-0}" != 1 ]]; then
  exec env UFC_DEV_LOCK_HELD=1 flock -w 600 "${UFC_DEV_LOCK:-/tmp/ufcsh-development-deploy.lock}" "$0" "$@"
fi

if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
  echo 'Invalid branch name.' >&2
  exit 2
fi
if [[ "$(git -C "$repo_dir" branch --show-current)" != main ]]; then
  echo 'The production checkout must stay on main.' >&2
  exit 2
fi

flock -w 600 "${UFC_GIT_LOCK:-/tmp/ufcsh-git-fetch.lock}" git -C "$repo_dir" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
remote_ref="refs/remotes/origin/$branch"
if ! git -C "$repo_dir" show-ref --verify --quiet "$remote_ref"; then
  echo "No pushed branch named $branch exists on origin." >&2
  exit 2
fi
sha="$requested_sha"
if [[ -z "$sha" ]]; then sha="$(git -C "$repo_dir" rev-parse "$remote_ref")"; fi
if ! git -C "$repo_dir" merge-base --is-ancestor "$sha" "$remote_ref"; then
  echo 'The requested commit is not on the pushed branch.' >&2
  exit 2
fi
# Check the image's baked revision as well as the container's requested labels.
dev_info() {
  local container image revision
  container="$(docker inspect --format '{{index .Config.Labels "sh.ufc.dev.branch"}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' ufcsh-app-dev-1 2>/dev/null || true)"
  image="$(docker inspect --format '{{.Image}}' ufcsh-app-dev-1 2>/dev/null || true)"
  revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null || true)"
  echo "$container $revision"
}
running="$(dev_info)"
if [[ "$running" == "$branch $sha healthy $sha" ]]; then
  echo "Already healthy at https://dev.ufc.sh: $branch $sha"
  exit 0
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
git -C "$dev_dir" switch --detach "$sha"

DEV_BUILD_CONTEXT="$dev_dir" DEV_BRANCH="$branch" DEV_SHA="$sha" \
  DEV_ENV_FILE="$repo_dir/.env.dev" "$script_dir/../dev.sh"
running="$(dev_info)"
if [[ "$running" != "$branch $sha healthy $sha" ]]; then
  echo 'Dev is not healthy on the requested commit.' >&2
  exit 1
fi
echo "Ready at https://dev.ufc.sh: $branch $sha"

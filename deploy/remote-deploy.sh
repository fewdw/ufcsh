#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
request="${SSH_ORIGINAL_COMMAND:-}"

if [[ "$request" =~ ^prod[[:space:]]([0-9a-f]{40})$ ]]; then
  requested_sha="${BASH_REMATCH[1]}"
  exec 9>/tmp/ufcsh-production-deploy.lock
  flock -w 600 9
  git -C "$repo_dir" fetch origin main
  current_sha="$(git -C "$repo_dir" rev-parse refs/remotes/origin/main)"
  if [[ "$requested_sha" != "$current_sha" ]]; then
    echo "Skipping superseded push $requested_sha; current main is $current_sha."
    exit 0
  fi
  "$repo_dir/deploy/update.sh"
elif [[ "$request" =~ ^dev[[:space:]]([^[:space:]]+)$ ]]; then
  branch="${BASH_REMATCH[1]}"
  exec 9>/tmp/ufcsh-development-deploy.lock
  flock -w 600 9
  "$repo_dir/deploy/select-dev-branch.sh" "$branch"
else
  echo 'Only production main deployments and dev branch selection are allowed.' >&2
  exit 2
fi

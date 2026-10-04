#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
request="${SSH_ORIGINAL_COMMAND:-}"

if [[ "$request" =~ ^prod[[:space:]]([0-9a-f]{40})$ ]]; then
  requested_sha="${BASH_REMATCH[1]}"
  exec 9>/tmp/ufcsh-production-deploy.lock
  flock -w 600 9
  flock -w 600 /tmp/ufcsh-git-fetch.lock git -C "$repo_dir" fetch origin main
  current_sha="$(git -C "$repo_dir" rev-parse refs/remotes/origin/main)"
  if [[ "$requested_sha" != "$current_sha" ]]; then
    echo "Skipping superseded push $requested_sha; current main is $current_sha."
    exit 0
  fi
  "$repo_dir/deploy/update.sh"
  # Only the merged owner advances the review queue; other releases leave dev alone.
  if ! "$repo_dir/deploy/dev-review.sh" merged "$requested_sha"; then
    echo 'Production deployment completed; queued dev deployment needs attention. Check dev-review.sh status.' >&2
  fi
elif [[ "$request" =~ ^dev[[:space:]]([^[:space:]]+)[[:space:]]([0-9a-f]{40})$ ]]; then
  branch="${BASH_REMATCH[1]}"
  sha="${BASH_REMATCH[2]}"
  "$repo_dir/deploy/dev-review.sh" priority "$branch" "$sha"
else
  echo 'Only prod SHA and explicit dev BRANCH SHA requests are allowed. Update old branches to the current workflow.' >&2
  exit 2
fi

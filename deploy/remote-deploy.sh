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
  # A busy card can leave too little memory for tools/heavy.sh with dev running,
  # and the release then fails after ten minutes. Production outranks dev, which
  # gives its memory back for the release. The memory check itself stays as it is.
  dev_app=ufcsh-app-dev-1
  dev_stopped=0
  available_kb="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
  if (( available_kb < ${UFC_HEAVY_MIN_AVAILABLE_KB:-2621440} )) &&
    [[ -n "$(docker ps -q --filter "name=^$dev_app\$")" ]]; then
    echo "Only $((available_kb / 1024)) MiB available; stopping dev for this release."
    docker stop "$dev_app" >/dev/null
    dev_stopped=1
  fi
  update_status=0
  "$repo_dir/deploy/update.sh" || update_status=$?
  if (( dev_stopped )); then
    docker start "$dev_app" >/dev/null || echo 'Dev did not restart after the release.' >&2
  fi
  if (( update_status )); then exit "$update_status"; fi
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

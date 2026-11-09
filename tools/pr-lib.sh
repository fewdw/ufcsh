# Shared by tools/merge.sh and tools/release.sh. Source it; don't run it.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Work from the main clone: merge.sh deletes the task worktree it may run from.
clone="$(dirname -- "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")"
repo=$clone
cd "$clone"
gh_repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"

say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { say "STOP: $*" >&2; exit 1; }
fetch() { flock -w 600 "${UFC_GIT_LOCK:-/tmp/ufcsh-git-fetch.lock}" git -C "$repo" fetch -q --prune origin; }

# Waits until GitHub reports SHA as the PR's head (it can lag a push).
wait_head() {
  local pr=$1 sha=$2 i
  for i in $(seq 30); do
    [[ "$(gh pr view "$pr" --json headRefOid --jq .headRefOid)" == "$sha" ]] && return 0
    sleep 2
  done
  die "PR #$pr head is not $sha"
}

# Check runs on SHA as "name status conclusion url" lines (`gh pr checks
# --json` needs a newer gh than the home server has).
checks_on() {
  gh api "repos/$gh_repo/commits/$1/check-runs?per_page=100" \
    --jq '.check_runs[] | "\(.name) \(.status) \(.conclusion) \(.html_url)"'
}

# CI runs only when a draft is marked ready (see AGENTS.md). Starts it for the
# PR's head SHA if it hasn't run there, then waits for every check to finish.
ensure_ci() {
  local pr=$1 sha=$2 checks start=$SECONDS
  checks="$(checks_on "$sha")"
  if [[ "$(gh pr view "$pr" --json isDraft --jq .isDraft)" == true ]]; then
    gh pr ready "$pr" >/dev/null
    say "Marked #$pr ready; CI started"
  elif [[ -z "$checks" ]]; then
    gh pr ready --undo "$pr" >/dev/null && gh pr ready "$pr" >/dev/null
    say "Restarted CI on #$pr"
  fi
  while :; do
    checks="$(checks_on "$sha")"
    if [[ -n "$checks" ]]; then
      if awk '$2 == "completed" && $3 !~ /^(success|skipped|neutral)$/ { bad = 1 } END { exit !bad }' <<<"$checks"; then
        printf '  %s\n' "$checks" >&2
        die "CI failed on #$pr; fix it, push, and run this again"
      fi
      awk '$2 != "completed" { busy = 1 } END { exit busy }' <<<"$checks" && { say "CI passed on #$pr"; return 0; }
    elif (( SECONDS - start > 120 )); then
      die "no CI run appeared on #$pr after 2 minutes"
    fi
    (( SECONDS - start < 900 )) || die "CI on #$pr still running after 15 minutes"
    sleep 5
  done
}

# Fast-forwards the main clone's develop checkout when it is clean.
refresh_clone() {
  [[ "$(git -C "$clone" branch --show-current)" == develop ]] || return 0
  git -C "$clone" diff --quiet HEAD 2>/dev/null || { say "Main clone has local edits; left as is"; return 0; }
  git -C "$clone" merge -q --ff-only origin/develop 2>/dev/null || true
}

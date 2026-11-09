#!/usr/bin/env bash
# "Merge" a task PR into develop in one step: update it against develop, run
# CI, squash-merge, then stop its preview, release dev, and delete its worktree
# and branches. Usage: ./tools/merge.sh PR_NUMBER
[[ $# == 1 && "$1" =~ ^[0-9]+$ ]] || { echo 'Usage: ./tools/merge.sh PR_NUMBER' >&2; exit 2; }
source "$(dirname -- "${BASH_SOURCE[0]}")/pr-lib.sh"
pr=$1

read -r state base branch title < <(gh pr view "$pr" --json state,baseRefName,headRefName,title \
  --jq '"\(.state) \(.baseRefName) \(.headRefName) \(.title)"')
[[ $state == OPEN ]] || die "PR #$pr is $state"
[[ $base == develop ]] || die "PR #$pr targets $base; releases use ./tools/release.sh"
[[ $branch != develop && $branch != main ]] || die "PR #$pr is from $branch"
fetch

worktree="$(git -C "$repo" worktree list --porcelain |
  awk -v ref="branch refs/heads/$branch" '/^worktree /{w=substr($0,10)} $0==ref{print w}')"
if [[ -n $worktree ]]; then
  [[ -z "$(git -C "$worktree" status --porcelain)" ]] || die "uncommitted changes in $worktree"
  [[ "$(git -C "$worktree" rev-parse HEAD)" == "$(git -C "$repo" rev-parse "origin/$branch")" ]] ||
    die "$branch differs from origin/$branch; push it first"
  if ! git -C "$worktree" merge-base --is-ancestor origin/develop HEAD; then
    git -C "$worktree" merge -q --no-edit origin/develop ||
      { git -C "$worktree" merge --abort; die "$branch conflicts with develop; resolve in $worktree"; }
    git -C "$worktree" push -q origin "HEAD:$branch"
    say "Updated $branch with develop"
  fi
  head="$(git -C "$worktree" rev-parse HEAD)"
elif ! git -C "$repo" merge-base --is-ancestor origin/develop "origin/$branch"; then
  gh api -X PUT "repos/$gh_repo/pulls/$pr/update-branch" >/dev/null || die "could not update $branch with develop"
  sleep 3; fetch
  head="$(git -C "$repo" rev-parse "origin/$branch")"
  say "Updated $branch with develop"
else
  head="$(git -C "$repo" rev-parse "origin/$branch")"
fi

wait_head "$pr" "$head"
ensure_ci "$pr" "$head"
gh api -X PUT "repos/$gh_repo/pulls/$pr/merge" -f merge_method=squash -f sha="$head" \
  -f commit_title="$title (#$pr)" >/dev/null || die "GitHub refused the merge"
say "Squash-merged #$pr into develop"

if [[ -n $worktree ]]; then
  (cd "$worktree" && ./start stop >/dev/null 2>&1) || true
  git -C "$repo" worktree remove --force "$worktree"
fi
timeout 30 ssh ufcsh-vps "cd /home/ubuntu/ufcsh-dev && ./deploy/dev-review.sh release '$branch'" >/dev/null 2>&1 ||
  say "Could not reach the VPS to release dev for $branch"
git -C "$repo" branch -D "$branch" >/dev/null 2>&1 || true
git -C "$repo" push -q origin --delete "$branch" 2>/dev/null || true
fetch; refresh_clone
say "Done: #$pr is in develop; preview, worktree and branches removed"

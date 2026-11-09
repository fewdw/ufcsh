#!/usr/bin/env bash
# "Merge to main" in one step, after the changelog for today is pushed to
# develop: opens (or reuses) the develop → main PR, runs CI, merges it with a
# merge commit, waits for deploy-production, and fast-forwards develop to main.
# Usage: ./tools/release.sh
[[ $# == 0 ]] || { echo 'Usage: ./tools/release.sh' >&2; exit 2; }
source "$(dirname -- "${BASH_SOURCE[0]}")/pr-lib.sh"
fetch

[[ "$(git -C "$repo" rev-list --count origin/main..origin/develop)" != 0 ]] || { say "develop has nothing new for main"; exit 0; }
git -C "$repo" merge-base --is-ancestor origin/main origin/develop ||
  die "main has commits develop lacks; bring develop up to main first"
today="$(date +%F)"
git -C "$repo" show origin/develop:client/src/pages/InfoPage.tsx | grep -q "dateTime=\"$today\"" ||
  die "the changelog on develop isn't dated $today; replace it in client/src/pages/InfoPage.tsx, push, rerun"

head="$(git -C "$repo" rev-parse origin/develop)"
pr="$(gh pr list --base main --head develop --state open --json number --jq '.[0].number // empty')"
if [[ -z $pr ]]; then
  body="$(git -C "$repo" log --no-merges --format='- %s' origin/main..origin/develop)"
  url="$(gh pr create --draft --base main --head develop --title "Release: $(date '+%B %-d')" \
    --body "$body"$'\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')"
  pr="${url##*/}"
  say "Opened release PR $url"
else
  say "Using open release PR #$pr"
fi

wait_head "$pr" "$head"
ensure_ci "$pr"
merged="$(gh api -X PUT "repos/$gh_repo/pulls/$pr/merge" -f merge_method=merge -f sha="$head" --jq .sha)" ||
  die "GitHub refused the merge"
say "Merged #$pr into main ($merged); waiting for deploy-production"

start=$SECONDS
while :; do
  run="$(gh run list --branch main --event push --commit "$merged" --json databaseId,status,conclusion,url \
    --jq '.[0] // empty | "\(.databaseId) \(.status) \(.conclusion) \(.url)"')"
  [[ "$run" == *" completed "* ]] && break
  (( SECONDS - start < 1200 )) || die "main's CI still not finished after 20 minutes: ${run##* }"
  sleep 10
done
deploy="$(gh run view "${run%% *}" --json jobs --jq '.jobs[] | select(.name == "deploy-production") | .conclusion')"
[[ $deploy == success ]] || die "deploy-production: ${deploy:-did not run}; ${run##* } (rerun or fix it)"
say "deploy-production succeeded; ufc.sh is on $merged"

git -C "$repo" push -q origin "$merged:refs/heads/develop" || die "could not fast-forward develop to main"
fetch; refresh_clone
say "Done: develop and main are both at $merged"

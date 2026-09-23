#!/usr/bin/env bash
set -euo pipefail

# Install this file outside the checkout as ~/.local/bin/ufcsh-deploy-entrypoint.
# It lets the first deployment pull the deploy handler that is being introduced.
repo_dir=/home/ubuntu/ufcsh
if [[ "$(git -C "$repo_dir" branch --show-current)" != main ]]; then
  echo 'Production checkout must stay on main.' >&2
  exit 2
fi
if [[ -n "$(git -C "$repo_dir" status --porcelain)" ]]; then
  echo 'Production checkout has uncommitted changes.' >&2
  exit 2
fi
git -C "$repo_dir" fetch origin main
git -C "$repo_dir" merge --ff-only origin/main
exec "$repo_dir/deploy/remote-deploy.sh"

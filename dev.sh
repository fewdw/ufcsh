#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
env_file="${DEV_ENV_FILE:-.env.dev}"

if [[ ! -f "$env_file" ]]; then
  echo 'Missing .env.dev. Copy .env.dev.example and fill in your private Clerk development keys.' >&2
  exit 2
fi

chmod 600 "$env_file"
if ! grep -Eq '^DEV_CLERK_PUBLISHABLE_KEY=pk_test_' "$env_file" || ! grep -Eq '^DEV_CLERK_SECRET_KEY=sk_test_' "$env_file"; then
  echo 'Dev must use pk_test_ and sk_test_ keys from a separate Clerk development instance.' >&2
  exit 2
fi
if grep -Eq '^(DEV_CLERK_PUBLISHABLE_KEY=pk_test_replace_me|DEV_CLERK_SECRET_KEY=sk_test_replace_me|DEV_DEFAULT_ADMIN=you@example.com)$' "$env_file"; then
  echo 'Replace the Clerk and admin email placeholders in .env.dev.' >&2
  exit 2
fi
if grep -Eq '^DEV_ADMIN_TOKEN=replace-with-a-long-random-secret$' "$env_file"; then
  echo 'Replace the DEV_ADMIN_TOKEN placeholder in .env.dev.' >&2
  exit 2
fi
if grep -Eq '^DEV_TUNNEL_TOKEN=replace-with-cloudflare-tunnel-token$' "$env_file"; then
  echo 'Replace the DEV_TUNNEL_TOKEN placeholder in .env.dev.' >&2
  exit 2
fi
if [[ -z "${DEV_BUILD_CONTEXT:-}" && -e ../ufcsh-dev/.git ]]; then
  DEV_BUILD_CONTEXT="$(realpath ../ufcsh-dev)"
fi
export DEV_BUILD_CONTEXT="${DEV_BUILD_CONTEXT:-.}"
export DEV_BRANCH="${DEV_BRANCH:-$(git -C "$DEV_BUILD_CONTEXT" branch --show-current)}"
export DEV_SHA="${DEV_SHA:-$(git -C "$DEV_BUILD_CONTEXT" rev-parse HEAD)}"
if [[ "${UFC_HEAVY_LOCK_HELD:-0}" != 1 ]]; then
  exec ./tools/heavy.sh "$0" "$@"
fi
./deploy/build.sh -p ufcsh --env-file "$env_file" -f compose.dev.yaml app-dev
docker compose -p ufcsh --env-file "$env_file" -f compose.dev.yaml up -d --no-build --wait --wait-timeout 180 app-dev dev-tunnel
docker compose -p ufcsh --env-file "$env_file" -f compose.dev.yaml ps app-dev dev-tunnel

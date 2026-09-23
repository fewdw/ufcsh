#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env.dev ]]; then
  echo 'Missing .env.dev. Copy .env.dev.example and fill in your private Clerk development keys.' >&2
  exit 2
fi

chmod 600 .env.dev
if ! grep -Eq '^DEV_CLERK_PUBLISHABLE_KEY=pk_test_' .env.dev || ! grep -Eq '^DEV_CLERK_SECRET_KEY=sk_test_' .env.dev; then
  echo 'Dev must use pk_test_ and sk_test_ keys from a separate Clerk development instance.' >&2
  exit 2
fi
if grep -Eq '^(DEV_CLERK_PUBLISHABLE_KEY=pk_test_replace_me|DEV_CLERK_SECRET_KEY=sk_test_replace_me|DEV_DEFAULT_ADMIN=you@example.com)$' .env.dev; then
  echo 'Replace the Clerk and admin email placeholders in .env.dev.' >&2
  exit 2
fi
if grep -Eq '^DEV_ADMIN_TOKEN=replace-with-a-long-random-secret$' .env.dev; then
  echo 'Replace the DEV_ADMIN_TOKEN placeholder in .env.dev.' >&2
  exit 2
fi
if grep -Eq '^DEV_TUNNEL_TOKEN=replace-with-cloudflare-tunnel-token$' .env.dev; then
  echo 'Replace the DEV_TUNNEL_TOKEN placeholder in .env.dev.' >&2
  exit 2
fi
if [[ -z "${DEV_BUILD_CONTEXT:-}" && -e ../ufcsh-dev/.git ]]; then
  DEV_BUILD_CONTEXT="$(realpath ../ufcsh-dev)"
fi
export DEV_BUILD_CONTEXT="${DEV_BUILD_CONTEXT:-.}"
docker compose -p ufcsh --env-file .env.dev -f compose.dev.yaml up -d --build app-dev dev-tunnel
docker compose -p ufcsh --env-file .env.dev -f compose.dev.yaml ps app-dev dev-tunnel
echo 'Dev is deploying. Follow startup with: docker compose -p ufcsh --env-file .env.dev -f compose.dev.yaml logs -f app-dev dev-tunnel'

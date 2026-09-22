#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo 'Missing private .env; run prepare-staging.sh locally and copy it here.' >&2; exit 2; fi
if ! grep -q '^GRAFANA_ADMIN_PASSWORD=.' .env; then echo 'Set GRAFANA_ADMIN_PASSWORD in .env.' >&2; exit 2; fi
docker compose --profile observability up -d --build
docker compose --profile observability ps
echo 'The app is starting. Check docker compose logs -f app and https://YOUR_DOMAIN/readyz.'

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo 'Missing private .env; run prepare-staging.sh locally and copy it here.' >&2; exit 2; fi
if ! grep -q '^GRAFANA_ADMIN_PASSWORD=.' .env; then echo 'Set GRAFANA_ADMIN_PASSWORD in .env.' >&2; exit 2; fi
# One release (app-blue) runs; deploy/update.sh hands over between blue and green.
docker compose --profile observability up -d --build app-blue proxy prometheus node-exporter grafana
docker compose --profile observability ps
echo 'The app is starting. Check docker compose logs -f app-blue and https://YOUR_DOMAIN/readyz.'

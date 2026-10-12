#!/usr/bin/env bash
# Prints the Compose service serving production now (app-blue or app-green),
# or fails when neither is running. While a deploy hands over, both run and
# either answers for the shared /data.
set -euo pipefail
cd "$(dirname "$0")/.."
for service in app-blue app-green; do
  if [ -n "$(docker compose ps -q --status running "$service")" ]; then echo "$service"; exit 0; fi
done
exit 1

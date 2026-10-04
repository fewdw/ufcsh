#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
[[ $# -gt 0 ]] || { echo 'Usage: deploy/build.sh [COMPOSE_OPTIONS...] SERVICE' >&2; exit 2; }
if [[ "${UFC_HEAVY_LOCK_HELD:-0}" != 1 ]]; then
  exec "$script_dir/../tools/heavy.sh" "$0" "$@"
fi
builder="${UFC_BUILD_BUILDER:-ufcsh-bounded}"
if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
  docker buildx create --name "$builder" --driver docker-container \
    --driver-opt memory=2g,memory-swap=2g,cpu-quota=200000,default-load=true >/dev/null
fi
service="${!#}"
compose_args=("${@:1:$#-1}")
docker compose "${compose_args[@]}" build --builder "$builder" "$service"

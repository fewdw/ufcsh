#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T app node src/backup.ts /data/ufc.db "/data/backups/daily-ufc-$stamp.db"
docker compose exec -T app node src/backup.ts /data/scoring.db "/data/backups/daily-scoring-$stamp.db"
docker compose exec -T app node --input-type=module -e '
  import { readdirSync, unlinkSync } from "node:fs";
  const directory = "/data/backups";
  for (const prefix of ["daily-ufc-", "daily-scoring-"]) {
    const files = readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith(".db")).sort();
    for (const file of files.slice(0, -7)) unlinkSync(`${directory}/${file}`);
  }
'
echo "Checked daily SQLite backups saved in the app data volume ($stamp)."

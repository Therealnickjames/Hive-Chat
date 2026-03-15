#!/usr/bin/env bash
# db-backup.sh — Create timestamped PostgreSQL backup via Docker
# Usage: ./scripts/db-backup.sh [backup_dir]
#
# Creates: <backup_dir>/tavok_<timestamp>.sql.gz
# Default backup_dir: ./backups

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/tavok_${TIMESTAMP}.sql.gz"
CONTAINER="$(docker compose ps -q db 2>/dev/null)"

if [ -z "$CONTAINER" ]; then
  echo "ERROR: PostgreSQL container is not running. Start with: make up"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Backing up tavok database..."
docker compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-tavok}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  "${POSTGRES_DB:-tavok}" \
  | gzip > "$BACKUP_FILE"

SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
echo "Backup complete: $BACKUP_FILE ($SIZE)"

# Keep only last 10 backups by default
KEEP="${TAVOK_BACKUP_RETAIN:-10}"
BACKUPS_COUNT="$(ls -1 "$BACKUP_DIR"/tavok_*.sql.gz 2>/dev/null | wc -l)"
if [ "$BACKUPS_COUNT" -gt "$KEEP" ]; then
  REMOVE_COUNT=$((BACKUPS_COUNT - KEEP))
  echo "Pruning $REMOVE_COUNT old backup(s) (retaining $KEEP)..."
  ls -1t "$BACKUP_DIR"/tavok_*.sql.gz | tail -n "$REMOVE_COUNT" | xargs rm -f
fi

echo "Done."

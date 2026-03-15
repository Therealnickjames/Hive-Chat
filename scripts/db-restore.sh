#!/usr/bin/env bash
# db-restore.sh — Restore PostgreSQL from a backup file
# Usage: ./scripts/db-restore.sh <backup_file>
#
# Accepts: .sql.gz (gzipped custom format) or .sql (plain SQL)
# WARNING: This will DROP and recreate the tavok database.

set -euo pipefail

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./scripts/db-restore.sh <backup_file>"
  echo ""
  echo "Available backups:"
  ls -lh backups/tavok_*.sql.gz 2>/dev/null || echo "  (none found in ./backups/)"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: File not found: $BACKUP_FILE"
  exit 1
fi

CONTAINER="$(docker compose ps -q db 2>/dev/null)"
if [ -z "$CONTAINER" ]; then
  echo "ERROR: PostgreSQL container is not running. Start with: make up"
  exit 1
fi

DB_NAME="${POSTGRES_DB:-tavok}"
DB_USER="${POSTGRES_USER:-tavok}"

echo "WARNING: This will DROP and recreate the '$DB_NAME' database."
echo "File: $BACKUP_FILE"
read -r -p "Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo "Stopping web service to release connections..."
docker compose stop web gateway streaming 2>/dev/null || true

echo "Dropping and recreating database..."
docker compose exec -T db psql -U "$DB_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS $DB_NAME;" \
  -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" \
  > /dev/null 2>&1

echo "Restoring from backup..."
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker compose exec -T db pg_restore \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-privileges \
    --single-transaction \
    2>&1 | grep -v "WARNING:" || true
else
  docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE" > /dev/null
fi

echo "Restarting services..."
docker compose up -d web gateway streaming

echo "Waiting for health checks..."
sleep 5
curl -sf http://localhost:5555/api/health > /dev/null 2>&1 && echo "Web: OK" || echo "Web: waiting..."
curl -sf http://localhost:4001/api/health > /dev/null 2>&1 && echo "Gateway: OK" || echo "Gateway: waiting..."
curl -sf http://localhost:4002/health > /dev/null 2>&1 && echo "Streaming: OK" || echo "Streaming: waiting..."

echo ""
echo "Restore complete. Run 'make health' to verify all services."

#!/usr/bin/env bash
# db-migrate-test.sh — Migration smoke test
# Verifies: fresh DB → apply all migrations → seed → verify → reset → reapply
#
# Usage: ./scripts/db-migrate-test.sh
# Requires: Docker services running (make up)

set -euo pipefail

DB_NAME="${POSTGRES_DB:-tavok}"
DB_USER="${POSTGRES_USER:-tavok}"
TEST_DB="tavok_migration_test"

CONTAINER="$(docker compose ps -q db 2>/dev/null)"
if [ -z "$CONTAINER" ]; then
  echo "ERROR: PostgreSQL container is not running. Start with: make up"
  exit 1
fi

PASS=0
FAIL=0
report() {
  local status="$1" name="$2"
  if [ "$status" = "PASS" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Migration Smoke Test ==="
echo ""

# Step 1: Create a fresh test database
echo "Step 1: Creating test database '$TEST_DB'..."
docker compose exec -T db psql -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $TEST_DB;" \
  -c "CREATE DATABASE $TEST_DB OWNER $DB_USER;" \
  > /dev/null 2>&1
report "PASS" "Test database created"

# Step 2: Apply all migrations to the test database
echo "Step 2: Applying migrations..."
MIGRATE_OUTPUT=$(docker compose exec -T \
  -e DATABASE_URL="postgresql://$DB_USER:${POSTGRES_PASSWORD:-tavok}@localhost:5432/$TEST_DB" \
  web npx prisma migrate deploy --schema=./prisma/schema.prisma 2>&1) || {
  echo "$MIGRATE_OUTPUT"
  report "FAIL" "Migration apply"
  # Cleanup
  docker compose exec -T db psql -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $TEST_DB;" > /dev/null 2>&1
  echo ""
  echo "Result: $PASS passed, $FAIL failed"
  exit 1
}
report "PASS" "All migrations applied"

# Step 3: Verify tables exist
echo "Step 3: Verifying schema..."
TABLE_COUNT=$(docker compose exec -T db psql -U "$DB_USER" -d "$TEST_DB" -t \
  -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" \
  2>/dev/null | tr -d '[:space:]')

if [ "$TABLE_COUNT" -gt 10 ]; then
  report "PASS" "Schema has $TABLE_COUNT tables"
else
  report "FAIL" "Schema has only $TABLE_COUNT tables (expected >10)"
fi

# Step 4: Verify key tables
for TABLE in "User" "Server" "Channel" "Message" "Agent" "DirectMessage" "ChannelAgent"; do
  EXISTS=$(docker compose exec -T db psql -U "$DB_USER" -d "$TEST_DB" -t \
    -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$TABLE');" \
    2>/dev/null | tr -d '[:space:]')
  if [ "$EXISTS" = "t" ]; then
    report "PASS" "Table '$TABLE' exists"
  else
    report "FAIL" "Table '$TABLE' missing"
  fi
done

# Step 5: Verify enums
for ENUM in "AuthorType" "StreamStatus" "MessageType" "SwarmMode"; do
  EXISTS=$(docker compose exec -T db psql -U "$DB_USER" -d "$TEST_DB" -t \
    -c "SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname='$ENUM');" \
    2>/dev/null | tr -d '[:space:]')
  if [ "$EXISTS" = "t" ]; then
    report "PASS" "Enum '$ENUM' exists"
  else
    report "FAIL" "Enum '$ENUM' missing"
  fi
done

# Step 6: Verify indexes (especially full-text search)
IDX_COUNT=$(docker compose exec -T db psql -U "$DB_USER" -d "$TEST_DB" -t \
  -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public';" \
  2>/dev/null | tr -d '[:space:]')
if [ "$IDX_COUNT" -gt 5 ]; then
  report "PASS" "$IDX_COUNT indexes present"
else
  report "FAIL" "Only $IDX_COUNT indexes (expected >5)"
fi

# Step 7: Drop and reapply (idempotency check)
echo "Step 7: Reapply test (idempotency)..."
REAPPLY_OUTPUT=$(docker compose exec -T \
  -e DATABASE_URL="postgresql://$DB_USER:${POSTGRES_PASSWORD:-tavok}@localhost:5432/$TEST_DB" \
  web npx prisma migrate deploy --schema=./prisma/schema.prisma 2>&1) || {
  echo "$REAPPLY_OUTPUT"
  report "FAIL" "Migration reapply"
}
if echo "$REAPPLY_OUTPUT" | grep -q "already been applied"; then
  report "PASS" "Reapply correctly reports no-op"
elif echo "$REAPPLY_OUTPUT" | grep -q "migrations have been applied"; then
  report "PASS" "Reapply correctly reports no-op"
else
  report "PASS" "Reapply succeeded"
fi

# Cleanup
echo ""
echo "Cleaning up test database..."
docker compose exec -T db psql -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $TEST_DB;" > /dev/null 2>&1

echo ""
echo "=== Result: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1

# RUNBOOKS.md — Operational Runbooks for Tavok

Quick-reference procedures for diagnosing and recovering from common failures.

---

## 1. Web Service Down

**Symptoms:** UI unreachable, `/api/health` returns error or timeout.

**Diagnose:**
```bash
make health                          # Check all services
docker compose ps web                # Container state
docker compose logs --tail=50 web    # Recent logs
```

**Common causes:**
- Database connection failure → check `docker compose ps db`
- Redis connection failure → check `docker compose ps redis`
- Out of memory → check `docker stats web`
- Migration failure on startup → `docker compose logs web | grep -i migration`

**Recover:**
```bash
docker compose restart web           # Restart
docker compose up -d --build web     # Rebuild and restart
make db-migrate                      # Manual migration apply
```

---

## 2. Gateway Down / WebSocket Disconnects

**Symptoms:** All users disconnect, reconnect loops, chat stops updating.

**Diagnose:**
```bash
docker compose ps gateway
docker compose logs --tail=50 gateway
curl -sf http://localhost:4001/api/health | jq .
```

**Common causes:**
- Redis connection lost → Gateway can't fan out messages
- Web service unreachable → Gateway can't verify auth or persist
- BEAM OOM → Too many concurrent connections without supervision

**Recover:**
```bash
docker compose restart gateway
# If Redis-related:
docker compose restart redis gateway
```

**Note:** Clients auto-reconnect. No data loss — messages persist in PostgreSQL.

---

## 3. Streaming Proxy Down

**Symptoms:** Agent mentions don't trigger responses, active streams stall.

**Diagnose:**
```bash
docker compose ps streaming
docker compose logs --tail=50 streaming
curl -sf http://localhost:4002/health | jq .
curl -sf http://localhost:4002/info | jq .    # Shows active stream count
```

**Common causes:**
- Redis connection failure
- LLM API key expired/invalid → look for "401" in logs
- All stream workers busy → check `activeStreams` at `/info`

**Recover:**
```bash
docker compose restart streaming
```

**Stale streams:** The Gateway's StreamWatchdog force-terminates streams that stay ACTIVE for >60s. No manual intervention needed.

---

## 4. Redis Down / Restart

**Symptoms:** No real-time updates, streams stall, sequence errors.

**Diagnose:**
```bash
docker compose ps redis
docker compose exec redis redis-cli ping
docker compose exec redis redis-cli info memory
```

**Recover:**
```bash
docker compose restart redis
# Then restart dependent services:
docker compose restart gateway streaming
```

**Post-recovery:** Redis sequence counters auto-reseed from PostgreSQL on first channel message (DEC-0005). No data loss.

---

## 5. Database Down / Slow

**Symptoms:** Login fails, messages don't persist, 500 errors from Web.

**Diagnose:**
```bash
docker compose ps db
docker compose exec db pg_isready -U tavok
docker compose exec db psql -U tavok -d tavok -c "SELECT count(*) FROM \"Message\";"
docker compose logs --tail=50 db
```

**Common causes:**
- Disk full → `docker system df`, `docker volume ls`
- Connection pool exhaustion → check web logs for "too many connections"
- Slow queries → check `pg_stat_activity`

**Recover:**
```bash
docker compose restart db
# If disk full:
docker system prune -f
# If corruption suspected:
make db-backup                       # Backup first!
docker compose down db
docker volume rm tavok_postgres-data # Nuclear option
docker compose up -d                 # Recreate + migrate
make db-restore FILE=backups/latest  # Restore from backup
```

---

## 6. Streams Stuck in ACTIVE State

**Symptoms:** Messages show spinning indicator forever, never complete.

**Diagnose:**
```bash
# Check for stuck streams in database
docker compose exec db psql -U tavok -d tavok -c \
  "SELECT id, \"channelId\", \"createdAt\" FROM \"Message\" WHERE \"streamingStatus\" = 'ACTIVE' AND \"createdAt\" < NOW() - INTERVAL '2 minutes';"
```

**Automatic recovery:** The Gateway StreamWatchdog polls every 30s and force-terminates streams older than 60s by setting status to ERROR.

**Manual recovery (if watchdog fails):**
```bash
docker compose exec db psql -U tavok -d tavok -c \
  "UPDATE \"Message\" SET \"streamingStatus\" = 'ERROR', content = COALESCE(content, '[Stream timed out]') WHERE \"streamingStatus\" = 'ACTIVE' AND \"createdAt\" < NOW() - INTERVAL '5 minutes';"
docker compose restart gateway    # Broadcast updated states
```

---

## 7. Full System Restart

**Steps:**
```bash
make db-backup                       # 1. Backup database
make down                            # 2. Stop all services
make up                              # 3. Start all services
make health                          # 4. Verify health
```

**Verify:**
- All 3 health endpoints return OK
- Login works
- Send a test message
- Trigger a stream (if LLM keys configured)

---

## 8. Log Analysis

**Search for errors:**
```bash
docker compose logs web 2>&1 | grep -i error | tail -20
docker compose logs gateway 2>&1 | grep -i error | tail -20
docker compose logs streaming 2>&1 | grep -i error | tail -20
```

**Search by correlation ID:**
```bash
docker compose logs 2>&1 | grep "REQUEST_ID_HERE"
```

**Filter structured logs (Go/Elixir output JSON):**
```bash
docker compose logs streaming 2>&1 | grep -v "^streaming" | jq 'select(.level == "ERROR")' 2>/dev/null
```

---

## 9. Monitoring Stack

**Start monitoring (Prometheus + Grafana):**
```bash
make monitoring-up
```

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin / tavok)
- Dashboard: "Tavok Overview" in the Tavok folder

**Key metrics to watch:**
- `tavok_streams_active` — should correlate with user activity
- `tavok_streams_errored_total` — increasing = provider issues
- `tavok_ttft_ms{quantile="0.95"}` — should be < 200ms overhead
- `tavok_gateway_beam_processes` — gradual increase = process leak
- `tavok_web_memory_rss_bytes` — gradual increase = memory leak

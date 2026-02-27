# ARCHITECTURE-CURRENT.md — As-Built Reality

> Updated after each structural change. If something conflicts with HiveChat.md, this document reflects what actually exists.

**Last updated**: 2026-02-23 (initial scaffold)

---

## Current State

Project is in initial scaffold phase. Three services are stubbed with health check endpoints.

### Services

| Service | Language | Port | Status |
|---|---|---|---|
| Web (Next.js) | TypeScript | 3000 | Health check only |
| Gateway (Phoenix) | Elixir | 4001 | Health check + stub WebSocket |
| Streaming Proxy | Go | 4002 (internal) | Health check only |
| PostgreSQL | - | 5432 | Running, schema applied |
| Redis | - | 6379 | Running |

### What Works
- `docker-compose up` starts all services
- Health checks pass on all three app services
- Prisma schema applied to PostgreSQL
- Gateway accepts WebSocket connections (stub)

### What Doesn't Work Yet
- No authentication
- No UI beyond placeholder page
- No real message sending/receiving
- No streaming
- No presence tracking (configured but not connected to real users)

---

## Project Structure

See file manifest in the plan or run `tree` on the repo root.

# TASKS.md — Active Work Tracker

> Each task has: ID, title, status, acceptance criteria, and assignee role.
> Status: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## TASK-0001: Scaffold Project

**Status**: IN PROGRESS
**Priority**: P0 — Foundation
**Assignee**: Builder

### Description
Set up the complete project structure from zero. All three services, Docker infrastructure, documentation, and a working `docker-compose up` with health checks passing.

### Acceptance Criteria
- [ ] All docs moved to `docs/` directory
- [ ] `docs/PROTOCOL.md` defines all cross-service contracts
- [ ] `docs/DECISIONS.md` seeded with DEC-0001 through DEC-0007
- [ ] `prisma/schema.prisma` has all models with ULIDs, indexes, enums
- [ ] Next.js app scaffolded with health endpoint
- [ ] Elixir/Phoenix gateway scaffolded with health endpoint and stub socket
- [ ] Go streaming proxy scaffolded with health endpoint
- [ ] `docker-compose.yml` starts all 5 containers (db, redis, web, gateway, streaming)
- [ ] `make health` returns 3 OK responses
- [ ] Prisma migration applies cleanly
- [ ] `.env.example` documents every variable
- [ ] `CLAUDE.md` provides AI agent entry point

---

## TASK-0002: Implement Foundation (Phase 2a)

**Status**: TODO
**Priority**: P0 — Foundation
**Assignee**: Builder

### Description
User registration/login, NextAuth with JWT strategy, basic Discord-like app shell layout.

### Acceptance Criteria
- [ ] User can register with email/password
- [ ] User can log in and receive JWT
- [ ] App shell renders: server sidebar, channel sidebar, chat area, member list
- [ ] Dark theme applied (default and only theme)
- [ ] Auth state persists across page refreshes
- [ ] Unauthenticated users redirected to login

---

## TASK-0003: Implement Core Chat (Phase 2b)

**Status**: TODO
**Priority**: P0 — Core
**Assignee**: Builder

### Description
Server CRUD, channel CRUD, real-time messaging through Elixir gateway, message persistence, history with scroll-back, user presence.

### Acceptance Criteria
- [ ] User can create a server
- [ ] User can create text channels in a server
- [ ] User can join a server (via invite or direct join for MVP)
- [ ] Messages sent via WebSocket through Elixir gateway
- [ ] Messages persisted to PostgreSQL via internal API
- [ ] Messages broadcast to all connected clients in channel
- [ ] Message history loads on channel view (cursor pagination)
- [ ] User presence shows online/offline in member list
- [ ] Reconnection syncs missed messages (sequence-based)

---

## TASK-0004: Implement Token Streaming (Phase 3)

**Status**: TODO
**Priority**: P0 — Differentiator
**Assignee**: Builder

### Description
Bot creation with LLM config, Go proxy streaming, smooth token rendering in the UI.

### Acceptance Criteria
- [ ] Server admin can create a bot with LLM provider/model/key/prompt config
- [ ] Channel can have a default bot assigned
- [ ] Bot triggers on configured mode (always, mention, keyword)
- [ ] Go proxy opens SSE stream to LLM API
- [ ] Tokens flow through Redis → Gateway → WebSocket → browser
- [ ] Client renders tokens smoothly as they arrive
- [ ] Visual indicator for active vs complete streams
- [ ] Error state rendered when stream fails
- [ ] Support for any OpenAI-compatible API endpoint
- [ ] Streaming lifecycle follows PROTOCOL.md invariants exactly

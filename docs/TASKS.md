# TASKS.md — Active Work Tracker

> Each task has: ID, title, status, acceptance criteria, and assignee role.
> Status: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## TASK-0001: Scaffold Project

**Status**: DONE
**Priority**: P0 — Foundation
**Assignee**: Builder

### Description
Set up the complete project structure from zero. All three services, Docker infrastructure, documentation, and a working `docker-compose up` with health checks passing.

### Acceptance Criteria
- [x] All docs moved to `docs/` directory
- [x] `docs/PROTOCOL.md` defines all cross-service contracts
- [x] `docs/DECISIONS.md` seeded with DEC-0001 through DEC-0007
- [x] `prisma/schema.prisma` has all models with ULIDs, indexes, enums
- [x] Next.js app scaffolded with health endpoint
- [x] Elixir/Phoenix gateway scaffolded with health endpoint and stub socket
- [x] Go streaming proxy scaffolded with health endpoint
- [x] `docker-compose.yml` starts all 5 containers (db, redis, web, gateway, streaming)
- [x] `make health` returns 3 OK responses
- [x] Prisma migration applies cleanly
- [x] `.env.example` documents every variable
- [x] `CLAUDE.md` provides AI agent entry point

---

## TASK-0002: Implement Foundation (Phase 2a)

**Status**: DONE
**Priority**: P0 — Foundation
**Assignee**: Builder

### Description
User registration/login, NextAuth with JWT strategy, basic Discord-like app shell layout.

### Acceptance Criteria
- [x] User can register with email/password
- [x] User can log in and receive JWT
- [x] App shell renders: server sidebar, channel sidebar, chat area, member list
- [x] Dark theme applied (default and only theme)
- [x] Auth state persists across page refreshes
- [x] Unauthenticated users redirected to login

---

## TASK-0003: Implement Core Chat (Phase 2b)

**Status**: DONE
**Priority**: P0 — Core
**Assignee**: Builder

### Description
Server CRUD, channel CRUD, real-time messaging through Elixir gateway, message persistence, history with scroll-back, user presence.

### Acceptance Criteria
- [x] User can create a server
- [x] User can create text channels in a server
- [x] User can join a server (via invite or direct join for MVP)
- [x] Messages sent via WebSocket through Elixir gateway
- [x] Messages persisted to PostgreSQL via internal API
- [x] Messages broadcast to all connected clients in channel
- [x] Message history loads on channel view (cursor pagination)
- [x] User presence shows online/offline in member list
- [x] Reconnection syncs missed messages (sequence-based)

---

## TASK-0004: Implement Token Streaming (Phase 3)

**Status**: DONE
**Priority**: P0 — Differentiator
**Assignee**: Builder

### Description
Bot creation with LLM config, Go proxy streaming, smooth token rendering in the UI.

### Acceptance Criteria
- [x] Server admin can create a bot with LLM provider/model/key/prompt config
- [x] Channel can have a default bot assigned
- [x] Bot triggers on configured mode (always, mention, keyword)
- [x] Go proxy opens SSE stream to LLM API
- [x] Tokens flow through Redis → Gateway → WebSocket → browser
- [x] Client renders tokens smoothly as they arrive
- [x] Visual indicator for active vs complete streams
- [x] Error state rendered when stream fails
- [x] Support for any OpenAI-compatible API endpoint
- [x] Streaming lifecycle follows PROTOCOL.md invariants exactly

---

## TASK-0005: Add Markdown Rendering to Chat Messages

**Status**: DONE
**Priority**: P1 — Polish
**Assignee**: Builder

### Description
Render markdown in chat messages (including streaming bot messages) so code blocks, emphasis, lists, and other common formatting display correctly.

### Acceptance Criteria
- [x] Markdown renderer added for chat message content
- [x] GFM support enabled (lists, tables, task list syntax)
- [x] Syntax highlighting applied for fenced code blocks
- [x] Copy button available on code blocks
- [x] Streaming messages render markdown progressively and retain active cursor
- [x] Markdown image nodes do not render `<img>` (show placeholder text instead)

---

## TASK-0006: Invite Links

**Status**: TODO
**Priority**: P1 — Core Collaboration
**Assignee**: Builder

### Description
Implement server invite links so users can join servers via shareable invite URLs.

### Acceptance Criteria
- [ ] Server members with permission can create invite links
- [ ] Invite links include token, optional expiration, and optional usage limit
- [ ] Invite resolution endpoint validates invite and returns join target metadata
- [ ] Authenticated users can join a server via valid invite
- [ ] Invalid, expired, or exhausted invites show clear error states

---

## TASK-0008: Roles & Permissions

**Status**: DONE
**Priority**: P1 — Core Collaboration
**Assignee**: Builder

### Description
Add role-based permissions so server owners can define roles, assign permissions, assign roles to members, and have API/UI behavior enforce permissions instead of owner-only gates.

### Acceptance Criteria
- [x] Permission bitfield utility added and shared across server/client
- [x] Reusable server-side permission check helper implemented
- [x] `@everyone` role auto-created on new servers and assigned on member join
- [x] Role CRUD + member-role assignment API routes implemented
- [x] Existing owner-only routes migrated to permission checks
- [x] Frontend provider/sidebar updated to use effective permissions
- [x] Role management modal added
- [x] Backfill script added and run for existing servers

---

## TASK-0009: Reactions

**Status**: TODO
**Priority**: P1 — Polish
**Assignee**: Builder

### Description
Add message reactions so members can add/remove emoji reactions and see reaction counts update in real time.

---

## TASK-0010: File Uploads

**Status**: DONE
**Priority**: P1 — Core Collaboration
**Assignee**: Builder

### Description
Add file upload support for chat messages. Users can upload allowed files through a web API route, store files on local disk in a Docker volume, and render image attachments inline while non-image files render as downloadable links.

### Acceptance Criteria
- [x] Attachment model added to Prisma schema with User and Message relations
- [x] Upload storage persisted on local disk via Docker volume mount
- [x] `POST /api/uploads` implemented with auth, validation, and disk persistence
- [x] `GET /api/uploads/[fileId]` implemented for authenticated file serving
- [x] Message renderer parses `[file:FILE_ID:FILENAME:MIMETYPE]` references and displays attachments
- [x] Message input supports upload button, pending attachments, and file-reference message composition

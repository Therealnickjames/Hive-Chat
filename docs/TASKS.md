# TASKS.md — Active Work Tracker

> Each task has: ID, title, status, acceptance criteria, and assignee role.
> Status: `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`
> Task numbering unified across ROADMAP.md. V0 uses TASK-0001 through TASK-0010 (all complete), and V1 starts at TASK-0011 to avoid historical collisions. For detailed implementation specs (data models, API endpoints, file lists) on chat tasks, see `docs/V1-IMPLEMENTATION.md`.

---

# V0 — COMPLETE

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
Bot creation, Go proxy LLM streaming, token relay through Gateway, smooth frontend rendering.

### Acceptance Criteria
- [x] Bot creation UI with provider/model/key/prompt configuration
- [x] Default bot assignment per channel
- [x] Full streaming lifecycle: IDLE → ACTIVE → COMPLETE/ERROR
- [x] SSE parsing for OpenAI, Anthropic, and compatible providers
- [x] Token relay: LLM → Go → Redis → Elixir → WebSocket → Browser
- [x] requestAnimationFrame batching for smooth 60fps rendering
- [x] Placeholder-before-first-token invariant
- [x] Monotonic token indexing
- [x] AES-256-GCM bot API key encryption

---

## TASK-0005: Markdown Rendering

**Status**: DONE
**Priority**: P1 — Polish
**Assignee**: Builder

### Description
Rich markdown rendering for chat messages with syntax-highlighted code blocks.

### Acceptance Criteria
- [x] GFM markdown rendering (bold, italic, lists, links, tables)
- [x] Syntax-highlighted code blocks with language detection
- [x] Progressive rendering (renders during streaming, not just on complete)
- [x] Image suppression (no external image loading from untrusted content)
- [x] Code copy button on code blocks

---

## TASK-0006: Invite Links

**Status**: DONE
**Priority**: P0 — Collaboration
**Assignee**: Builder

### Description
Server invite link system with expiration, usage limits, and validation.

### Acceptance Criteria
- [x] Server members with permission can create invite links
- [x] Invite links use format: `{NEXTAUTH_URL}/invite/{code}`
- [x] Invite resolution validates code, expiration, usage limit
- [x] Authenticated users join server via valid invite link
- [x] Joining creates a Member record
- [x] Invalid/expired/exhausted invites show clear errors
- [x] Gateway `authorize_join` checks Member record

---

## TASK-0007: Break-Testing V0

**Status**: DONE
**Priority**: P0 — Quality
**Assignee**: Verifier

### Description
Systematic break-testing of all V0 features. Infrastructure failure scenarios. Streaming reliability validation.

### Acceptance Criteria
- [x] Break-test checklist executed (auth, chat, streaming, reconnect, presence)
- [x] Infrastructure failure scenarios tested (Redis kill, Web kill, Gateway restart)
- [x] All CRITICAL and HIGH issues resolved (BREAK-0001 through BREAK-0011)
- [x] Stream watchdog implemented with two-layer terminal convergence (DEC-0017, DEC-0018)
- [x] Go proxy retry with exponential backoff on finalize failure
- [x] Logger formatter crash resolved
- [x] Results documented in KNOWN-ISSUES.md

---

## TASK-0008: Roles & Permissions

**Status**: DONE
**Priority**: P1 — Core Collaboration
**Assignee**: Builder

### Description
Implement server roles with bitfield-based permissions and API-level enforcement.

### Acceptance Criteria
- [x] 8 permission types defined with bitfield encoding
- [x] Automatic @everyone role created on server creation
- [x] Role CRUD for server admins
- [x] Permission checks on all protected API endpoints
- [x] Role hierarchy with position-based ordering
- [x] Member role assignment

---

## TASK-0009: Emoji Reactions (V0 scope)

**Status**: DONE
**Priority**: P1 — Core Collaboration
**Assignee**: Builder

### Description
Shipped baseline emoji reactions in V0: Reaction model, API endpoints, emoji picker, and optimistic toggle UX.

### Acceptance Criteria
- [x] Reaction data model and persistence are implemented
- [x] Add/remove reaction API is implemented
- [x] Emoji picker and reaction toggle UI are implemented
- [x] Baseline reaction pills render with counts

---

## TASK-0010: File & Image Uploads (V0 scope)

**Status**: DONE
**Priority**: P1 — Core Collaboration
**Assignee**: Builder

### Description
Shipped baseline attachments in V0: Attachment model, upload/download API, paperclip button, and inline image/file rendering.

### Acceptance Criteria
- [x] Attachment model and persistence are implemented
- [x] Upload and download API endpoints are implemented
- [x] Paperclip-based file upload is implemented
- [x] Inline image rendering and file cards are implemented

---

# V1 — LAUNCH (Track A: Agent Wedge + Track B: Chat Completeness)

## TASK-0011: Agent Thinking Timeline ⭐

**Status**: DONE
**Priority**: P0 — THE Differentiator
**Track**: A (Agent)
**Assignee**: Builder
**Sources**: GPT, Grok, Google

### Description
Visible reasoning states for AI agents. When an agent is working, users see its current phase: Planning → Searching → Coding → Reviewing. This is the "viral screenshot" feature — it makes agents feel alive, not stuck. Solves the "is it stuck?" anxiety that kills developer trust.

Show a compact event rail under a streaming message with safe, high-level stages — even if the agent doesn't reveal chain-of-thought internally.

### Acceptance Criteria
- [ ] Define `thinking_state` protocol events in PROTOCOL.md (`{messageId, state, label}`)
- [ ] Go proxy emits thinking state changes during multi-step agent execution
- [ ] States flow through same pipeline as tokens: Go → Redis → Gateway → WebSocket → Client
- [ ] Client renders thinking state as status indicator on streaming message
- [ ] States are customizable per bot (configurable `thinkingSteps` array in bot config)
- [ ] Thinking timeline persists with message for replay
- [ ] At minimum: "Planning", "Searching", "Drafting", "Finalizing" states

### Notes
Simplest V1: bot config includes a `thinkingSteps` array, and the proxy emits state transitions at defined points in the execution flow. More sophisticated agent-driven states come with MCP tools.

---

## TASK-0012: Multi-Stream in One Channel ⭐

**Status**: DONE
**Priority**: P0 — THE Differentiator
**Track**: A (Agent)
**Assignee**: Builder
**Sources**: Perplexity, Grok

### Description
Multiple agents streaming simultaneously in the same channel. The visual proof that this isn't just another chat app. "Air traffic control for agents."

### Acceptance Criteria
- [ ] Multiple bots can be assigned to a channel (not just one default)
- [ ] A single user message can trigger multiple bots simultaneously
- [ ] Multiple `stream_start` → `stream_token` → `stream_complete` flows run in parallel
- [ ] Client renders multiple active streams without cross-talk
- [ ] `requestAnimationFrame` batching handles multiple concurrent token flows (`Map<messageId, string>`)
- [ ] Each stream maintains its own token buffer and index sequence
- [ ] Completion/error of one stream does not affect others

---

## TASK-0013: Provider Abstraction with Transport Strategies

**Status**: DONE
**Priority**: P0 — Core Infrastructure
**Track**: A (Agent)
**Assignee**: Builder
**Source**: Architecture review (DEC-0024)

### Description
Refactor Go proxy to abstract both API format and transport per provider. Each provider gets a transport strategy interface.

### Acceptance Criteria
- [ ] Provider interface: `Stream(config, messages) → chan TokenEvent`
- [ ] Transport strategies: HTTP SSE (OpenAI, Anthropic), OpenAI-compatible (Ollama, OpenRouter)
- [ ] Adding a new provider = implement format adapter + transport adapter
- [ ] Existing streaming tests pass with new abstraction
- [ ] BYOK validated for: OpenAI, Anthropic, Ollama, OpenRouter
- [ ] Provider registry documented in STREAMING.md

---

## TASK-0014: Message Edit & Delete

**Status**: DONE
**Priority**: P0 — Launch
**Track**: B (Chat)
**Assignee**: Builder
**Spec**: V1-IMPLEMENTATION.md

### Description
Edit own messages, delete own or admin-delete. Real-time broadcast.

### Acceptance Criteria
- [x] User can edit own messages (content update, `editedAt` timestamp)
- [x] User can delete own messages (soft delete)
- [x] Admins with MANAGE_MESSAGES can delete any message
- [x] Edit/delete events broadcast via WebSocket
- [x] Client updates in place
- [x] "(edited)" indicator on edited messages
- [x] Streaming messages (ACTIVE) cannot be edited
- [x] Protocol events added to PROTOCOL.md

---

## TASK-0015: @Mentions with Autocomplete

**Status**: DONE
**Priority**: P1 — Launch
**Track**: B (Chat)
**Assignee**: Builder
**Spec**: V1-IMPLEMENTATION.md

### Description
@mention users and bots with autocomplete dropdown. Mentions trigger bot responses when triggerMode=MENTION.

### Current State
Complete. Core mention UX shipped in V0 (autocomplete, rendering, bot trigger-on-mention). V1 added mention persistence via `MessageMention` join table and mention counting for unread badges.

### Acceptance Criteria
- [x] Typing `@` opens autocomplete dropdown
- [x] Dropdown shows matching users and bots in channel
- [x] Selected mention inserts formatted mention text
- [x] Mentions render as highlighted pills in messages
- [x] Bot @mentions trigger bot response
- [x] Mentioned users stored in `MessageMention` join table

---

## TASK-0016: Unread Indicators

**Status**: DONE
**Priority**: P0 — Launch
**Track**: B (Chat)
**Assignee**: Builder
**Spec**: V1-IMPLEMENTATION.md

### Description
Track what users have read. Bold unread channels, red mention badges, new-message divider.

### Acceptance Criteria
- [x] `ChannelReadState` model tracking `lastReadSeq` and `mentionCount`
- [x] Channels with unread messages display bold in sidebar
- [x] Channels with mentions show red badge with count
- [x] Server icons show unread dot
- [x] Navigating to channel marks it as read
- [x] "New messages" divider in message history
- [x] State persists across refreshes
- [x] State syncs across tabs

---

## TASK-0037: Agent Self-Registration + Gateway Auth

**Status**: DONE
**Priority**: P0 — Agent-First Launch
**Track**: A (Agent)
**Assignee**: Builder
**Decision**: DEC-0040

### Description
Agents register themselves via API and connect via WebSocket without any human configuring them through a UI. Creates the foundation for the Python SDK and typed messages.

### Acceptance Criteria
- [x] `AgentRegistration` model in Prisma schema (1:1 with Bot)
- [x] `POST /api/v1/agents/register` — creates Bot + AgentRegistration, returns `sk-tvk-...` API key
- [x] `GET /api/v1/agents/{id}` — agent info (public, no auth)
- [x] `PATCH /api/v1/agents/{id}` — update capabilities/URLs (Bearer auth)
- [x] `DELETE /api/v1/agents/{id}` — deregister with cascade (Bearer auth)
- [x] `GET /api/internal/agents/verify` — Gateway verification (internal secret auth)
- [x] Gateway dual auth: `?token=<JWT>` for humans, `?api_key=sk-tvk-...` for agents
- [x] SHA-256 API key hashing for indexed lookup
- [x] Agent connects via WebSocket, joins channel, appears in presence
- [x] All existing bot/streaming infrastructure works unchanged
- [x] 43 agent handler tests passing (161 total)
- [x] PROTOCOL.md updated (v1.8), DECISIONS.md updated (DEC-0040)

---

## TASK-0038: Python SDK + Agent-Originated Streaming

**Status**: DONE
**Priority**: P0 — Agent-First Launch
**Track**: A (Agent)
**Assignee**: Builder
**Decision**: DEC-0041

### Description
Python SDK (`tavok-sdk`) that lets developers build AI agents in 10 lines of code with token streaming. Added agent-originated streaming event handlers to Gateway so SDK agents can stream tokens directly via WebSocket channel pushes.

### Acceptance Criteria
- [x] `sdk/python/` package with `pyproject.toml`, installable via `pip install -e .`
- [x] `Agent` class with `@on_mention`, `@on_message` decorators
- [x] `StreamContext` async context manager (`token()`, `status()`, `finish()`, `error()`)
- [x] `PhoenixSocket` speaking Phoenix Channel V2 wire protocol
- [x] Auto-registration via `POST /api/v1/agents/register`
- [x] Reconnect with exponential backoff (1s → 30s)
- [x] Gateway `room_channel.ex` handles `stream_start/token/complete/error/thinking` from BOT connections
- [x] Example agents: echo, LLM streaming, multi-agent
- [x] 5 SDK E2E tests passing (`make test-sdk`)
- [x] `make test-web` (161 tests), `make test-sdk` (5 tests), `make test-all` targets added
- [x] PROTOCOL.md updated (v1.9), DECISIONS.md updated (DEC-0041)

---

## TASK-0039: Typed Messages + Metadata

**Status**: DONE
**Priority**: P0 — Agent-First Launch
**Track**: A (Agent)
**Assignee**: Builder
**Decision**: DEC-0042

### Description
Structured message types for agent output (tool calls, code blocks, artifacts, status) and execution metadata (model, tokens, latency) on completed agent messages. Makes agent output beautiful and informative instead of text blobs.

### Acceptance Criteria
- [x] `MessageType` enum extended with `TOOL_CALL`, `TOOL_RESULT`, `CODE_BLOCK`, `ARTIFACT`, `STATUS`
- [x] `metadata Json?` field on Message model for agent execution info
- [x] Shared TypeScript type definitions (`packages/shared/types/typed-messages.ts`)
- [x] Gateway `typed_message` event handler (BOT-only, validates type, generates ULID/sequence, broadcasts, persists)
- [x] Gateway `stream_complete` passes metadata through to persistence
- [x] Internal API endpoints persist and return metadata
- [x] Frontend `TypedMessageRenderer` dispatches to card components based on type
- [x] `ToolCallCard` — collapsible card with tool name, arguments, status indicator
- [x] `ToolResultCard` — result card with success/error styling, duration
- [x] `CodeBlockMessage` — syntax highlighted code with copy button
- [x] `ArtifactRenderer` — sandboxed iframe for HTML/SVG
- [x] `StatusIndicator` — inline status with state icons
- [x] `MessageMetadata` — collapsible bar showing model · tokens · latency
- [x] Python SDK `StreamContext` extended with `tool_call()`, `tool_result()`, `code()`, `artifact()`
- [x] PROTOCOL.md updated (v2.0), DECISIONS.md updated (DEC-0042)

---

## TASK-0017: README & Demo (Launch Prep)

**Status**: DONE
**Priority**: P0 — Launch Gate
**Track**: Launch
**Assignee**: Builder + Strategist
**Decision**: DEC-0043

### Description
Create the killer README, demo GIF, and quickstart experience. The README IS the product page. License changed from AGPL-3.0 to MIT. All branding finalized as Tavok.

### Acceptance Criteria
- [x] README with architecture diagram, feature list, clear value prop
- [x] Hero section with SDK code snippet showing the "holy shit" moment
- [x] "Get Started in 60 Seconds" quickstart section
- [x] Feature comparison table (Tavok vs Discord vs Slack vs agent frameworks)
- [x] SDK quick reference (Agent, StreamContext, multi-agent)
- [x] Multi-agent demo section with docker-compose.demo.yml
- [x] Self-hosting production guide (Caddy + manual setup)
- [x] Contributing section
- [x] License changed from AGPL-3.0 to MIT
- [x] All branding references updated (HiveChat → Tavok in setup.sh)
- [x] Agent presence indicators enhanced (agent badges, model labels, streaming pulse)
- [x] Message history skeleton loading states
- [x] SDK Dockerfile for containerized agent runners
- [x] `make demo` target added
- [ ] Demo GIF/video showing agents streaming in a channel (content capture pending)
- [ ] Launch posts drafted: r/selfhosted, HN "Show HN", X/Twitter

---

# V1 — WAVE 1 (Sprint Cycles 1-2 post-launch)

## TASK-0018: MCP-Compatible Tool Interface

**Status**: DONE
**Priority**: P1 — Architecture
**Track**: A (Agent)
**Assignee**: Builder
**Source**: DEC-0022, Google protocol analysis

### Description
Go proxy tool abstraction matching MCP `tools/list` and `tools/call` patterns. Makes MCP hosting a natural extension.

### Acceptance Criteria
- [ ] Tool interface in `streaming/internal/tools/` with `tools/list` + `tools/call` patterns
- [ ] Each tool: name, description, JSON Schema input definition
- [ ] At least one built-in tool (web search or current time)
- [ ] Agent can invoke tools mid-stream
- [ ] Tool results fed back into agent context for continued generation
- [ ] Extension points documented for future MCP hosting

---

## TASK-0019: Direct Messages

**Status**: DONE
**Priority**: P1
**Track**: B (Chat)
**Assignee**: Builder
**Spec**: V1-IMPLEMENTATION.md
**Decision**: DEC-0049

### Description
Private conversations between users. DM sidebar, real-time via WebSocket.

### Acceptance Criteria
- [x] User can start DM with any user they share a server with
- [x] DM messages persist and load history
- [x] Real-time via WebSocket (`DmChannel`)
- [x] Edit and delete work in DMs
- [x] Typing indicator works
- [x] DM list in sidebar with last message preview
- [ ] Unread DM indicators (deferred — requires TASK-0016 extension)

---

## TASK-0020: Channel Charter / Swarm Modes ⭐

**Status**: DONE
**Priority**: P1 — Core Innovation
**Track**: A (Agent)
**Assignee**: Builder
**Sources**: Grok Phase 2, GPT

### Description
Human-defined rules for multi-agent collaboration, enforced by the Go orchestrator. The channel owner dictates how agents behave — swarm modes with structure, not chaos.

**Scheduling**: moved to Wave 2 to keep early post-launch execution focused on MCP tools, DMs, and stream rewind foundation.

### Acceptance Criteria
- [x] Swarm Settings tab in Edit Channel (2-click setup)
- [x] Mode presets: Human-in-the-Loop (default), Lead Agent, Round-Robin, Structured Debate, Code Review Sprint, Freeform, Custom
- [x] Charter textarea with goal, rules, agent order, max turns
- [x] Go orchestrator enforces charter: turn tracking, loop detection, auto-pause
- [x] Human override: pause/end buttons in channel header, charter_control WebSocket event
- [x] Live channel header: `Mode: Round Robin • Turn 3/8 | [Pause] [End]`
- [ ] Agent messages show role badges (deferred — requires message-level bot order tracking)

### Design Notes
Study Google A2A "Agent Card" spec for bot capability registration pattern. Each bot could register capabilities on channel join for intelligent task routing. Don't implement full A2A — borrow the discovery pattern.

---

## TASK-0021: Stream Rewind + Checkpoints + Resume

**Status**: TODO
**Priority**: P1 — Category-Defining
**Track**: A (Agent)
**Assignee**: Builder
**Source**: GPT ("maximum wow, minimum scope creep")

### Description
Replay a thought process. Scrub slider on streaming messages replays tokens 0→N. Agent checkpoints allow resume from a different provider/model after errors.

### Acceptance Criteria
- [ ] Completed streaming messages show a rewind scrub slider
- [ ] Slider replays tokens from index 0 → N at 1x/2x speed
- [ ] Agent can emit checkpoint events ("Plan locked", "Context summarized")
- [ ] On stream error or rate limit, user can "Resume from checkpoint" with different model
- [ ] Checkpoint data persists with message
- [ ] UI shows checkpoint markers on the timeline

---

# V1 — WAVE 2 (Sprint Cycles 3-4 post-launch)

## TASK-0022: Message Search

**Status**: TODO
**Priority**: P1
**Track**: B (Chat)
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [ ] PostgreSQL full-text search across all messages
- [ ] Search panel with filters (channel, user, date, has: file/link/mention)
- [ ] Results highlight matches, click jumps to message
- [ ] < 500ms for typical queries
- [ ] DM search

---

## TASK-0023: Server Settings UI

**Status**: TODO
**Priority**: P1
**Track**: B (Chat)
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [ ] `/servers/{serverId}/settings` with sidebar sections
- [ ] Overview, Channels, Roles, Members, Bots, Invites, Danger Zone
- [ ] Permission-gated per section
- [ ] Inline editing

---

## TASK-0024: User Profile & Settings

**Status**: TODO
**Priority**: P1
**Track**: B (Chat)
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [ ] User settings: profile, account, appearance
- [ ] Profile card popup on username click
- [ ] Avatar upload and display
- [ ] Password change (requires current)

---

## TASK-0025: File & Image Uploads

**Status**: IN PROGRESS
**Priority**: P1
**Track**: B (Chat)
**Spec**: V1-IMPLEMENTATION.md

### Current State
Baseline uploads shipped in V0 (attachment model, upload/download API, paperclip upload, inline image/file rendering). Remaining V1 work: drag-and-drop, clipboard paste, progress UX, and richer metadata/dimensions handling.

### Acceptance Criteria
- [ ] Upload via button, drag-and-drop, clipboard paste
- [x] Images render inline, files render as download cards
- [ ] 10MB limit (configurable), progress indicator
- [ ] Persist via Docker volume

---

## TASK-0026: JSON Schema Cross-Service Contracts

**Status**: TODO
**Priority**: P2 — Infrastructure
**Track**: Infra
**Source**: DEC-0021

### Acceptance Criteria
- [ ] JSON Schema files in `packages/shared/schemas/` for all PROTOCOL.md payloads
- [ ] Validation: TS (ajv), Go (gojsonschema), Elixir (ex_json_schema)
- [ ] CI check on contract changes
- [ ] PROTOCOL.md references schemas

---

## TASK-0027: gRPC/Protobuf Internal Comms

**Status**: TODO
**Priority**: P2 — Infrastructure
**Track**: Infra
**Source**: Architecture review

### Acceptance Criteria
- [ ] Protobuf definitions for Go ↔ Elixir hot-path messages
- [ ] gRPC service replacing HTTP internal calls on stream events
- [ ] Measure token-to-screen latency before/after
- [ ] HTTP remains as fallback for non-hot-path calls

---

# V1 — WAVE 3 (Sprint Cycles 5-6 post-launch)

## TASK-0028: Agent Memory Layer (pgvector)

**Status**: TODO
**Priority**: P1
**Track**: A (Agent)
**Sources**: Grok Phase 3, DEC-0020

### Acceptance Criteria
- [ ] `CREATE EXTENSION vector` in Postgres init
- [ ] Memory table with embedding column
- [ ] Abstract memory interface (pgvector default, Qdrant/Pinecone optional)
- [ ] Per-user, per-agent, per-channel memory scopes
- [ ] Auto-summarization for long-term recall

---

## TASK-0029: Notification System

**Status**: TODO
**Priority**: P1
**Track**: B (Chat)
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [ ] Notifications for: @mentions, DMs, invites, role changes
- [ ] Bell icon + badge count + dropdown panel
- [ ] Click navigates to source
- [ ] Real-time via WebSocket
- [ ] Browser notifications when tab unfocused

---

## TASK-0030: Emoji Reactions

**Status**: IN PROGRESS
**Priority**: P2
**Track**: B (Chat)
**Spec**: V1-IMPLEMENTATION.md

### Current State
Baseline reactions shipped in V0 (Reaction model, API, emoji picker, optimistic toggles). Remaining V1 work is real-time reaction broadcast and broader emoji set/UX polish.

### Acceptance Criteria
- [x] Add/remove reactions (emoji picker, baseline set)
- [x] Reaction pills below messages with counts
- [x] Toggle on click, hover shows reactors
- [ ] Real-time broadcast

---

## TASK-0031: X-Ray Observability Toggle

**Status**: TODO
**Priority**: P1
**Track**: A (Agent)
**Source**: Google market analysis

### Description
Expandable "X-Ray" panel on any agent message showing execution details. Lite version (model + tokens + latency) free. Full version (prompts, payloads, traces) becomes paid-tier dashboard.

### Acceptance Criteria
- [ ] Toggle button on agent messages opens observability panel
- [ ] Lite view (free): model name, token count (in/out), TTFT, total latency
- [ ] Data captured during stream execution and persisted with message
- [ ] Foundation laid for full observability dashboard (paid tier: raw prompts, API payloads, cost)

---

## TASK-0032: Branching Conversations

**Status**: TODO
**Priority**: P2
**Track**: A (Agent)
**Source**: GPT feature ideation

### Description
"Fork from here" creates a new channel with last N context messages + agent state + new goal prompt.

### Acceptance Criteria
- [ ] "Fork" action on any message
- [ ] Creates new channel with context messages copied
- [ ] Agent state snapshot included (if available from checkpoints)
- [ ] New goal prompt input on fork
- [ ] Link back to source message

---

# SELF-HOSTING & DEPLOY (parallel — ship when ready)

## TASK-0033: Caddy HTTPS

**Status**: DONE
**Priority**: P1
**Track**: Deploy
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [x] `docker-compose.prod.yml` with Caddy, auto HTTPS
- [x] WebSocket upgrade through Caddy
- [x] HTTP → HTTPS redirect

---

## TASK-0034: Admin Dashboard

**Status**: TODO
**Priority**: P2
**Track**: Deploy
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [ ] `/admin` with stats, user/server management, system health
- [ ] Non-admin blocked

---

## TASK-0035: Data Export

**Status**: TODO
**Priority**: P2
**Track**: Deploy
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [ ] Server, user, and admin exports as JSON
- [ ] No secrets in exports
- [ ] GDPR compliance

---

## TASK-0036: Mobile Responsive Polish

**Status**: TODO
**Priority**: P1
**Track**: Deploy
**Spec**: V1-IMPLEMENTATION.md

### Acceptance Criteria
- [ ] Single-column mobile layout with slide-out sidebars
- [ ] All features work on mobile
- [ ] 44px+ touch targets, no horizontal scroll

---

# Summary — Full Task List

| Task | Wave | Track | Priority | Description | Status |
|------|------|-------|----------|-------------|--------|
| 0001-0010 | V0 | — | — | Foundation through Reactions + Uploads | ✅ DONE |
| **0011** | **Launch** | **Agent** | **P0** | **Agent Thinking Timeline** ⭐ | DONE |
| **0012** | **Launch** | **Agent** | **P0** | **Multi-Stream in One Channel** ⭐ | DONE |
| **0013** | **Launch** | **Agent** | **P0** | **Provider Abstraction + Transport** | DONE |
| **0014** | **Launch** | **Chat** | **P0** | **Message Edit & Delete** | DONE |
| **0015** | **Launch** | **Chat** | **P1** | **@Mentions with Autocomplete** | DONE |
| **0016** | **Launch** | **Chat** | **P0** | **Unread Indicators** | DONE |
| **0017** | **Launch** | **Launch** | **P0** | **README + Demo + Polish + MIT License** | ✅ DONE |
| 0018 | Wave 1 | Agent | P1 | MCP Tool Interface | DONE |
| 0019 | Wave 1 | Chat | P1 | Direct Messages | DONE |
| 0020 | Wave 2 | Agent | P1 | Channel Charter / Swarm Modes ⭐ | DONE |
| 0021 | Wave 1 | Agent | P1 | Stream Rewind + Checkpoints + Resume | TODO |
| 0022 | Wave 2 | Chat | P1 | Message Search | TODO |
| 0023 | Wave 2 | Chat | P1 | Server Settings UI | TODO |
| 0024 | Wave 2 | Chat | P1 | User Profile & Settings | TODO |
| 0025 | Wave 2 | Chat | P1 | File & Image Uploads | IN PROGRESS |
| 0026 | Wave 2 | Infra | P2 | JSON Schema Contracts | TODO |
| 0027 | Wave 2 | Infra | P2 | gRPC/Protobuf Internal Comms | TODO |
| 0028 | Wave 3 | Agent | P1 | Agent Memory (pgvector) | TODO |
| 0029 | Wave 3 | Chat | P1 | Notification System | TODO |
| 0030 | Wave 3 | Chat | P2 | Emoji Reactions | IN PROGRESS |
| 0031 | Wave 3 | Agent | P1 | X-Ray Observability | TODO |
| 0032 | Wave 3 | Agent | P2 | Branching Conversations | TODO |
| **0037** | **Launch** | **Agent** | **P0** | **Agent Self-Registration + Gateway Auth** | ✅ DONE |
| **0038** | **Launch** | **Agent** | **P0** | **Python SDK + Agent-Originated Streaming** | ✅ DONE |
| **0039** | **Launch** | **Agent** | **P0** | **Typed Messages + Metadata** | ✅ DONE |
| 0033 | Deploy | Deploy | P1 | Caddy HTTPS | ✅ DONE |
| 0034 | Deploy | Deploy | P2 | Admin Dashboard | TODO |
| 0035 | Deploy | Deploy | P2 | Data Export | TODO |
| 0036 | Deploy | Deploy | P1 | Mobile Responsive | TODO |

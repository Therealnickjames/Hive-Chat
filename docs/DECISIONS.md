# DECISIONS.md — Architectural Decision Log

> Append-only. Never edit or delete existing entries.
> When you make a meaningful tradeoff, log it here so future agents and contributors know WHY.

---

## DEC-0001 — Three-service split: Web + Gateway + Streaming Proxy

**Date**: 2026-02-23
**Status**: Accepted
**Context**: HiveChat needs a product layer (UI, auth, DB), a real-time layer (WebSocket, presence, fan-out), and an AI streaming layer (LLM API calls, token parsing). These are fundamentally different workloads with different performance characteristics.
**Decision**: Split into three services:
- **Web** (TypeScript/Next.js): Product UI, auth, REST API, DB via Prisma
- **Gateway** (Elixir/Phoenix): WebSocket connections, presence, typing, message fan-out
- **Streaming Proxy** (Go): LLM API calls, SSE streaming, token parsing, bot config

**Rationale**: Each language excels at its job. TypeScript for rapid UI development and the Node.js ecosystem. Elixir/BEAM for millions of concurrent lightweight processes (proven by Discord, WhatsApp). Go for efficient concurrent I/O with goroutines (one per LLM stream). Zero overlap means clear ownership and independent scaling.
**Consequences**: Three Dockerfiles, inter-service communication complexity, need for strict protocol contracts (PROTOCOL.md).

---

## DEC-0002 — Elixir over raw Erlang for the Gateway

**Date**: 2026-02-23
**Status**: Accepted
**Context**: The original spec called for Erlang/OTP. Both run on the same BEAM VM with identical runtime characteristics.
**Decision**: Use Elixir instead of raw Erlang.
**Rationale**:
- Phoenix Channels provides production-grade WebSocket handling with presence tracking built-in
- Phoenix.Presence gives us distributed presence with conflict-free replicated data types (CRDTs)
- 10x larger community, better tooling (Mix, Hex), better documentation
- Elixir syntax is more readable for collaborators
- Every Erlang/OTP library is callable from Elixir
- The product owner is not a programmer — Elixir reads closer to English than Erlang's Prolog-derived syntax

**Consequences**: Need Elixir toolchain in Docker. Use Phoenix framework (but no Ecto — Prisma handles DB).

---

## DEC-0003 — JWT for cross-service authentication

**Date**: 2026-02-23
**Status**: Accepted
**Context**: The Gateway needs to verify that WebSocket connections come from authenticated users. Options: JWT validation, Redis session lookup, or callback to Next.js.
**Decision**: JWT-based auth. NextAuth issues JWTs signed with a shared secret. Gateway validates the signature locally.
**Rationale**: No network round-trip on every WebSocket connect. Gateway only needs the shared `JWT_SECRET` to verify tokens. Stateless — scales horizontally without shared session stores. Standard approach for multi-service architectures.
**Consequences**: Shared `JWT_SECRET` between Next.js and Gateway. Token refresh handled client-side via NextAuth. 24h expiry with automatic refresh.

---

## DEC-0004 — ULIDs for all primary keys

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Need globally unique IDs. Options: UUID v4 (random), ULID (time-sortable), CUID, auto-increment.
**Decision**: ULID (Universally Unique Lexicographically Sortable Identifier) for all primary keys.
**Rationale**:
- Time-sortable: natural ordering without a separate `createdAt` sort
- 26-character string: compact, URL-safe
- Globally unique: safe for distributed ID generation
- Index-friendly: B-tree indexes work efficiently with lexicographic ordering
- Message table indexed on `(channelId, id)` gives us time-sorted queries without a separate timestamp index

**Consequences**: Generated in application code (not database). Use `ulid` npm package in TypeScript, equivalent in Elixir/Go. Stored as `VARCHAR(26)` in PostgreSQL.

---

## DEC-0005 — Redis INCR for per-channel sequence numbers

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Need per-channel monotonically increasing sequence numbers for message ordering and reconnection sync.
**Decision**: Use Redis `INCR` on key `hive:channel:{channelId}:seq` to assign sequence numbers atomically.
**Rationale**: Atomic, single-operation, microsecond latency. No locking, no race conditions. Redis is already in the stack for pub/sub. Sequence numbers are ephemeral metadata — if Redis restarts, we can reconstruct from the max sequence in PostgreSQL.
**Consequences**: Gateway calls `INCR` before persisting each message. On Redis restart, Gateway must seed sequence from `SELECT MAX(sequence) FROM messages WHERE channelId = ?`.

---

## DEC-0006 — Phoenix Channels wire protocol for WebSocket

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Need a WebSocket protocol for client-gateway communication. Options: custom JSON protocol, Socket.IO, Phoenix Channels.
**Decision**: Use Phoenix Channels native wire protocol with the `phoenix` npm package on the client.
**Rationale**:
- Battle-tested: millions of production connections
- Built-in reconnection with exponential backoff
- Channel multiplexing over a single socket
- Request-reply semantics (ref-based correlation)
- Phoenix.Presence for distributed presence tracking (CRDTs)
- Heartbeat/keepalive handled automatically

**Consequences**: Client uses `phoenix` npm package. Wire format is `[join_ref, ref, topic, event, payload]`. All event names and payloads defined in PROTOCOL.md.

---

## DEC-0007 — All three services from day 1

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Could build Next.js first with a temporary Node.js WebSocket server, then replace with Elixir later. Or scaffold all three services immediately.
**Decision**: Scaffold all three services from day 1. Architecture honest from the start.
**Rationale**: Option B (temporary Node.js WS) creates throwaway code and teaches bad habits. The inter-service contracts need to be exercised immediately to catch design issues early. Longer ramp to first visible UI, but no technical debt from day one.
**Consequences**: More complex initial setup. Docker Compose required from the start. Higher bar for "hello world" but cleaner foundation.

---

## DEC-0008 — NextAuth v4 with CredentialsProvider

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Need authentication for the web frontend. Options: NextAuth v5, NextAuth v4, custom JWT.
**Decision**: NextAuth v4 with CredentialsProvider (email/password) and JWT session strategy.
**Rationale**: v4 is stable and widely documented. JWT strategy (not database sessions) means the JWT can be validated by the Gateway without session lookups. CredentialsProvider handles the custom email/password flow. Custom callbacks inject `username` and `displayName` into the JWT claims for cross-service use.
**Consequences**: Custom type extensions for NextAuth (`next-auth.d.ts`). JWT claims match PROTOCOL.md §6. NEXTAUTH_SECRET must equal JWT_SECRET for Gateway validation.

---

## DEC-0009 — Bandit over Cowboy for Phoenix HTTP adapter

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Phoenix 1.8 defaults to Cowboy2Adapter but the dependency we have is Bandit. Attempting to start with Cowboy fails (`Plug.Cowboy.child_spec/1 is undefined`).
**Decision**: Explicitly configure `adapter: Bandit.PhoenixAdapter` in the endpoint config.
**Rationale**: Bandit is a pure Elixir HTTP server — simpler dependency tree (no C NIFs), better alignment with the BEAM philosophy. Phoenix 1.8 supports it as a first-class option.
**Consequences**: Must set adapter explicitly in `runtime.exs`. Runtime Alpine version must match build Alpine for OpenSSL compatibility (both Alpine 3.22).

---

## DEC-0010 — Health check uses 127.0.0.1 instead of localhost in Docker

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Docker health check for web service used `wget -qO- http://localhost:3000/api/health` but always returned "Connection refused" even though the server was listening on `0.0.0.0:3000`.
**Decision**: Use `127.0.0.1` explicitly instead of `localhost` in all Docker health checks.
**Rationale**: Alpine Linux resolves `localhost` to `::1` (IPv6) first. Next.js standalone server only binds to `0.0.0.0` (IPv4). Using `127.0.0.1` explicitly bypasses the IPv6 resolution and connects to the correct address.
**Consequences**: All health check URLs in docker-compose.yml use `127.0.0.1` instead of `localhost`.

---

## DEC-0011 — Persist-first message pipeline

**Date**: 2026-02-23
**Status**: Accepted
**Context**: When a user sends a message, the Gateway could either broadcast immediately and persist asynchronously, or persist first then broadcast.
**Decision**: Persist-first — Gateway calls Next.js internal API to write the message to PostgreSQL before broadcasting to other clients.
**Rationale**: Reliability over speed. A message that was broadcast but failed to persist would appear in real-time but vanish on refresh. Persist-first guarantees that any message visible in real-time is also in the database. Latency increase is minimal (~10ms for internal API call on the Docker network).
**Consequences**: Gateway depends on Next.js internal API being available. Uses `Req` HTTP client in Elixir. Message broadcast is atomic with persistence success.

---

## DEC-0012 — Phoenix Presence integrated into useChannel hook

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Presence tracking could be a separate React hook (`usePresence`) or integrated into the channel subscription hook.
**Decision**: Integrate presence tracking directly into `useChannel` hook, which returns a `presenceMap` alongside messages and typing indicators.
**Rationale**: Presence is scoped to a channel — when you join a channel, you get presence for that channel. Keeping it in one hook means one subscription lifecycle, one cleanup, one source of truth. The channel page component passes `presenceMap` to the MemberList component.
**Consequences**: `useChannel` returns more data but has a single lifecycle. MemberList receives presenceMap as a prop and splits members into online/offline groups.

---

## DEC-0013 — AES-256-GCM for bot API key encryption at rest

**Date**: 2026-02-23
**Status**: Accepted
**Context**: Bot API keys must be stored securely in the database. Options: plaintext (bad), hashing (can't recover for API calls), symmetric encryption.
**Decision**: AES-256-GCM encryption using Node.js built-in `crypto` module. Stored as `iv:authTag:ciphertext` (hex-encoded). Key from `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes).
**Rationale**: AES-256-GCM provides both confidentiality and authenticity. GCM mode means tampered ciphertext is detected on decryption. Node.js crypto is built-in (no extra dependencies). Keys are only decrypted in internal API responses (never in user-facing APIs).
**Consequences**: `ENCRYPTION_KEY` required in environment. Key rotation requires re-encrypting all bot keys. Internal API endpoints (`/api/internal/bots/{id}`, `/api/internal/channels/{id}/bot`) return decrypted keys over the Docker internal network only.

---

## DEC-0014 — requestAnimationFrame batching for token rendering

**Date**: 2026-02-23
**Status**: Accepted
**Context**: LLM APIs can send tokens at 50-100+ per second. Naively updating React state on every token causes excessive re-renders and UI jank.
**Decision**: Accumulate incoming tokens in a ref-based buffer and flush to React state via `requestAnimationFrame`. This caps UI updates at 60fps regardless of token rate.
**Rationale**: rAF naturally aligns with the browser's paint cycle. Tokens arrive faster than the eye can perceive them individually, so batching 2-5 tokens into a single render is visually imperceptible. This eliminates the performance cliff that occurs at high token rates.
**Consequences**: Token buffer stored in a `Map<messageId, string>` ref. Each rAF frame flushes accumulated tokens for all active streams. No visible latency even at 100+ tokens/second.

---

## DEC-0015 — Go stdlib for HTTP and SSE parsing

**Date**: 2026-02-23
**Status**: Accepted
**Context**: The Go streaming proxy needs to make HTTP requests to LLM APIs and parse SSE responses. Options: third-party libraries (go-sse, etc.) or stdlib.
**Decision**: Use Go stdlib only (`net/http`, `bufio`, `encoding/json`). Custom SSE parser in `internal/sse/parser.go`.
**Rationale**: SSE is a simple line-based protocol — parsing it is ~70 lines of code. Using stdlib means zero external dependencies beyond `go-redis`. The Go binary stays small (~8MB). No dependency supply chain risk for a security-critical component (it handles API keys).
**Consequences**: SSE parser handles both OpenAI format (`data: [DONE]` termination) and Anthropic format (`event: content_block_delta`). Provider registry maps `llmProvider` to the correct parser. Only dependency: `github.com/redis/go-redis/v9`.

---

## DEC-0016 — Socket auth failures return transport-level close only

**Date**: 2026-02-25
**Status**: Accepted
**Context**: `PROTOCOL.md` stated that failed WebSocket authentication returns `{reason: "unauthorized"}`. In Phoenix `UserSocket.connect/3`, returning `:error` rejects the handshake without a custom payload.
**Decision**: Keep auth rejection in `UserSocket.connect/3` as `:error` and document the real behavior as a transport-level close with no structured payload.
**Rationale**: This preserves secure fail-closed behavior with the framework-default handshake path and avoids introducing custom transport logic solely to shape an error payload.
**Consequences**: Clients must treat connect failures as unauthorized based on close outcome and logs, not a JSON reason payload at socket connect time.

---

## DEC-0017 — Gateway-side stream watchdog for terminal event reliability

**Date**: 2026-02-25
**Status**: Accepted
**Context**: Redis pub/sub is fire-and-forget. If the Gateway's subscription connection
experiences a transient disconnect while the Go Proxy publishes a terminal status event,
the message is permanently lost. Clients see streams stuck in ACTIVE state until refresh.
**Decision**: Add a Gateway-side watchdog that polls the DB as a fallback when no terminal
event arrives via Redis within 45 seconds of stream_start.
**Rationale**: Defense-in-depth. The Go Proxy correctly publishes and persists. The issue
is transport reliability between Redis pub/sub and the Gateway subscriber. The watchdog
makes the system self-healing without changing the primary delivery path or switching
message brokers.
**Consequences**: Adds one GenServer to the Gateway supervision tree. Worst case adds
one internal API call per stream (only when Redis delivery fails). Does not affect
happy-path latency.

---

## DEC-0018 — Two-layer terminal state convergence

**Date**: 2026-02-26
**Status**: Accepted
**Context**: Infrastructure failure testing (F-02, F-05, F-06) revealed that streaming
messages could stay ACTIVE in the database indefinitely. The Go Proxy publishes
terminal status to Redis (clients see it via WebSocket), then persists to DB via
HTTP. If the HTTP call fails, clients see the response but it vanishes on page
refresh. The watchdog only handled COMPLETE/ERROR states from DB and would retry
forever on ACTIVE.
**Decision**: Implement two-layer convergence:

1. Go Proxy retries FinalizeMessage 3 times with exponential backoff (1s/2s/4s).
   Catches transient web outages lasting up to ~7 seconds.
2. Gateway watchdog tracks retry count per stream. After 5 consecutive ACTIVE
   checks (225 seconds at 45s intervals), forces DB to ERROR via PUT and
   broadcasts synthetic stream_error. Catches prolonged outages and dead proxies.

**Consequences:**

- No streaming message can stay ACTIVE indefinitely - guaranteed convergence.
- Worst case recovery time: ~4 minutes (5 watchdog cycles). Acceptable for an
  infrastructure failure scenario.
- The watchdog now makes write calls (PUT) to the web service, not just reads.
  This is a new dependency direction but justified by the safety-net role.

---

## DEC-0019 — Go owns orchestration, Elixir owns transport

**Date**: 2026-02-27
**Status**: Accepted
**Context**: As V1 introduces multi-agent swarms, channel charters, and tool execution, orchestration logic needs a clear home. Both Go and Elixir are candidates. Ambiguity between "Go streaming service + lightweight orchestrator" and "Elixir OTP strengths for supervision" risked split-brain — state scattered across two services with no clear owner.
**Decision**: Go Proxy is the orchestrator. All agent decision-making lives in Go: which agent runs next, charter rule evaluation, step sequencing, tool execution, retry logic, checkpoint/resume. Elixir Gateway is pure transport: WebSocket connections, presence, typing indicators, message fan-out. Elixir never makes an orchestration decision.
**Rationale**:
- Orchestration is algorithmic control flow — Go is built for this (deterministic, easy to test, easy to reason about)
- Elixir/Phoenix Channels want to be a broadcast layer, not a workflow engine
- OTP supervision trees are great for keeping connections alive, not for deciding what agents should do
- Clear boundary: Go drives execution, Elixir moves bytes
- Prevents the "second backend" problem where Go and Elixir accumulate overlapping responsibilities

**Consequences**: All swarm/charter/agent-routing logic goes in `streaming/internal/`. Gateway's channel handlers remain thin relay layers. Stream requests flow: Elixir receives trigger → hands to Go → Go drives entire execution → pushes results back through Elixir to clients.

---

## DEC-0020 — pgvector as default memory backend

**Date**: 2026-02-27
**Status**: Accepted
**Context**: V1 will need vector storage for agent long-term memory. Options: pgvector (extension in existing Postgres), Qdrant (separate container), Pinecone (managed SaaS).
**Decision**: pgvector in existing PostgreSQL as the default and only V1 implementation. Design an abstract memory interface so alternative backends can be swapped in later.
**Rationale**:
- One database, one backup strategy, one fewer container for self-hosters
- `docker-compose up` stays simple — no additional infrastructure
- pgvector performance is sufficient for V1 workloads
- Abstract interface allows Qdrant/Pinecone as optional paid-tier adapters later without changing application code

**Consequences**: `CREATE EXTENSION vector` added to Postgres initialization. Memory table with embedding column alongside metadata. Go proxy calls memory interface for store/recall/forget. No separate vector database container in docker-compose.yml.

---

## DEC-0021 — JSON Schema for cross-service contracts (upgrade path to Protobuf)

**Date**: 2026-02-27
**Status**: Accepted
**Context**: PROTOCOL.md defines contracts as documentation. The three services (TypeScript, Go, Elixir) can't share types directly across languages. Need a machine-enforceable contract format that works in all three.
**Decision**: Define cross-service payload contracts as JSON Schema files stored in `packages/shared/schemas/`. Validate in each language: TypeScript (ajv), Go (gojsonschema), Elixir (ex_json_schema). Plan upgrade path to Protobuf for the hot path (Go ↔ Elixir token streaming).
**Rationale**:
- JSON Schema is language-agnostic and validatable in all three languages
- Low adoption cost — contracts are already defined in PROTOCOL.md, just need formalization
- Protobuf upgrade can happen incrementally on the hot path without rewriting everything
- `.proto` files eventually become the machine-enforced version of PROTOCOL.md sections

**Consequences**: `packages/shared/schemas/` becomes the source of truth for payload shapes. PROTOCOL.md still documents semantics and lifecycle, but payload validation is automated. Migration path: JSON Schema now → Protobuf on Go ↔ Elixir hot path → Full gRPC if load demands it.

---

## DEC-0022 — MCP-compatible tool interface in Go

**Date**: 2026-02-27
**Status**: Accepted
**Context**: V1 tools (web search, file ops, git, code execution) need an abstraction layer. The Model Context Protocol (MCP) is becoming an industry standard for tool integration. Options: custom tool interface, or design to match MCP patterns from day one.
**Decision**: Design the Go proxy's tool interface to match MCP's `tools/list` and `tools/call` JSON-RPC patterns. Not a full MCP implementation, but structurally compatible.
**Rationale**:
- MCP hosting is a planned V1 post-launch feature (any MCP-compatible tool plugs into HiveChat)
- Designing tool interfaces to match MCP patterns now makes MCP hosting a natural extension, not a retrofit
- The JSON-RPC format is simple and well-specified
- ~2 extra hours of design work that saves a refactor later
- Forrester predicts 30% of enterprise app vendors will launch MCP servers in 2026

**Consequences**: Tool interface in `streaming/internal/tools/` uses `tools/list` and `tools/call` patterns. Each tool has name, description, and JSON Schema input definition. MCP server hosting can be added by wiring this interface to incoming MCP connections.

---

## DEC-0023 — Three-language stack confirmed (no rewrite)

**Date**: 2026-02-27
**Status**: Accepted
**Context**: Multiple external analyses suggested language changes (rewrite to Rust, add Python for AI libraries, consolidate to one language). Full architecture audit conducted.
**Decision**: Keep the three-language split exactly as-is. TypeScript (Next.js) for web, Elixir (Phoenix) for gateway, Go for streaming/orchestration. No rewrites. No additional languages.
**Rationale**:
- Each language excels at its specific job — this is a strength, not a liability
- Elixir/BEAM is genuinely the best technology for the WebSocket/presence workload (built for telecom, 99.9999% uptime)
- Go is ideal for concurrent I/O and algorithmic orchestration
- Adding Python for AI libraries would add a 4th service, 4th language, and operational complexity for no architectural benefit — the Go proxy calls the same HTTP endpoints Python libraries call
- Adding Rust would require rewriting working code for marginal performance gains on workloads that aren't CPU-bound
- The key to making three languages work is strong contracts (PROTOCOL.md, JSON Schema, eventual Protobuf), not language consolidation

**Consequences**: No language changes. Investment goes into strengthening the boundaries between services (better contracts, gRPC upgrade, JSON Schema validation) rather than collapsing them.

---

## DEC-0024 — Provider abstraction includes transport strategies

**Date**: 2026-02-27
**Status**: Accepted
**Context**: LLM providers use different transports: OpenAI uses HTTP SSE (and is adding WebSocket via Responses API), Anthropic uses HTTP SSE, local models may use gRPC, and Bedrock has its own HTTP patterns. Phase 3 provider abstraction must account for this.
**Decision**: The Go proxy's provider interface abstracts both the API format AND the transport. Each provider gets a transport strategy that implements a common `Stream(config, messages) → channel of TokenEvent` interface.
**Rationale**:
- Abstracting only the API format (payload shape normalization) is insufficient — transport differences affect performance, reconnection behavior, and error handling
- When a provider offers a faster transport (e.g., OpenAI WebSocket), we write a new strategy without rewiring the system
- The rest of the architecture (Elixir, clients) sees only `TokenEvent` and never knows which transport delivered it
- This is the "fastest data flow" play — when better transports appear, we adopt them per-provider

**Consequences**: Provider interface in Go has two layers: format adapter (how to build the request) and transport adapter (how to send/receive). Adding a new provider means implementing both. Adding a new transport to an existing provider means only implementing a new transport adapter.

---

## DEC-0025 — Two-track V1 development (agent wedge + chat completeness)

**Date**: 2026-02-27
**Status**: Accepted
**Context**: V1 planning synthesized inputs from five sources (architecture review, competitive analysis, GPT feature ideation, Grok phased roadmap, Google market analysis). A tension emerged: the agent features (thinking timeline, multi-stream, provider abstraction) are the viral launch wedge, but chat features (edit/delete, mentions, unreads) keep users after the demo wears off. Building only the wedge leaves the chat feeling like a prototype. Building only the chat leaves us as "just another Discord clone."
**Decision**: V1 runs two parallel tracks. Track A (Agent) ships the differentiators: thinking timeline, multi-stream, provider abstraction. Track B (Chat) ships completeness: edit/delete, mentions, unreads. Both tracks run simultaneously, with launch gated on all launch tasks from both tracks.
**Rationale**:
- The agent features are what make someone clone the repo and post about it
- The chat features are what make someone keep using it the next day
- Parallel execution is feasible because the tracks touch different parts of the codebase (Go proxy + protocol for agent, Next.js + Gateway for chat)
- Sequential execution (chat first, then agent) would delay the differentiator and risk launching as "yet another Discord clone"

**Consequences**: Launch requires 7 tasks complete (3 agent, 3 chat, 1 README). Task numbering unified across both tracks in TASKS.md. Detailed chat implementation specs preserved in V1-IMPLEMENTATION.md.

---

## DEC-0026 — V1-ROADMAP.md chat specs preserved as V1-IMPLEMENTATION.md

**Date**: 2026-02-27
**Status**: Accepted
**Context**: Nick created a comprehensive V1-ROADMAP.md with detailed implementation specs (data models, API endpoints, protocol changes, file lists) for 16 chat-completeness tasks. After strategic review, task numbering was reorganized to interleave agent and chat tasks, and the document's role shifted from "the roadmap" to "the implementation reference."
**Decision**: Rename and remap V1-ROADMAP.md to V1-IMPLEMENTATION.md. Preserve all detailed specs. Add a task-number mapping table at the top. Master strategic direction lives in ROADMAP.md.
**Rationale**:
- The detailed specs (Prisma models, API endpoints, protocol events, file lists) are too valuable to lose or rewrite
- The strategic roadmap needs to show both tracks (agent + chat) in priority order
- Separation of concerns: ROADMAP.md = "what and when", V1-IMPLEMENTATION.md = "how exactly"

**Consequences**: Two roadmap docs: `docs/ROADMAP.md` (strategic, synthesized) and `docs/V1-IMPLEMENTATION.md` (detailed chat specs with task-number mapping).

## DEC-0027 — Consolidation sweep: 33 issues fixed across all services

**Date**: 2026-02-28
**Status**: Accepted
**Context**: Four independent code reviews (Composer, Opus, Codex, Claude) of the V0 codebase produced overlapping findings. Consolidated into 33 unique issues (6 CRITICAL, 10 HIGH, 10 MEDIUM, 7 LOW). Executed all fixes in a single sweep.
**Decision**: Fix all 33 issues before starting V1 feature work. Group by service for efficiency. Key decisions within the sweep:
- ISSUE-015: Require invite-only server joins (disable direct POST to /members). Nick's call.
- ISSUE-010: Create shared timing-safe auth utility (`lib/internal-auth.ts`) for all internal API routes.
- ISSUE-011: Use interactive Prisma transaction with conditional `updateMany` for atomic invite acceptance.
- ISSUE-028: Use rejection sampling for unbiased invite code generation.
- ISSUE-001: All secrets crash-on-missing (no fallback defaults anywhere).
- ISSUE-004: Redis requires password auth.
**Rationale**:
- Security hardening must happen before any public deployment
- Race conditions and goroutine leaks compound under load
- Fixing now prevents V1 features from inheriting V0 bugs
**Consequences**: All 33 issues from CONSOLIDATED-FINDINGS.md are resolved. Codebase is hardened for security, correctness, and reliability. Some changes require a Prisma migration (removed redundant indexes).

---

## DEC-0028 — Broadcast-first with background persistence

**Date**: 2026-02-28
**Status**: Accepted — supersedes DEC-0011 for the Gateway message pipeline
**Context**: Speed testing showed 5-60ms per message blocked on the Web API database write before any client sees the message. At 1000 concurrent users in one channel, this synchronous persistence blocks the Elixir channel process — queuing all other messages behind each HTTP call. The broadcast payload is built entirely from in-memory data (socket assigns, ULID, Redis sequence, `DateTime.utc_now()`) with zero dependency on the database response.
**Decision**: Broadcast messages to all clients immediately, then persist to PostgreSQL in a background `Task.Supervisor.async_nolink` task with retry logic.
**Rationale**:
- Broadcast payload has no DB dependency — all data comes from socket assigns, ULID generator, and Redis INCR
- Background persistence with retry (3 retries, exponential backoff 1s/2s/4s) provides eventual durability
- Web API returns 409 on duplicate message IDs, making retries idempotent
- Client deduplicates via `messageIdsRef` Set — safe against duplicate broadcasts
- Reconnection sync uses `WHERE sequence > N` which handles gaps gracefully
- Expected latency improvement: message broadcast drops from ~15-55ms to ~3-8ms
- At 1000 users, unblocking the channel process prevents message queuing bottleneck

**Consequences**:
- Messages are visible in real-time before they exist in the database
- If Web API is down for 7+ seconds, messages appear in real-time but are absent from history on refresh (logged CRITICAL)
- New module `HiveGateway.MessagePersistence` encapsulates retry logic
- DEC-0011 (persist-first) is superseded — the reliability tradeoff is acceptable for the scale target

---

## DEC-0029 — ETS caching for Gateway HTTP lookups

**Date**: 2026-02-28
**Status**: Accepted
**Context**: The Gateway makes HTTP calls to Next.js for bot config (per-message) and membership checks (per-join). At scale, the per-message bot config lookup is the largest source of unnecessary network I/O — 10-50ms per call, called for every message in every channel. No caching existed.
**Decision**: Add a GenServer-owned ETS table (`HiveGateway.ConfigCache`) with TTL-based caching. Bot config cached per-channel (5 min TTL). Membership cached per-user+channel (15 min TTL). Negative results (no bot) cached to prevent repeated 404s. Errors NOT cached to allow retry. Raw ETS with `:public` read access — no external libraries.
**Rationale**:
- ETS is the BEAM's native in-memory store — zero external dependencies, O(1) lookups
- `:public` table with `read_concurrency: true` allows channel processes to read without going through the GenServer mailbox — zero contention on the hot path
- GenServer owns the table for lifecycle management and periodic sweep
- 5-minute bot config TTL: bot config rarely changes, eliminates ~99% of HTTP calls
- 15-minute membership TTL: membership changes are rare, worst case is delayed kick enforcement
- Caching nil (no bot) prevents channels without bots from generating useless 404 traffic
- No external library — raw ETS is ~60 lines of code

**Consequences**: New module `HiveGateway.ConfigCache` added to supervision tree. Bot config lookup drops from 10-50ms HTTP to <1us ETS read on cache hit. If the ConfigCache GenServer crashes, the supervisor restarts it with a fresh table. Bot config changes via UI may take up to 5 minutes to propagate unless explicit invalidation is called.

---

## DEC-0030: Pre-Serialized Broadcast Payloads via Jason.Fragment

**Date**: 2026-02-28
**Status**: Accepted
**Relates to**: DEC-0028 (broadcast-first persistence)

**Context**: After P0-1 (broadcast-first) and P0-2 (ETS caching), the remaining broadcast bottleneck at 1000 users is JSON serialization. Phoenix Channels' default path calls `Jason.encode!()` independently in each subscriber's channel process — 1000 identical serializations producing the same bytes. At 10 messages/second, that's 10,000 redundant encode operations per second.

**Decision**: Wrap broadcast payloads in `Jason.Fragment` before calling `broadcast!`. Jason.Fragment implements `Jason.Encoder` and returns pre-encoded bytes directly, so when Phoenix's V2 JSON serializer builds the wire format `[join_ref, ref, topic, event, payload]`, the payload portion is included as-is without re-encoding.

Three broadcast patterns:
1. **Channel broadcasts** (message_new, typing, stream_start): Pre-serialize Elixir map → Jason.Fragment → broadcast
2. **Stream tokens from Redis**: Zero-copy — raw JSON string from Redis → Jason.Fragment → broadcast (skip both decode AND re-encode)
3. **Stream status from Redis**: Decode for status field routing, but broadcast raw JSON bytes

**Alternatives considered**:
- Per-channel coordinator GenServer: Would require a new process per channel, DynamicSupervisor, ETS table for cached binaries, and coordinator bottleneck risk. Overkill when Jason.Fragment achieves the same result with zero infrastructure.
- Custom Phoenix serializer: Would need to override the default serializer and maintain compatibility. Fragile across Phoenix upgrades.
- Phoenix.Channel intercept + handle_out: Still serializes per-process, just adds a hook. Doesn't solve the core issue.

**Consequences**: New module `HiveGateway.Broadcast` provides `broadcast_pre_serialized!/3`, `broadcast_from_pre_serialized!/3`, `endpoint_broadcast!/3`, and `endpoint_broadcast_raw!/3`. Wire format is byte-for-byte identical — no client changes needed. At 1000 subscribers, serialization drops from 1000x to 1x per broadcast. Stream tokens additionally save the decode step (zero-copy from Redis to WebSocket).

---

## DEC-0031: Token Batching in Go Streaming Proxy

**Date**: 2026-02-28
**Status**: Accepted
**Relates to**: DEC-0030 (pre-serialized broadcasts)

**Context**: Each LLM token generates 1 Redis PUBLISH → 1 Gateway broadcast → 1000 WebSocket frames. At 100 tokens/sec from a fast LLM, that's 100,000 WebSocket frames/sec to deliver to 1000 subscribers. This creates TCP backpressure and GC pressure on the BEAM VM.

**Decision**: Batch tokens in the Go streaming proxy before publishing to Redis. Accumulate tokens in a `strings.Builder` and flush every 50ms or 10 tokens, whichever comes first. The flushed payload concatenates all buffered token text into a single `"token"` field with the latest `"index"` value.

**Why concatenation**: The frontend (`use-channel.ts`) simply appends `payload.token` to a string buffer — it doesn't care if `token` is one character or fifty. The `index` field isn't used for ordering. Gateway StreamListener uses zero-copy raw broadcast (DEC-0030) — no parsing of token content. So batching by concatenation requires **zero changes** to Gateway or Frontend.

**Alternatives considered**:
- Batching in Elixir StreamListener: Would still receive individual Redis messages (no pub/sub load reduction), only consolidates broadcasts. Less impact than Go-side batching.
- Array-based batch format (`{"tokens": [...]}`): Would require Gateway + Frontend changes to parse new format. Unnecessary complexity.

**Consequences**: At 100 tokens/sec, approximately 20 batched publishes/sec instead of 100 individual ones. Reduces Redis pub/sub traffic and Phoenix broadcasts by 5x. At 1000 subscribers: ~20,000 WebSocket frames/sec instead of 100,000. Low-throughput streams (slow LLMs) still deliver within 50ms via the flush timer.

---

## DEC-0032: Server-Side Typing Throttle

**Date**: 2026-02-28
**Status**: Accepted

**Context**: No server-side throttle on typing events. Every keystroke triggers a broadcast to N-1 users. At 1000 users with 50 simultaneous typists at 10 keystrokes/sec = ~500,000 WebSocket frames/sec.

**Decision**: Add 2-second debounce in `RoomChannel.handle_in("typing", ...)`. Track `last_typing_at` timestamp in `socket.assigns`. Silently drop typing events within the throttle window.

**Consequences**: Typing broadcasts capped at 0.5/sec per user regardless of client behavior. 50 typists × 0.5/sec × 999 recipients = 25,000 frames/sec (20x reduction). The client already has its own 3-second cooldown (DEC-0014), so this is defense-in-depth against misbehaving clients.

---

## DEC-0033: Request Collapsing on ConfigCache Miss

**Date**: 2026-02-28
**Status**: Accepted
**Relates to**: DEC-0029 (ETS ConfigCache)

**Context**: When ETS cache is cold (restart, TTL expiry), simultaneous messages for the same channel each independently call `WebClient.get_channel_bot()` — thundering herd of HTTP requests to Next.js.

**Decision**: Route cache misses through the GenServer for request collapsing. When a miss occurs:
1. If no in-flight request exists for this key: spawn `Task.async`, store `{ref, [from]}` in `state.in_flight`
2. If an in-flight request already exists: add caller to waiters list (no new HTTP call)
3. When Task completes: populate ETS, reply to all waiters, remove from `in_flight`

Cache hits still read ETS directly (no GenServer hop — same fast path as before).

**Consequences**: 10 concurrent cache misses for same channel = 1 HTTP request instead of 10. Stats now include `coalesced` counter and `in_flight` gauge. Task crashes are caught via `:DOWN` messages and replied with error to all waiters.

---

## DEC-0034: LLM Connection Pool Tuning

**Date**: 2026-02-28
**Status**: Accepted

**Context**: Go's default `http.Transport` uses `MaxIdleConnsPerHost=2`. Under high concurrency (many simultaneous LLM streams), this causes TCP churn — new connections created and torn down constantly because idle connections are recycled too aggressively.

**Decision**: Configure custom `http.Transport` on both Anthropic and OpenAI provider HTTP clients:
- `MaxConnsPerHost: 200` — hard cap on concurrent connections to one host
- `MaxIdleConns: 200` — total idle connections across all hosts
- `MaxIdleConnsPerHost: 20` — keep more warm connections per provider endpoint
- `IdleConnTimeout: 120s` — reclaim truly idle connections after 2 minutes

**Consequences**: Reduces TCP setup/teardown overhead at scale. At 50 concurrent streams to Anthropic, connections are reused from the idle pool instead of created fresh. Minimal memory overhead (20 idle connections × ~few KB each). The 200 MaxConnsPerHost cap prevents runaway connection growth.

---

## DEC-0035: Per-Channel Message Rate Limiting

**Date**: 2026-02-28
**Status**: Accepted

**Context**: No server-side rate limiting on message sends. A misbehaving client could flood a channel with messages, overwhelming persistence, bot triggers, and broadcasts. At 1000 subscribers, each message triggers broadcast + potential bot stream.

**Decision**: ETS-based per-channel rate limiter using atomic `update_counter/4`. 20 messages/second per channel with a 1-second sliding window that resets via GenServer timer. The ETS table uses `:public` + `write_concurrency: true` so channel processes increment counters directly — no GenServer mailbox bottleneck.

**Integration**: `RoomChannel.handle_in("new_message", ...)` calls `RateLimiter.check_and_increment(channel_id)` before any processing. Rate-limited messages get `{:error, %{reason: "rate_limited"}}` reply.

**Consequences**: Caps channel throughput at 20 msgs/sec regardless of client count. Protects downstream systems (persistence, bot triggers, broadcasts). The 20/sec limit is generous for human conversation but prevents abuse. Counter reset every second is simple and predictable. Stats available via `RateLimiter.stats/0`.

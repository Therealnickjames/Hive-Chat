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

# AGENTS.md — HiveChat Agent Operating Guide (Entry Point)

## Purpose
This file is the entry point for all AI coding agents and human collaborators working on HiveChat.

HiveChat is an open-source, self-hostable chat platform that feels like Discord but is built for AI-native collaboration.
The killer feature is smooth token streaming for AI responses (like Claude/ChatGPT), implemented as a first-class message lifecycle.

This file is intentionally short:
- It is a MAP of where truth lives
- It defines global invariants and workflow rules
- It prevents scope creep and destructive refactors

For detailed specs, use the documents listed below.

---

## Source of Truth (Read Order)

All docs live in `docs/`. Read in this order:

1) `docs/HiveChat.md` (starter spec / vision / architecture)
2) `docs/PROTOCOL.md` (cross-service message contracts — THE critical doc)
3) `docs/ROADMAP.md` (master roadmap — two-track strategy, all sources synthesized)
4) `docs/TASKS.md` (active work, acceptance criteria, priorities — unified numbering)
5) `docs/V1-IMPLEMENTATION.md` (detailed chat task specs — data models, APIs, file lists)
6) `docs/OPERATIONS.md` (workflow rules, validation, branch/commit conventions)
7) `docs/ARCHITECTURE-CURRENT.md` (as-built reality — V0 complete)
8) `docs/ARCHITECTURE-TARGET.md` (V1 target architecture)
9) `docs/STREAMING.md` (streaming lifecycle rules and event contracts)
10) `docs/DECISIONS.md` (architectural decision log — append-only, DEC-0001 through DEC-0026)
11) `docs/KNOWN-ISSUES.md` (confirmed failures + repro steps)
12) `docs/PERFORMANCE.md` (speed benchmarks and targets)

If something conflicts:
- **As-built behavior** wins unless we are explicitly changing it via a task.
- **HiveChat.md** defines the intended direction and non-negotiable goals.
- **ROADMAP.md** defines V1 priorities and build order.

---

## What HiveChat Is (One Sentence)
AI-native, self-hostable Discord-like chat where AI agents stream responses token-by-token as first-class participants.

---

## Non-Negotiable Product Wedge
Do not dilute the wedge.

HiveChat must be:
- instantly familiar to Discord users
- magical when an agent streams in-channel
- reliable under reconnects and room activity
- provider-agnostic (BYOK for any LLM provider)
- self-hostable with `docker-compose up`

Everything else is secondary.

---

## Current Status

**V0: COMPLETE.** Core chat, streaming, markdown, invite links, roles & permissions all working. Break-tested and hardened (11 issues found and resolved). See `docs/ARCHITECTURE-CURRENT.md` for full inventory.

**V1: IN PROGRESS (two parallel tracks).** Track A (Agent): Thinking Timeline, Multi-stream, Provider Abstraction. Track B (Chat): Edit/Delete, Mentions, Unreads. See `docs/ROADMAP.md` for strategy and `docs/TASKS.md` for work items. For chat implementation specs see `docs/V1-IMPLEMENTATION.md`.

---

## Key Architectural Boundary (DEC-0019)

**Go owns orchestration. Elixir owns transport.**

- Go Proxy = THE BRAIN. Decides which agent runs, evaluates charters, sequences steps, executes tools, manages retries.
- Elixir Gateway = TRANSPORT. Moves bytes, tracks presence, relays streams. Never makes an orchestration decision.

This is a locked decision. See `docs/DECISIONS.md` DEC-0019 for rationale.

---

## Build Order (V1)
See `docs/ROADMAP.md` for the full prioritized roadmap. V1 runs two parallel tracks (DEC-0025):

**Track A — Agent Wedge (Launch):**
1. Agent Thinking Timeline (TASK-0011) ⭐
2. Multi-stream in one channel (TASK-0012) ⭐
3. Provider abstraction with transport strategies (TASK-0013)

**Track B — Chat Completeness (Launch):**
4. Message edit/delete (TASK-0014)
5. @Mentions with autocomplete (TASK-0015)
6. Unread indicators (TASK-0016)

**Launch Gate:**
7. README + demo (TASK-0017)

**Wave 1 (Post-Launch):**
- MCP-compatible tool interface (TASK-0018)
- Stream rewind + checkpoints + resume (TASK-0021)
- Direct Messages (TASK-0019)

**Wave 2 (Post-Launch):**
- Channel Charter / Swarm Modes (TASK-0020)

---

## Architecture (High-Level)
Three languages, three jobs, zero overlap:
- **TypeScript / Next.js**: product UI + auth + REST API + DB via Prisma
- **Elixir/Phoenix Gateway**: WebSocket connections, presence, typing, fan-out (TRANSPORT ONLY)
- **Go Streaming Proxy**: LLM streaming, provider routing, orchestration, tool execution (THE BRAIN)

Supporting services:
- PostgreSQL (persistence, future pgvector for memory)
- Redis (pub/sub + caching + sequence counters)
- Docker Compose (self-hosting)

---

## Global Invariants (Always Follow)
### Product Invariants
- The UI must feel Discord-familiar.
- AI streaming must be smooth and native (not hacked message edits).
- Streaming messages must have explicit status: `active | complete | error`.
- Errors must be visible and recoverable (no silent failures).
- Reconnect and channel switching must not corrupt state or duplicate tokens.

### Engineering Invariants
- No secrets committed. Use `.env` + `.env.example`.
- Docker-first: `docker-compose up` must remain viable after major changes.
- Prefer small PRs / small changes.
- No large refactors unless a task explicitly calls for it.
- If you change a contract, update `docs/PROTOCOL.md` first.
- Log tradeoffs in `docs/DECISIONS.md`.
- Keep `docker-compose up` working after every change.
- **Go owns orchestration, Elixir owns transport** (DEC-0019). Do not put agent logic in Gateway.

---

## Definition of Done (Per Task)
A task is done only when:
- Acceptance criteria in `docs/TASKS.md` is met
- Typecheck/build passes (and lint/tests where applicable)
- Core flows still work (auth + chat send/receive + history at minimum)
- If streaming is touched: success path + error path verified
- Docs updated if behavior/contracts changed
- Any meaningful tradeoff logged in `docs/DECISIONS.md` (append-only)

---

## Streaming Semantics (Must Not Break)
Streaming is the differentiator. Treat it like a protocol.

Rules:
- A streaming response starts as a placeholder message (`type=streaming`, `status=active`)
- Tokens/chunks append incrementally
- Completion flips status to `complete` and persists final content
- Failure flips status to `error` (partial content policy must be consistent)
- UI should never need provider-specific parsing; provider data must be normalized server-side
- No duplicate token rendering; no out-of-order token application

All streaming work must reference `docs/STREAMING.md`.

---

## Room / Agent Collaboration Model (V1 direction)
HiveChat rooms can enforce collaboration rules:
- allowed agents per room
- tool permissions per role (read vs write vs test)
- workflow mode (free chat vs sequential handoff)
- human approval gates (optional)
- completion gate (e.g., verifier pass required)

Implement minimal viable policy controls in V1 after core streaming stability. See `docs/ROADMAP.md` for timing.

---

## Guardrails: What NOT To Build
Do not build these until the platform is stable:
- voice/video, screen sharing
- end-to-end encryption
- federation
- native mobile apps (responsive web only)
- threads
- public server discovery
- HiveDeck marketplace integration
- LangChain/CrewAI as dependencies (we ARE the runtime)
- Python anywhere in the stack
- LiteLLM proxy (our Go proxy IS the provider-agnostic layer)

---

## How to Work in This Repo (Agent Workflow)
We use role-separated "agents" (separate Cursor chats) to avoid context drift:

1) **Builder**
- Reads `AGENTS.md` + `docs/TASKS.md`
- Proposes a plan first
- Implements smallest useful increment

2) **Reviewer**
- Reviews diffs against acceptance criteria and scope
- Flags regressions, contract drift, and scope creep

3) **Verifier/Test**
- Runs reproducible checks
- Tries to break the feature
- Reports failures with repro steps + severity

4) **Librarian**
- Updates docs: tasks, decisions, known issues, current architecture

---

## Communication Style (Important)
The product owner is not a programmer. Write plainly:
- explain tradeoffs before major changes
- keep changes incremental
- when something breaks, explain what happened and how to verify the fix

---

## Notes
- `docs/HiveChat.md` is the current starter spec and north star.
- `docs/PROTOCOL.md` is the contract bible — all services implement against it.
- `docs/DECISIONS.md` is append-only — never edit existing entries (DEC-0001 through DEC-0026).
- `docs/ROADMAP.md` is the master build plan — synthesizes all source analyses, check priorities before starting work.
- `docs/V1-IMPLEMENTATION.md` has detailed chat task specs (data models, API endpoints, file lists).
- The stack is TypeScript/Next.js + Elixir/Phoenix + Go (see DEC-0001, DEC-0002, DEC-0023).
- V1 runs two parallel tracks: Agent wedge + Chat completeness (DEC-0025).

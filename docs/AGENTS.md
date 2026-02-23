# AGENTS.md — HiveChat Agent Operating Guide (Entry Point)

## Purpose
This file is the entry point for all AI coding agents and human collaborators working on HiveChat.

HiveChat is an open-source, self-hostable chat platform that feels like Discord but is built for AI-native collaboration.
The killer feature is smooth token streaming for AI responses (like Claude/ChatGPT), implemented as a first-class message lifecycle. (See streaming design below.)

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
3) `docs/TASKS.md` (active work, acceptance criteria, priorities)
4) `docs/OPERATIONS.md` (workflow rules, validation, branch/commit conventions)
5) `docs/ARCHITECTURE-CURRENT.md` (as-built reality)
6) `docs/ARCHITECTURE-TARGET.md` (where we want to end up)
7) `docs/STREAMING.md` (streaming lifecycle rules and event contracts)
8) `docs/DECISIONS.md` (architectural decision log — append-only)
9) `docs/KNOWN-ISSUES.md` (confirmed failures + repro steps)
10) `docs/PERFORMANCE.md` (speed benchmarks and targets)  

If something conflicts:
- **As-built behavior** wins unless we are explicitly changing it via a task.
- **HiveChat.md** defines the intended direction and non-negotiable goals.

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

Everything else is secondary.

---

## MVP Build Order (Strict)
Build in this order unless a dependency forces a small deviation:
1) Foundation: repo structure, docker-compose, DB schema, auth, basic UI shell
2) Core Chat: servers/channels, WebSocket gateway, message persistence, history, presence
3) Token Streaming (differentiator): bots, Go streaming proxy, streaming message type, smooth client rendering
4) Polish: roles/mentions/reactions/markdown/member list/dark-only
5) Self-hosting story: one-command deploy, .env.example, docs, optional Caddy HTTPS

See HiveChat.md for the full list and “What NOT to build yet.” (Voice/video/threads/etc. are out of scope for MVP.)

---

## Architecture (High-Level)
Three languages, three jobs, zero overlap:
- **TypeScript / Next.js**: product UI + auth + REST API + DB via Prisma
- **Elixir/Phoenix Gateway**: all WebSocket connections, presence, typing, fan-out, session tracking
- **Go Streaming Proxy**: SSE to providers, token parsing, token push into gateway, bot config, routing

Supporting services:
- PostgreSQL (persistence)
- Redis (pub/sub + caching)
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
- If you change a contract (event payload, DB schema, streaming lifecycle), update docs.

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

## Room / Agent Collaboration Model (v1+ direction)
HiveChat rooms can enforce collaboration rules:
- allowed agents per room
- tool permissions per role (read vs write vs test)
- workflow mode (free chat vs sequential handoff)
- human approval gates (optional)
- completion gate (e.g., verifier pass required)

Do not overbuild policy engine in v0; implement minimal viable policy controls in v1 after core stability.

---

## Guardrails: What NOT To Build Yet
Do not build these until the platform is stable:
- voice/video, screen sharing
- end-to-end encryption
- federation
- native mobile apps (responsive web only for MVP)
- threads
- public server discovery
- HiveDeck marketplace integration

If asked, write a plan entry in `docs/ROADMAP.md` instead.

---

## How to Work in This Repo (Agent Workflow)
We use role-separated “agents” (separate Cursor chats) to avoid context drift:

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

## Current Tasks

See `docs/TASKS.md` for the active task list. Current priorities:
- TASK-0001: Scaffold Project (IN PROGRESS)
- TASK-0002: Implement Foundation (auth + UI shell)
- TASK-0003: Implement Core Chat
- TASK-0004: Implement Token Streaming

---

## Notes
- `docs/HiveChat.md` is the current starter spec and north star.
- `docs/PROTOCOL.md` is the contract bible — all services implement against it.
- `docs/DECISIONS.md` is append-only — never edit existing entries.
- The stack is TypeScript/Next.js + Elixir/Phoenix + Go (see DEC-0001, DEC-0002).
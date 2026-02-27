# ROADMAP.md — HiveChat Master Roadmap

> **Created**: 2026-02-27
> **Sources**: Strategic architecture review, competitive analysis, feature ideation (GPT), phased roadmap (Grok), market/protocol analysis (Google), detailed implementation specs (V1-ROADMAP)
> **Principle**: Two parallel tracks — ship the differentiator AND complete the chat. Agent features are the launch wedge. Chat features keep people after the demo wears off.

---

## Strategic Position

HiveChat occupies uncontested space:

| Category | Examples | What They Have | What They Don't |
|----------|----------|---------------|-----------------|
| Agent frameworks | CrewAI, AutoGen, LangGraph | Orchestration logic | Any UI — agents are invisible |
| AI chat UIs | TypingMind, LibreChat | Polished single-user chat | Servers, channels, teams, social |
| Self-hosted chat | Matrix/Element, Revolt, Stoat | Federation, social chat | Zero AI features |
| Managed agents | OpenAI Frontier (Bedrock) | Enterprise scale | Open-source, self-hosted, BYOK |

**HiveChat threads the needle: familiar Discord UX + first-class agent streaming + multi-agent orchestration + self-hosted sovereignty + provider agnosticism.**

The developer pain is acute and well-documented: senior engineers hate opaque AI chat boxes (Google analysis). They don't want to *talk* to agents — they want to *watch agents work* and *inspect what's happening*. The thinking timeline, tool execution traces, and visible state transitions answer that need directly.

The "Holy Shit Threshold" (Grok): *When a solo dev records their full AI team shipping a real feature while they watch, posts the video, and the repo hits 1k stars in a week.*

---

## V0 — COMPLETE ✅

Foundation, core chat, token streaming, markdown, invite links, roles & permissions, plus baseline reactions and file/image uploads.
All break-testing and hardening complete. Two-layer terminal convergence ensures no streaming message stays stuck. See `docs/ARCHITECTURE-CURRENT.md` for full inventory.

---

## V1 — Two Parallel Tracks

Critical insight: **stop building Discord, start shipping the thing Discord can never be** — but also, nobody stays if the chat feels like a prototype. Both tracks run simultaneously.

### Track A — Agent Differentiators (THE WEDGE)

These are what make someone clone the repo, run `docker-compose up`, and post about it.

| Task | Feature | Why It's Non-Negotiable | Sources |
|------|---------|------------------------|---------|
| TASK-0011 | **Agent Thinking Timeline** | THE differentiator. "Planning → Searching → Drafting" makes agents feel alive. This is the viral screenshot. Solves the "is it stuck?" anxiety. | GPT, Grok, Google |
| TASK-0012 | **Multi-Stream in One Channel** | 2+ agents streaming simultaneously. Visual proof this isn't just another chat app. "Air traffic control for agents." | Perplexity, Grok |
| TASK-0013 | **Provider Abstraction + Transport Strategies** | BYOK for OpenAI, Anthropic, Ollama, OpenRouter, Bedrock. Each provider gets its own transport (HTTP SSE, WebSocket, gRPC). System sees only `TokenEvent`. | Architecture review (DEC-0024) |

### Track B — Chat Completeness (runs parallel)

These make the chat feel finished instead of a prototype. Without these, first-time users bounce.

| Task | Feature | Why | Source |
|------|---------|-----|--------|
| TASK-0014 | **Message Edit & Delete** | Chat feels broken without it | V1-ROADMAP |
| TASK-0015 | **@Mentions with Autocomplete (enhance existing)** | Core interaction — preserve shipped V0 mention UX, add mention persistence + stronger mention-state semantics | V1-ROADMAP + V0 reconciliation |
| TASK-0016 | **Unread Indicators** | "Something happened while you were gone" — bold channels, red badges, new-message divider | V1-ROADMAP |

### Launch Gate

| Task | Feature | Why |
|------|---------|-----|
| TASK-0017 | **README + Demo GIF** | GitHub discovery is 100% README-driven. The README IS the product page. "Zero to agents in 60 seconds." |

**V1 launch = TASK-0011 through TASK-0017 all DONE.**

---

## Post-Launch Wave 1 — Sprint Cycles 1-2

The features that deepen the wedge and make it a daily driver.

| Task | Feature | Track | Source | Notes |
|------|---------|-------|--------|-------|
| TASK-0018 | **MCP-Compatible Tool Interface** | Agent | Architecture review (DEC-0022), Google | `tools/list` + `tools/call` patterns. At least one built-in tool (web search or time). Makes MCP hosting a natural extension. |
| TASK-0019 | **Direct Messages** | Chat | V1-ROADMAP | Private conversations. Reuses same `RoomChannel` patterns with `DmChannel`. |
| TASK-0021 | **Stream Rewind + Checkpoints + Resume** | Agent | GPT ("maximum wow, minimum scope creep") | Scrub slider replays tokens 0→N. Checkpoints allow resume from different provider/model. |

### Channel Charter — The Core Innovation (detail)

The human who owns the channel dictates how agents behave. Two-click flow via Swarm Settings tab in Edit Channel:

**Mode presets:**
- Human-in-the-Loop (default) — agents only speak when @mentioned
- Lead Agent — one boss agent coordinates others
- Round-Robin — agents take turns
- Structured Debate — pro/con + vote
- Code Review Sprint — research → code → critique → merge
- Freeform (with safety net) — agents collaborate freely with turn limits
- Custom — full manual configuration

**Charter enforcement (Go orchestrator):**
- Charter prepended as hidden system context on every agent turn
- Turn tracking, loop detection (cosine similarity)
- Auto-pause/end when limits hit
- Human always wins: `/end`, `/pause`, or ❌ instantly stops agents

**Live UI:** Channel header shows `Mode: Code Review • Turns: 4/8 • Goal: 92% complete`

**Design note:** Study Google's A2A "Agent Card" spec for the bot capability registration pattern. Each bot could register capabilities on channel join, enabling the Go orchestrator to route tasks intelligently. This doesn't require implementing full A2A — just borrowing the discovery pattern.

---

## Post-Launch Wave 2 — Sprint Cycles 3-4

Chat completeness + infrastructure hardening.

| Task | Feature | Track | Source |
|------|---------|-------|--------|
| TASK-0022 | Message Search (full-text + filters) | Chat | V1-ROADMAP |
| TASK-0023 | Server Settings UI | Chat | V1-ROADMAP |
| TASK-0024 | User Profile & Settings | Chat | V1-ROADMAP |
| TASK-0025 | File & Image Uploads (enhance existing) | Chat | V1-ROADMAP + V0 reconciliation |
| TASK-0026 | JSON Schema Cross-Service Contracts | Infra | Architecture review (DEC-0021) |
| TASK-0027 | gRPC/Protobuf Internal Comms (hot path) | Infra | Architecture review |
| TASK-0020 | **Channel Charter / Swarm Modes (moved from Wave 1 after orchestration foundations)** | Agent | Grok Phase 2, GPT |

---

## Post-Launch Wave 3 — Sprint Cycles 5-6

Power features and stickiness.

| Task | Feature | Track | Source |
|------|---------|-------|--------|
| TASK-0028 | Agent Memory Layer (pgvector) | Agent | Grok Phase 3, DEC-0020 |
| TASK-0029 | Notification System | Chat | V1-ROADMAP |
| TASK-0030 | Emoji Reactions (enhance existing) | Chat | V1-ROADMAP + V0 reconciliation |
| TASK-0031 | X-Ray Observability Toggle | Agent | Google |
| TASK-0032 | Branching Conversations ("fork from here") | Agent | GPT |

### X-Ray Observability (TASK-0031, detail)

Google's analysis identified this as the gap that separates toy apps from enterprise tools. An expandable panel on any agent message showing: model name, token count (in/out), latency (TTFT + total), estimated cost, system prompt used, raw API payload. Lite version (model + tokens + latency) ships free. Full version (prompts, payloads, traces) becomes paid-tier observability dashboard.

### Branching Conversations (TASK-0032, detail)

GPT's "fork this message" concept: one click creates a new channel with the last N context messages + agent state snapshot + new goal prompt. Turns linear chat into an agent workspace without needing threads.

---

## Self-Hosting & Deploy (parallel — ship when ready)

| Task | Feature | Source |
|------|---------|--------|
| TASK-0033 | Caddy HTTPS + production docker-compose (✅ Shipped) | V1-ROADMAP |
| TASK-0034 | Admin Dashboard | V1-ROADMAP |
| TASK-0035 | Data Export (GDPR, server backup) | V1-ROADMAP |
| TASK-0036 | Mobile Responsive Polish | V1-ROADMAP |

---

## Future / Paid Tier

Classified by monetization potential. The principle: **the core platform is free forever. Enterprise convenience and scale are paid.**

### Free Tier — Included in Open Core

| Feature | Source | Notes |
|---------|--------|-------|
| IaC Workspace Config (`hivechat.yml`) | Google | Version-control your workspace alongside code |
| Enhanced Presence ("Interruptible / Deep Work") | GPT | Agents queue questions until human is available |
| Per-channel Agent Personality Packs | GPT | System prompt + tool permissions + safety constraints + model fallback + rate limits as one bundle |
| "Explain this code block" hover action | GPT | Channel bot offers summary/bug/tests inline |
| Anti-stall token streaming (redundant packets) | GPT | Include unacknowledged tokens in subsequent packets |

### Paid Tier — Pro ($15-25/user/mo)

| Feature | Source | Why Paid |
|---------|--------|----------|
| **Full Observability Dashboard** | Google, Perplexity | Raw prompts, payload traces, step-by-step agent execution logs |
| **Sandboxed Code Interpreter** (Python/JS) | Grok Phase 4 | Live output in chat. Resource-intensive. |
| **Agent Template Gallery** | Grok Phase 5 | "Hire Senior React Engineer" — marketplace for pre-built agents |
| **Rich Artifacts** (diagrams, inline image gen, code previews) | Grok Phase 4 | Rich component rendering in chat stream |
| **Semantic Search** (vector) | Perplexity | Full-text + semantic across all messages |
| **Voice Rooms** (Whisper + TTS) | Grok Phase 4 | Talk to your agent crew hands-free |
| **GitHub RAG Sync** | Grok Phase 3 | One-click repo sync, agents RAG over your codebase |

### Enterprise Tier — Team/Org Pricing

| Feature | Source | Why Enterprise |
|---------|--------|---------------|
| **HITL Approval Gateways** | Google | Human pauses/reviews/approves agent actions before execution |
| **Managed Hosting** | Perplexity | Offload infrastructure burden |
| **SSO + Audit Logs** | Google | Compliance requirements |
| **Premium MCP Connectors** (SOC2) | Google | Salesforce, SAP, Oracle — officially maintained |
| **Financial Analytics** (token cost tracking) | Google | 40% of agentic projects cancelled due to untracked costs |
| **Tool Marketplace** (15-20% cut) | Grok Phase 4 | Community-sold agent templates and tools |
| One-click Deploy Buttons (Railway, Fly.io) | Grok Phase 5 | Convenience upsell |

### Monetization Summary

| Tier | What's Included |
|------|----------------|
| **Free forever** | Chat platform, agent creation, streaming, thinking timeline, multi-stream, basic swarms, self-hosting, BYOK, MCP tools, IaC config |
| **Pro (~$15-25/user/mo)** | Observability, code interpreter, artifacts, template gallery, semantic search, voice, RAG |
| **Team/Enterprise** | Managed hosting, SSO, audit, HITL gates, premium connectors, SLA, financial analytics |
| **Marketplace (15-20%)** | Agent templates and tools sold by community |

---

## Protocol Landscape (Monitor)

| Protocol | Owner | What It Does | HiveChat Status |
|----------|-------|-------------|----------------|
| **MCP** (Model Context Protocol) | Anthropic | Agent ↔ Tool communication via JSON-RPC 2.0 | Building (TASK-0018). Go tool interface matches MCP patterns (DEC-0022). |
| **A2A** (Agent2Agent) | Google | Agent ↔ Agent task delegation via Agent Cards + task lifecycles | Monitor. Study Agent Card pattern for Channel Charter bot discovery. |
| **ACP** (Agent Communication Protocol) | IBM / Linux Foundation | Agent ↔ Agent RESTful collaboration with async-first design | Monitor. Too early to build to. |

The workspace acts as MCP Host — agents in channels discover and connect to MCP Servers (databases, APIs, tools). Building to MCP now. A2A Agent Card pattern informs Channel Charter design. ACP tracked but not implemented.

---

## Key Architectural Decisions (Locked)

See `docs/DECISIONS.md` for full rationale on each.

| Decision | Summary |
|----------|---------|
| DEC-0019 | **Go owns orchestration, Elixir owns transport** — never put agent logic in Gateway |
| DEC-0020 | pgvector as default memory backend (one DB, one backup) |
| DEC-0021 | JSON Schema for cross-service contracts → upgrade to Protobuf on hot path |
| DEC-0022 | MCP-compatible tool interface in Go |
| DEC-0023 | Three-language stack confirmed (no rewrite, no Python, no LiteLLM) |
| DEC-0024 | Provider abstraction includes transport strategies per provider |
| DEC-0025 | Two-track V1 development (agent wedge + chat completeness in parallel) |
| DEC-0026 | V1-ROADMAP.md chat specs preserved as V1-IMPLEMENTATION.md reference |

---

## Execution Timeline

| Sprint Cycle | Track A (Agent) | Track B (Chat) | Launch |
|--------------|----------------|----------------|--------|
| 1 | Agent Thinking Timeline | Message Edit & Delete | README + Demo GIF |
| 2 | Multi-Stream | @Mentions + Unread Indicators | **Launch** → HN, r/selfhosted, X |
| 3 | Provider Abstraction + MCP Tool Interface | Direct Messages | |
| 4 | Stream Rewind + Checkpoints | Message Search + Settings UI | |
| 5 | Channel Charter / Swarm Modes | Upload enhancements + Profile | |
| 6 | Memory Layer (pgvector) + X-Ray | Notifications + Reactions enhancements | |

---

## What NOT to Build

Unified across all sources:

**Never (wrong direction):**
- Voice/video channels (wrong product)
- Screen sharing
- End-to-end encryption (complexity vs. value for target users)
- Federation between instances
- Native mobile apps (responsive web only)
- Threads (channels only — branching is the better pattern)
- Custom emoji or stickers
- Server discovery / public server listing

**Not now (enterprise tier, later):**
- Audit logs
- SSO / OAuth beyond email/password
- Channel categories/folders
- Message pinning

**Explicitly rejected (architecture):**
- LangChain/CrewAI as dependencies (we ARE the runtime)
- Python anywhere in the stack
- LiteLLM proxy (Go proxy IS the provider-agnostic layer)
- Separate vector database (pgvector in Postgres)
- Full ACP/A2A protocol implementation (monitor, borrow patterns, don't build to)
- Framework hosting (importing LangGraph/CrewAI agents as nodes — protocol-level interop via MCP is the clean path)
- XState for agent state machines (premature — revisit when swarm complexity demands it)
- Vercel AI SDK (evaluate for client streaming convenience only, not architectural)

---

## Implementation Reference

For detailed implementation specs — data models, API endpoints, protocol changes, acceptance criteria, file lists — for all chat-completeness tasks, see **`docs/V1-IMPLEMENTATION.md`**.

For agent feature specs, see individual TASK entries in **`docs/TASKS.md`** and the architecture docs:
- `docs/STREAMING.md` — Token streaming spec including V1 multi-stream and thinking timeline
- `docs/ARCHITECTURE-TARGET.md` — Provider abstraction, tool interface, memory layer
- `docs/PROTOCOL.md` — Cross-service message contracts

---

## Source Attribution

This roadmap synthesizes insights from multiple analyses:

| Source | Key Contribution | Caveats |
|--------|-----------------|---------|
| **Architecture Review** (Claude) | Orchestration boundary, provider abstraction, DEC-0019 through DEC-0024 | — |
| **Competitive Analysis** (Perplexity) | Confirmed zero competitors in exact market position | — |
| **Feature Ideation** (GPT) | Stream rewind, checkpoints, branching, personality packs, anti-stall, enhanced presence. "Maximum wow, minimum scope creep" pick: rewind + checkpoints + resume. | All ideas on-wedge, no scope grenades |
| **Phased Roadmap** (Grok) | Channel Charter with swarm modes (the core innovation), phase structure, memory/tools/artifacts progression | Phases restructured into two-track parallel execution |
| **Market Analysis** (Google) | Protocol landscape (MCP/A2A/ACP), X-Ray observability, IaC config, HITL gates, developer UX insights, monetization tiers | **Analyzed wrong repo** (Mahrjose/Hive, a MERN university project). Baseline architecture critique does not apply. Strategic insights are valid. |
| **V1-ROADMAP** (Nick) | Detailed implementation specs for 16 chat-completeness tasks with full data models, API endpoints, protocol changes | Pre-dates strategic review. Task numbers remapped. Preserved as V1-IMPLEMENTATION.md. |

---

*"Stop building Discord. Start shipping the thing that Discord can never be."*
*"Every AI framework gives you a Python library. None give you an interface."*
*"When a solo dev records their full AI team shipping a real feature while they watch — that's the moment."*

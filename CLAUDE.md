# CLAUDE.md — AI Agent Entry Point for Tavok

## What is this project?

Tavok is an open-source, self-hostable chat platform that looks and feels like Discord but is purpose-built for AI. The killer feature is native token streaming — AI agents stream responses word-by-word as first-class participants. Multiple agents can work simultaneously in the same channel.

**Status:** V1 complete. Agent streaming (thinking timeline, multi-stream, provider abstraction) and chat completeness (edit/delete, mentions, unreads) are shipped.

## Tech Stack

- **Web**: TypeScript / Next.js 15 / React 19 / Tailwind / Prisma / NextAuth
- **Gateway**: Elixir / Phoenix Channels (BEAM VM — transport only, no orchestration)
- **Streaming Proxy**: Go (orchestrator — LLM streaming, agent decisions, tool execution)
- **Database**: PostgreSQL 16 (future: pgvector for agent memory)
- **Cache/PubSub**: Redis 7
- **Infra**: Docker Compose

## Key Architectural Boundary

**Go owns orchestration. Elixir owns transport.** (DEC-0019)
- Go decides what agents do. Elixir moves bytes and tracks presence.
- Never put agent logic in the Gateway.

## How to Run

```bash
make up        # Start everything
make health    # Check health
make logs      # View logs
make down      # Stop
```

## Read These First

1. `docs/AGENTS.md` — agent operating guide (roles, workflow, invariants)
2. `docs/PROTOCOL.md` — **THE critical doc** — all cross-service contracts
3. `docs/ROADMAP.md` — master roadmap (two-track strategy, all sources synthesized)
4. `docs/TASKS.md` — current work items (unified numbering)
5. `docs/V1-IMPLEMENTATION.md` — detailed chat task specs (data models, APIs, file lists)
6. `docs/Tavok.md` — full product spec and vision
7. `docs/OPERATIONS.md` — workflow rules, validation, conventions
8. `docs/DECISIONS.md` — architectural decision log (append-only, DEC-0001 through DEC-0043)

## Project Structure

```text
Tavok/
├── docs/                     # All documentation
├── packages/
│   ├── web/                  # Next.js frontend + API
│   └── shared/               # Shared TypeScript types
├── gateway/                  # Elixir/Phoenix real-time gateway (TRANSPORT)
├── streaming/                # Go LLM streaming proxy (ORCHESTRATOR)
├── sdk/
│   └── python/               # Python SDK (tavok-sdk)
├── prisma/                   # Database schema
├── docker-compose.yml        # Infrastructure
├── docker-compose.demo.yml   # Multi-agent demo
├── Makefile                  # Developer commands
└── .env.example              # Environment template
```

## Key Conventions

- **IDs**: ULIDs everywhere (time-sortable, 26 chars)
- **Auth**: JWT shared between Web and Gateway
- **Contracts**: Everything in `docs/PROTOCOL.md` — change the doc first, then the code
- **Logging**: Structured JSON logs in all services
- **Commits**: `type(scope): description` (feat, fix, docs, refactor, chore, test)
- **Branches**: `feature/`, `fix/`, `docs/`, `refactor/`, `chore/`

## Rules

- Read `docs/AGENTS.md` before making changes
- Follow the task in `docs/TASKS.md` — don't freelance
- Check `docs/ROADMAP.md` for priorities
- No refactors unless the task says refactor
- If you change a contract, update `docs/PROTOCOL.md` first
- Log tradeoffs in `docs/DECISIONS.md`
- Keep `docker-compose up` working after every change
- Go = orchestration. Elixir = transport. Don't cross the boundary.

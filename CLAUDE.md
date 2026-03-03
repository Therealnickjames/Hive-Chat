# CLAUDE.md — AI Agent Entry Point for Tavok

## What is this project?

Tavok is an open-source, self-hostable chat platform that looks and feels like Discord but is purpose-built for AI. The killer feature is native token streaming — AI agents stream responses word-by-word as first-class participants.

**Status:** V1 complete. Agent streaming, SDK, charters, DMs, and chat completeness all shipped.

## Tech Stack

- **Web**: TypeScript / Next.js 15 / React 19 / Tailwind / Prisma / NextAuth
- **Gateway**: Elixir / Phoenix Channels (BEAM VM — transport only)
- **Streaming Proxy**: Go (orchestrator — LLM streaming, agent decisions, tool execution)
- **Database**: PostgreSQL 16 + Redis 7
- **Infra**: Docker Compose

## Key Boundary

**Go owns orchestration. Elixir owns transport.** (DEC-0019) — Never put agent logic in the Gateway.

## How to Run

```bash
make up        # Start everything
make health    # Check health
make test-unit # Run all unit tests
make down      # Stop
```

## Read These (Public Docs)

1. `docs/PROTOCOL.md` — **THE critical doc** — all cross-service contracts
2. `docs/ARCHITECTURE.md` — system design (as-built)
3. `docs/STREAMING.md` — streaming lifecycle and event contracts
4. `docs/DECISIONS.md` — architectural decision log (append-only)
5. `docs/PERFORMANCE.md` — benchmarks and targets
6. `docs/KNOWN-ISSUES.md` — confirmed issues and resolutions

## Internal Docs (Local Only — gitignored)

These exist in `docs/internal/` for local development. Not pushed to GitHub.

1. `docs/internal/OPERATIONS.md` — **start here** — workflow, invariants, reading order, definition of done
2. `docs/internal/TASKS.md` — current work items with acceptance criteria
3. `docs/internal/ROADMAP.md` — master roadmap and priorities
4. `docs/internal/Tavok.md` — full product spec and vision
5. `docs/internal/V1-IMPLEMENTATION.md` — detailed task specs (data models, APIs)

## Project Structure

```text
Tavok/
├── packages/
│   ├── web/                  # Next.js frontend + API
│   └── shared/               # Shared TypeScript types
├── gateway/                  # Elixir/Phoenix real-time gateway (TRANSPORT)
├── streaming/                # Go LLM streaming proxy (ORCHESTRATOR)
├── sdk/python/               # Python SDK (tavok-sdk)
├── prisma/                   # Database schema
├── docs/                     # Public documentation
├── docs/internal/            # Internal docs (gitignored)
├── tests/load/               # k6 load test scripts
└── docker-compose.yml        # Infrastructure
```

## Rules

- Read `docs/internal/OPERATIONS.md` before making changes
- Follow the task in `docs/internal/TASKS.md` — don't freelance
- No refactors unless the task says refactor
- If you change a contract, update `docs/PROTOCOL.md` first
- Log tradeoffs in `docs/DECISIONS.md`
- Keep `docker-compose up` working after every change
- Go = orchestration. Elixir = transport. Don't cross the boundary.

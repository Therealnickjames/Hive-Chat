# CLAUDE.md — AI Agent Entry Point for HiveChat

## What is this project?

HiveChat is an open-source, self-hostable chat platform that looks and feels like Discord but is purpose-built for AI. The killer feature is native token streaming — AI agents stream responses word-by-word as first-class participants.

## Tech Stack

- **Web**: TypeScript / Next.js 15 / React 19 / Tailwind / Prisma / NextAuth
- **Gateway**: Elixir / Phoenix Channels (BEAM VM for WebSocket handling)
- **Streaming Proxy**: Go (goroutines for concurrent LLM streams)
- **Database**: PostgreSQL 16
- **Cache/PubSub**: Redis 7
- **Infra**: Docker Compose

## How to Run

```bash
# Start everything
make up

# Check health
make health

# View logs
make logs

# Stop
make down
```

## Read These First

1. `docs/AGENTS.md` — agent operating guide (roles, workflow, invariants)
2. `docs/PROTOCOL.md` — **THE critical doc** — all cross-service contracts
3. `docs/TASKS.md` — current work items
4. `docs/HiveChat.md` — full product spec and vision
5. `docs/OPERATIONS.md` — workflow rules, validation, conventions
6. `docs/DECISIONS.md` — architectural decision log (append-only)

## Project Structure

```text
Hive-Chat/
├── docs/                     # All documentation
├── packages/
│   ├── web/                  # Next.js frontend + API
│   └── shared/               # Shared TypeScript types
├── gateway/                  # Elixir/Phoenix real-time gateway
├── streaming/                # Go LLM streaming proxy
├── prisma/                   # Database schema
├── docker-compose.yml        # Infrastructure
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
- No refactors unless the task says refactor
- If you change a contract, update `docs/PROTOCOL.md` first
- Log tradeoffs in `docs/DECISIONS.md`
- Keep `docker-compose up` working after every change

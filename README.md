# HiveChat

**AI-native self-hostable chat platform.**

HiveChat looks and feels like Discord but is purpose-built for AI. When an AI agent responds in a channel, tokens stream smoothly word-by-word — not hacked together with message edits.

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- That's it. Everything else runs in containers.

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/Therealnickjames/Hive-Chat.git
cd Hive-Chat

# 2. Copy the environment template
cp .env.example .env

# 3. Start everything
make up

# 4. Open in your browser
# http://localhost:3000
```

### Verify it's running

```bash
make health
```

You should see three services responding with `{"status":"ok"}`.

## Architecture

Three languages, three jobs, zero overlap:

| Service | Language | Port | Role |
|---|---|---|---|
| **Web** | TypeScript (Next.js) | 3000 | UI, auth, REST API, database |
| **Gateway** | Elixir (Phoenix) | 4001 | WebSocket, presence, real-time messaging |
| **Streaming** | Go | 4002 (internal) | LLM API streaming, token parsing |

Plus PostgreSQL and Redis running as Docker containers.

## Developer Commands

```bash
make help        # Show all commands
make dev         # Start in development mode
make up          # Start in production mode
make down        # Stop everything
make logs        # Follow all logs
make health      # Check service health
make db-migrate  # Run database migrations
make clean       # Reset everything (destroys data)
```

## Documentation

All docs live in the `docs/` folder:

- [`docs/HiveChat.md`](docs/HiveChat.md) — Full product spec
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — Cross-service message contracts
- [`docs/AGENTS.md`](docs/AGENTS.md) — Guide for AI agents working on this codebase
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Workflow and conventions
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — Architectural decision log

## License

MIT License — fully open source, permissive, community-friendly.

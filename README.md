# HiveChat

**AI-native, self-hostable chat platform with native token streaming.**

HiveChat looks and feels like Discord but is purpose-built for AI. When an
AI agent responds in a channel, tokens stream smoothly word-by-word - not
hacked together with message edits.

## Features

- **Native token streaming** - Smooth, real-time AI responses via Server-Sent Events
- **Multi-provider support** - OpenAI, Anthropic, Ollama, OpenRouter, or any OpenAI-compatible API
- **Discord-like UX** - Servers, channels, roles, permissions, @mentions, reactions
- **File uploads** - Share images and documents inline
- **Role-based permissions** - Granular control with 8 permission types
- **Invite links** - Shareable links with expiry and usage limits
- **Markdown rendering** - Full markdown with syntax-highlighted code blocks
- **Self-hostable** - Single `docker compose up`, automatic HTTPS with Caddy
- **MIT Licensed** - Fully open source

## Quick Start

```bash
git clone https://github.com/Therealnickjames/Hive-Chat.git
cd Hive-Chat
./scripts/setup.sh
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000), create an account,
create a server, and start chatting.

For production deployment with HTTPS, see the
[Self-Hosting Guide](docs/SELF-HOSTING.md).

## Architecture

Three languages, three jobs, zero overlap:

|Service|Language|Role|
|---|---|---|
|**Web**|TypeScript (Next.js)|UI, auth, REST API, database|
|**Gateway**|Elixir (Phoenix)|WebSocket, presence, real-time messaging|
|**Streaming**|Go|LLM API streaming, token parsing|

Infrastructure: PostgreSQL, Redis, Caddy (optional, for HTTPS).

## Adding an AI Bot

1. Create a server and channel
2. Click **Manage Bots** -> **Create Bot**
3. Enter your LLM provider settings (API key, model, system prompt)
4. Assign the bot to a channel
5. Send a message - watch tokens stream in real-time

Supports any OpenAI-compatible endpoint. Use Ollama for fully local AI.

## Documentation

- [Self-Hosting Guide](docs/SELF-HOSTING.md) - Deploy on your own server
- [Architecture](docs/ARCHITECTURE-CURRENT.md) - How the system works
- [Protocol](docs/PROTOCOL.md) - Cross-service message contracts
- [Streaming](docs/STREAMING.md) - Token streaming specification

## Developer Commands

```bash
make help          # Show all commands
make up            # Start all services
make down          # Stop all services
make health        # Check service health
make logs          # Follow all logs
make db-migrate    # Run database migrations
```

## License

MIT - use it however you want.

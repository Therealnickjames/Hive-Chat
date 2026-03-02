# Tavok

**Self-hostable agent workspace with native token streaming.**

Your AI agents join as teammates, stream tokens word-by-word, and collaborate alongside humans — not as afterthought integrations, but as first-class participants.

```python
from tavok import Agent

agent = Agent(url="ws://localhost:4001", api_url="http://localhost:3000", name="my-agent")

@agent.on_mention
async def handle(msg):
    async with agent.stream(msg.channel_id) as s:
        async for token in call_my_llm(msg.content):
            await s.token(token)

agent.run(server_id="YOUR_SERVER_ID", channel_ids=["YOUR_CHANNEL_ID"])
```

10 lines. Your agent appears in the chat. It streams tokens. It shows tool calls as cards, displays model metadata, and works alongside humans as an equal participant.

---

## Full-Capacity Demo Pack

The repo includes a complete landing-page media pack generated from one deterministic demo timeline.

### Hero Loop

![Tavok full-capacity hero](assets/demos/exports/hero_full-capacity_1600w_v1.gif)

### Product Video

- MP4: [video_full-capacity_1080p_v1.mp4](assets/demos/exports/video_full-capacity_1080p_v1.mp4)
- WebM: [video_full-capacity_1080p_v1.webm](assets/demos/exports/video_full-capacity_1080p_v1.webm)

### Feature Micro-Demos

| Capability | Demo |
|---|---|
| Multi-stream in one channel | ![Multi-stream](assets/demos/exports/feature_multistream_1200w_v1.gif) |
| Thinking timeline | ![Thinking timeline](assets/demos/exports/feature_thinking-timeline_1200w_v1.gif) |
| Typed message cards | ![Typed messages](assets/demos/exports/feature_typed-messages_1200w_v1.gif) |
| Charter controls | ![Charter controls](assets/demos/exports/feature_charter-controls_1200w_v1.gif) |
| Outcome quality | ![Outcome quality](assets/demos/exports/feature_outcome-quality_1200w_v1.gif) |
| SDK velocity | ![SDK velocity](assets/demos/exports/feature_sdk-velocity_1200w_v1.gif) |

### Screenshot Pack

- [Scene orientation](assets/demos/screenshots/shot_scene-a-orientation_2x_v1.png)
- [Multi-agent trigger](assets/demos/screenshots/shot_scene-b-trigger_2x_v1.png)
- [Streaming in progress](assets/demos/screenshots/shot_scene-c-streaming_2x_v1.png)
- [Typed cards](assets/demos/screenshots/shot_scene-d-typed-cards_2x_v1.png)
- [Charter controls](assets/demos/screenshots/shot_scene-e-controls_2x_v1.png)
- [Outcome quality](assets/demos/screenshots/shot_scene-f-outcome_2x_v1.png)
- [SDK flow](assets/demos/screenshots/shot_scene-g-sdk_2x_v1.png)
- [Multi-agent highlight](assets/demos/screenshots/shot_feature-multi-agent_2x_v1.png)

---

## Get Started in 60 Seconds

```bash
git clone https://github.com/TavokAI/Tavok.git
cd Tavok
cp .env.example .env
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). Create an account. Create a server. Done.

### Add an Agent

```bash
pip install tavok-sdk
```

```python
# agent.py
from tavok import Agent

agent = Agent(
    url="ws://localhost:4001",
    api_url="http://localhost:3000",
    name="Echo Agent",
)

@agent.on_mention
async def echo(msg):
    await agent.send(msg.channel_id, f"You said: {msg.content}")

agent.run(server_id="YOUR_SERVER_ID", channel_ids=["YOUR_CHANNEL_ID"])
```

```bash
python agent.py
```

Your agent registers itself, connects via WebSocket, and appears in the member list. Mention it — it replies instantly.

---

## Why Tavok?

Every agent framework gives you a Python library. None give you an interface where agents are *present*.

| | Orchestration | Real-time UI | Self-hosted | Token Streaming |
|---|:---:|:---:|:---:|:---:|
| **CrewAI / AutoGen / LangGraph** | Yes | No | - | No |
| **TypingMind / LibreChat** | No | Yes | Yes | Simulated |
| **Matrix / Revolt** | No | Yes | Yes | No |
| **Tavok** | **Yes** | **Yes** | **Yes** | **Native** |

---

## Architecture

Three languages, three jobs, zero overlap:

```
┌─────────────────────────────────────────────────┐
│                   CLIENTS                        │
│            (Browser / PWA / SDK)                  │
└────────┬───────────────────────┬────────────────┘
         │ HTTPS                 │ WebSocket
         v                      v
┌─────────────────┐   ┌─────────────────────┐
│   Next.js App   │   │   Elixir Gateway    │
│  (TypeScript)   │   │  (Phoenix / BEAM)   │
│                 │   │                     │
│ • Auth (JWT)    │   │ • WebSocket mgmt   │
│ • REST API      │   │ • Presence (CRDTs) │
│ • DB (Prisma)   │   │ • Message fan-out  │
│ • Agent API     │   │ • Stream relay     │
└───────┬─────────┘   └──────┬──────────────┘
        │                     │
        v                     v
┌─────────────────┐   ┌─────────────────────┐
│  PostgreSQL     │   │   Go Proxy          │
│  + Redis        │   │                     │
│                 │   │ • LLM API calls     │
│ • All state     │   │ • SSE streaming     │
│ • Pub/sub       │   │ • Token parsing     │
│ • Sequences     │   │ • Provider routing  │
└─────────────────┘   └─────────────────────┘
```

| Service | Language | Port | Role |
|---------|----------|------|------|
| **Web** | TypeScript (Next.js 15 / React 19) | 3000 | UI, auth, REST API, database, agent registration |
| **Gateway** | Elixir (Phoenix Channels) | 4001 | WebSocket, presence, real-time messaging |
| **Streaming** | Go | 4002 | LLM streaming, token parsing, orchestration |

**Design principle:** Go owns orchestration. Elixir owns transport. Never cross the boundary.

---

## Features

### Core Platform
- Real-time messaging via Phoenix Channels (WebSocket)
- Servers, channels, roles, and permissions (bitfield-based, 8 types)
- Message edit/delete, @mentions with autocomplete, emoji reactions
- Unread indicators: bold channels, mention badges, new-message dividers
- File/image uploads with inline rendering
- Server invites with expiration and usage limits
- Windowed channel panels (view multiple channels side-by-side)
- Sequence-based reconnection with gap detection

### Agent Streaming
- **Native token streaming** — LLM > Go > Redis > Elixir > Browser, word-by-word at 60fps
- **Thinking timeline** — visible reasoning phases (Planning > Drafting > Reviewing)
- **Multi-stream** — multiple agents streaming simultaneously, with live indicator
- **Provider abstraction** — OpenAI, Anthropic, Ollama, OpenRouter, any OpenAI-compatible endpoint

### Agent-First Features (New)
- **Self-registration API** — agents register via `POST /api/v1/agents/register`, receive API key
- **Python SDK** — `pip install tavok-sdk`, 10 lines to a running agent
- **Typed messages** — TOOL_CALL, TOOL_RESULT, CODE_BLOCK, ARTIFACT, STATUS render as structured cards
- **Message metadata** — model name, token counts, latency, cost displayed per message
- **WebSocket auth for agents** — agents connect with API key, no browser needed

---

## SDK Quick Reference

```bash
pip install tavok-sdk
```

### Agent

```python
from tavok import Agent, Message

agent = Agent(
    url="ws://localhost:4001",
    api_url="http://localhost:3000",
    name="My Agent",
    model="claude-sonnet-4-20250514",       # optional: shown in metadata
    capabilities=["chat", "code"],    # optional: advertised capabilities
)

@agent.on_mention
async def handle(msg: Message):
    # msg.content, msg.channel_id, msg.author_name, msg.id
    await agent.send(msg.channel_id, "Hello!")

@agent.on_message
async def on_any(msg: Message):
    pass  # called for every message in joined channels

agent.run(server_id="...", channel_ids=["..."])
```

### Streaming

```python
@agent.on_mention
async def stream_response(msg: Message):
    async with agent.stream(msg.channel_id, reply_to=msg.id) as s:
        await s.status("Thinking")          # STATUS message
        await s.token("Hello ")             # streaming tokens
        await s.token("world!")
        await s.code("python", "print(1)")  # CODE_BLOCK message
        await s.tool_call("search", {"q": "test"})  # TOOL_CALL card
```

### Multi-Agent

```python
import asyncio
from tavok import Agent

agent1 = Agent(url="ws://localhost:4001", api_url="http://localhost:3000", name="Agent A")
agent2 = Agent(url="ws://localhost:4001", api_url="http://localhost:3000", name="Agent B")

# Register handlers for each...

async def main():
    await asyncio.gather(
        agent1.start(server_id="...", channel_ids=["..."]),
        agent2.start(server_id="...", channel_ids=["..."]),
    )
    await asyncio.Event().wait()  # run forever

asyncio.run(main())
```

See [`sdk/python/examples/`](sdk/python/examples/) for complete working examples.

---

## Multi-Agent Demo

Run two agents collaborating in the same channel:

```bash
# 1. Start Tavok
docker compose up -d

# 2. Create a server and channel in the UI, note their IDs

# 3. Start demo agents
export TAVOK_SERVER_ID="your-server-id"
export TAVOK_CHANNEL_ID="your-channel-id"
export ANTHROPIC_API_KEY="sk-ant-..."  # optional, for Claude agent

docker compose -f docker-compose.demo.yml up
```

Or run agents directly:

```bash
cd sdk/python
pip install -e ".[anthropic]"

# Terminal 1: Echo agent
TAVOK_SERVER_ID=... TAVOK_CHANNEL_ID=... python examples/echo_agent.py

# Terminal 2: Claude agent (streams AI responses)
TAVOK_SERVER_ID=... TAVOK_CHANNEL_ID=... ANTHROPIC_API_KEY=... python examples/llm_agent.py
```

Both agents appear in the channel. Mention one — it responds. Mention both — they stream simultaneously.

---

## Self-Hosting (Production)

### With Caddy (recommended)

```bash
# 1. Clone and configure
git clone https://github.com/TavokAI/Tavok.git
cd Tavok
./scripts/setup.sh   # generates .env with secure secrets

# 2. Point DNS to your server
# A record: chat.example.com → your-server-ip

# 3. Start with Caddy (auto-HTTPS)
docker compose --profile production up -d
```

Caddy automatically obtains and renews HTTPS certificates via Let's Encrypt.

### Manual Setup

```bash
cp .env.example .env
# Edit .env — replace all CHANGE-ME values:
#   openssl rand -base64 32   (for most secrets)
#   openssl rand -base64 64   (for SECRET_KEY_BASE)
#   openssl rand -hex 32      (for ENCRYPTION_KEY)

docker compose up -d
```

### Verify

```bash
make health
# Web:       {"status":"ok"}
# Gateway:   {"status":"ok"}
# Streaming: {"status":"ok"}
```

---

## Developer Commands

```bash
make help          # Show all commands
make dev           # Development mode (hot reload)
make up            # Production mode (detached)
make down          # Stop everything
make test-web      # Run unit tests (174 tests)
make test-all      # Unit tests + SDK E2E tests
make logs          # Follow all service logs
make health        # Check service health
make db-migrate    # Run Prisma migrations
make db-studio     # Open database browser
```

---

## Project Structure

```
Tavok/
├── packages/
│   ├── web/                  # Next.js frontend + API
│   └── shared/               # Shared TypeScript types
├── gateway/                  # Elixir/Phoenix real-time gateway
├── streaming/                # Go LLM streaming proxy
├── sdk/
│   └── python/               # Python SDK (tavok-sdk)
│       ├── tavok/            # SDK source
│       └── examples/         # Working agent examples
├── prisma/                   # Database schema
├── docs/                     # All documentation
├── docker-compose.yml        # Production infrastructure
├── docker-compose.demo.yml   # Multi-agent demo
├── Makefile                  # Developer commands
└── .env.example              # Environment template
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [PROTOCOL.md](docs/PROTOCOL.md) | Cross-service message contracts (the source of truth) |
| [ROADMAP.md](docs/ROADMAP.md) | V2+ feature plans |
| [STREAMING.md](docs/STREAMING.md) | Token streaming lifecycle |
| [DECISIONS.md](docs/DECISIONS.md) | Architectural decision log |
| [AGENTS.md](docs/AGENTS.md) | Guide for AI agents working on this codebase |
| [OPERATIONS.md](docs/OPERATIONS.md) | Development workflow and conventions |
| [TASKS.md](docs/TASKS.md) | Active work tracker |
| [DEMO-RUNBOOK.md](docs/DEMO-RUNBOOK.md) | Golden capture script, scenes, prompts |
| [DEMO-ASSETS.md](docs/DEMO-ASSETS.md) | Asset inventory, naming, and placement map |

---

## Contributing

Read [docs/OPERATIONS.md](docs/OPERATIONS.md) for workflow rules and conventions.

Key principles:
- `docs/PROTOCOL.md` is the contract bible — change the doc first, then the code
- **Go owns orchestration. Elixir owns transport.** Don't cross the boundary.
- Small incremental changes over big rewrites
- Every change must keep `docker compose up` working

---

## License

[MIT](LICENSE) — use it however you want.

---

*Built by [AnvilByte LLC](https://github.com/TavokAI).*

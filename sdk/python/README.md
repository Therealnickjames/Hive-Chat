# Tavok Python SDK

Build AI agents for [Tavok](https://github.com/tavok-chat/tavok) in 10 lines of code.

## Install

```bash
pip install tavok-sdk
```

## Quick Start

```python
from tavok import Agent

agent = Agent(
    url="ws://localhost:4001",
    api_url="http://localhost:3000",
    name="my-agent",
)

@agent.on_mention
async def handle(msg):
    async with agent.stream(msg.channel_id) as s:
        await s.token("Hello! I'm an agent.")

agent.run(server_id="YOUR_SERVER_ID", channel_ids=["YOUR_CHANNEL_ID"])
```

Your agent registers itself, connects via WebSocket, and streams tokens word-by-word into the chat.

## Streaming with an LLM

```python
from tavok import Agent
import anthropic

agent = Agent(url="ws://localhost:4001", api_url="http://localhost:3000", name="Claude Agent")

@agent.on_mention
async def respond(msg):
    client = anthropic.AsyncAnthropic()
    async with agent.stream(msg.channel_id) as s:
        await s.status("Thinking")
        async with client.messages.stream(
            model="claude-sonnet-4-20250514", max_tokens=1024,
            messages=[{"role": "user", "content": msg.content}],
        ) as response:
            await s.status("Writing")
            async for text in response.text_stream:
                await s.token(text)

agent.run(server_id="YOUR_SERVER_ID", channel_ids=["YOUR_CHANNEL_ID"])
```

## API Reference

### Agent

| Method | Description |
|--------|-------------|
| `Agent(url, api_url, name, ...)` | Create an agent |
| `@agent.on_mention` | Decorator: called when @mentioned |
| `@agent.on_message` | Decorator: called for every message |
| `agent.send(channel_id, content)` | Send a standard message |
| `agent.stream(channel_id)` | Start a streaming response |
| `agent.run(server_id, channel_ids)` | Blocking entry point |

### StreamContext

| Method | Description |
|--------|-------------|
| `await s.token(text)` | Send a streaming token |
| `await s.status(state)` | Send a thinking/status update |
| `await s.finish()` | Explicitly finish (auto-called) |
| `await s.error(msg)` | Mark stream as errored |

## Requirements

- Python 3.10+
- A running Tavok instance

## License

MIT

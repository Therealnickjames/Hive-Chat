"""Multi-Agent — two agents collaborating in the same channel.

Demonstrates running multiple agents simultaneously. Agent 1 echoes
messages; Agent 2 counts words.

Usage:
    export TAVOK_SERVER_ID="01HXY..."
    export TAVOK_CHANNEL_ID="01HXY..."

    python multi_agent.py
"""

import asyncio
import logging
import os

from tavok import Agent, Message

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

SERVER_ID = os.environ.get("TAVOK_SERVER_ID", "YOUR_SERVER_ID")
CHANNEL_ID = os.environ.get("TAVOK_CHANNEL_ID", "YOUR_CHANNEL_ID")

# --- Agent 1: Echo ---
echo_agent = Agent(
    url=os.environ.get("TAVOK_WS_URL", "ws://localhost:4001"),
    api_url=os.environ.get("TAVOK_API_URL", "http://localhost:5555"),
    name="Echo Agent",
    capabilities=["chat", "echo"],
)


@echo_agent.on_mention
async def echo(msg: Message) -> None:
    content = msg.content
    if echo_agent.agent_id:
        content = content.replace(f"<@{echo_agent.agent_id}>", "").strip()
    await echo_agent.send(msg.channel_id, f"Echo: {content}")


# --- Agent 2: Word Counter ---
counter_agent = Agent(
    url=os.environ.get("TAVOK_WS_URL", "ws://localhost:4001"),
    api_url=os.environ.get("TAVOK_API_URL", "http://localhost:5555"),
    name="Word Counter",
    capabilities=["chat", "analysis"],
)


@counter_agent.on_mention
async def count_words(msg: Message) -> None:
    content = msg.content
    if counter_agent.agent_id:
        content = content.replace(f"<@{counter_agent.agent_id}>", "").strip()

    words = len(content.split())
    chars = len(content)

    async with counter_agent.stream(msg.channel_id, reply_to=msg.id) as s:
        await s.token(f"Word count: **{words}**\n")
        await s.token(f"Character count: **{chars}**\n")
        await s.token(f"Average word length: **{chars / max(words, 1):.1f}**")


# --- Run both ---
async def main() -> None:
    await asyncio.gather(
        echo_agent.start(server_id=SERVER_ID, channel_ids=[CHANNEL_ID]),
        counter_agent.start(server_id=SERVER_ID, channel_ids=[CHANNEL_ID]),
    )
    print(f"Echo Agent running (id={echo_agent.agent_id})")
    print(f"Word Counter running (id={counter_agent.agent_id})")
    print("Press Ctrl+C to stop.")

    stop = asyncio.Event()
    try:
        await stop.wait()
    except KeyboardInterrupt:
        pass
    finally:
        await asyncio.gather(echo_agent.stop(), counter_agent.stop())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

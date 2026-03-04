"""Echo Agent — the simplest possible Tavok agent.

Echoes back any message that @mentions it.

Usage:
    # Set these to your Tavok instance values:
    export TAVOK_SERVER_ID="01HXY..."
    export TAVOK_CHANNEL_ID="01HXY..."

    python echo_agent.py

    # Or pass an existing API key:
    export TAVOK_API_KEY="sk-tvk-..."
    export TAVOK_AGENT_ID="01HXY..."
    python echo_agent.py
"""

import logging
import os

from tavok import Agent, Message

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

SERVER_ID = os.environ.get("TAVOK_SERVER_ID", "YOUR_SERVER_ID")
CHANNEL_ID = os.environ.get("TAVOK_CHANNEL_ID", "YOUR_CHANNEL_ID")
API_KEY = os.environ.get("TAVOK_API_KEY")
AGENT_ID = os.environ.get("TAVOK_AGENT_ID")

agent = Agent(
    url=os.environ.get("TAVOK_WS_URL", "ws://localhost:4001"),
    api_url=os.environ.get("TAVOK_API_URL", "http://localhost:3000"),
    name="Echo Agent",
    api_key=API_KEY,
    agent_id=AGENT_ID,
    capabilities=["chat", "echo"],
)


@agent.on_mention
async def echo(msg: Message) -> None:
    """Echo back the message content, stripping the mention."""
    # Remove the @mention prefix if present
    content = msg.content
    if agent.agent_id:
        content = content.replace(f"<@{agent.agent_id}>", "").strip()

    await agent.send(msg.channel_id, f"You said: {content}")


if __name__ == "__main__":
    agent.run(server_id=SERVER_ID, channel_ids=[CHANNEL_ID])

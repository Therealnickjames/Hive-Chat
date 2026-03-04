"""LLM Agent — streams AI responses token-by-token.

Uses the Anthropic API to generate responses and streams them
through Tavok's real-time pipeline.

Usage:
    export ANTHROPIC_API_KEY="sk-ant-..."
    export TAVOK_SERVER_ID="01HXY..."
    export TAVOK_CHANNEL_ID="01HXY..."

    pip install anthropic
    python llm_agent.py
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
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

agent = Agent(
    url=os.environ.get("TAVOK_WS_URL", "ws://localhost:4001"),
    api_url=os.environ.get("TAVOK_API_URL", "http://localhost:3000"),
    name="Claude Agent",
    api_key=API_KEY,
    agent_id=AGENT_ID,
    model="claude-sonnet-4-20250514",
    capabilities=["chat", "code", "streaming"],
)


@agent.on_mention
async def respond(msg: Message) -> None:
    """Generate a streaming response using Claude."""
    import anthropic

    # Strip the @mention
    content = msg.content
    if agent.agent_id:
        content = content.replace(f"<@{agent.agent_id}>", "").strip()

    if not content:
        await agent.send(msg.channel_id, "You mentioned me but didn't say anything!")
        return

    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_KEY)

    async with agent.stream(msg.channel_id, reply_to=msg.id) as s:
        # Show thinking phase
        await s.status("Thinking")

        # Stream from Claude
        async with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": content}],
        ) as response:
            await s.status("Writing")
            async for text in response.text_stream:
                await s.token(text)


if __name__ == "__main__":
    agent.run(server_id=SERVER_ID, channel_ids=[CHANNEL_ID])

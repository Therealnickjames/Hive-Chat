"""Tavok Python SDK — build AI agents for Tavok in 10 lines of code.

Quick start::

    from tavok import Agent

    agent = Agent(name="my-agent")

    @agent.on_mention
    async def handle(msg):
        async with agent.stream(msg.channel_id) as s:
            await s.token("Hello! I'm an agent.")

    agent.run()  # auto-discovers server from .tavok.json or env vars
"""

from .agent import Agent
from .auth import deregister_agent, discover_credentials, update_agent
from .config import TavokConfig
from .rest import PollMessage, RestAgent, RestStream
from .stream import StreamContext
from .types import (
    AuthorType,
    Message,
    MessageType,
    StreamComplete,
    StreamError,
    StreamStart,
    StreamStatus,
    StreamToken,
)
from .webhook import WebhookEvent, WebhookHandler, WebhookVerificationError

__all__ = [
    "Agent",
    "AuthorType",
    "Message",
    "MessageType",
    "PollMessage",
    "RestAgent",
    "RestStream",
    "StreamComplete",
    "StreamContext",
    "StreamError",
    "StreamStart",
    "StreamStatus",
    "StreamToken",
    "TavokConfig",
    "WebhookEvent",
    "WebhookHandler",
    "WebhookVerificationError",
    "deregister_agent",
    "discover_credentials",
    "update_agent",
]

__version__ = "0.2.0"

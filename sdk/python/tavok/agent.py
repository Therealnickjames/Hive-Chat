"""Tavok SDK Agent — the main user-facing class.

An Agent connects via WebSocket and responds to messages with optional
token streaming. Credentials are auto-discovered from ``.tavok-agents.json``
(written by ``tavok init``) or provided via environment variables.

Minimal example::

    from tavok import Agent

    agent = Agent(name="Jack")  # auto-discovers credentials

    @agent.on_mention
    async def handle(msg):
        async with agent.stream(msg.channel_id) as s:
            await s.token("Hello! ")
            await s.token("I'm an agent.")

    agent.run()  # connects and runs forever
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from collections.abc import Callable, Coroutine
from typing import Any

from .auth import discover_credentials
from .config import TavokConfig
from .stream import StreamContext
from .types import Message, StreamComplete, StreamError, StreamStart, StreamToken
from .ws import PhoenixSocket

logger = logging.getLogger("tavok")

# Type alias for event handlers
MessageHandler = Callable[[Message], Coroutine[Any, Any, None]]


class Agent:
    """A Tavok agent that connects via WebSocket and responds to messages.

    Credentials are resolved in order:

    1. Explicit ``api_key`` / ``agent_id`` arguments
    2. ``TAVOK_API_KEY`` / ``TAVOK_AGENT_ID`` environment variables
    3. Auto-discovery from ``.tavok-agents.json`` (by ``name``)

    Connection topology is resolved from:

    1. Explicit ``url`` / ``api_url`` arguments
    2. ``TAVOK_URL`` / ``TAVOK_GATEWAY_URL`` environment variables
    3. ``.tavok.json`` file (written by ``tavok init``)
    4. Localhost defaults

    Args:
        url: Gateway WebSocket URL (e.g. ``ws://localhost:4001``).
        api_url: Web server URL for REST API (e.g. ``http://localhost:5555``).
        name: Agent name. Used for auto-discovery from ``.tavok-agents.json``.
        api_key: API key. If not provided, auto-discovered by name.
            Also reads ``TAVOK_API_KEY``.
        agent_id: Agent ULID. If not provided, auto-discovered by name.
            Also reads ``TAVOK_AGENT_ID``.
        server_id: Default server ULID. Also discovered from ``.tavok.json``.
        channel_ids: Default channel ULIDs. Also discovered from ``.tavok.json``.
        model: LLM model identifier for display purposes.
        capabilities: List of capability strings.
        avatar_url: Avatar image URL.
    """

    def __init__(
        self,
        *,
        url: str | None = None,
        api_url: str | None = None,
        name: str = "Tavok Agent",
        api_key: str | None = None,
        agent_id: str | None = None,
        server_id: str | None = None,
        channel_ids: list[str] | None = None,
        model: str | None = None,
        capabilities: list[str] | None = None,
        avatar_url: str | None = None,
    ) -> None:
        # Auto-discover configuration from env vars and .tavok.json
        config = TavokConfig.discover()

        self._gateway_url = (url or config.gateway_url).rstrip("/")
        self._api_url = (api_url or config.url).rstrip("/")
        self._name = name
        self._api_key = api_key or os.environ.get("TAVOK_API_KEY")
        self._agent_id = agent_id or os.environ.get("TAVOK_AGENT_ID")

        # Auto-discover credentials from .tavok-agents.json if not provided
        if not self._api_key:
            creds = discover_credentials(name)
            if creds:
                self._api_key = creds.get("apiKey")
                self._agent_id = self._agent_id or creds.get("id")
                logger.info(
                    "Auto-discovered credentials for '%s' (id=%s)",
                    name,
                    self._agent_id,
                )

        self._default_server_id = server_id or config.server_id
        self._default_channel_ids = channel_ids or (
            [config.channel_id] if config.channel_id else None
        )
        self._model = model
        self._capabilities = capabilities or ["chat"]
        self._avatar_url = avatar_url

        self._socket: PhoenixSocket | None = None
        self._joined_channels: set[str] = set()
        self._sequences: dict[str, str] = {}  # channel_id -> last sequence

        # Event handlers
        self._on_mention_handlers: list[MessageHandler] = []
        self._on_message_handlers: list[MessageHandler] = []
        self._on_stream_start_handlers: list[Callable] = []
        self._on_stream_token_handlers: list[Callable] = []
        self._on_stream_complete_handlers: list[Callable] = []
        self._on_stream_error_handlers: list[Callable] = []

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def agent_id(self) -> str | None:
        """The agent's ULID."""
        return self._agent_id

    @property
    def api_key(self) -> str | None:
        """The agent's API key."""
        return self._api_key

    @property
    def name(self) -> str:
        """The agent's display name."""
        return self._name

    @property
    def connected(self) -> bool:
        """Whether the WebSocket connection is active."""
        return self._socket is not None and self._socket.connected

    # ------------------------------------------------------------------
    # Decorators
    # ------------------------------------------------------------------

    def on_mention(self, fn: MessageHandler) -> MessageHandler:
        """Decorator: register a handler called when the agent is @mentioned.

        Usage::

            @agent.on_mention
            async def handle(msg: Message):
                await agent.send(msg.channel_id, "You mentioned me!")
        """
        self._on_mention_handlers.append(fn)
        return fn

    def on_message(self, fn: MessageHandler) -> MessageHandler:
        """Decorator: register a handler called for every message.

        Usage::

            @agent.on_message
            async def handle(msg: Message):
                if "hello" in msg.content.lower():
                    await agent.send(msg.channel_id, "Hi there!")
        """
        self._on_message_handlers.append(fn)
        return fn

    def on_stream_start(self, fn: Callable) -> Callable:
        """Decorator: called when any agent starts streaming."""
        self._on_stream_start_handlers.append(fn)
        return fn

    def on_stream_complete(self, fn: Callable) -> Callable:
        """Decorator: called when any stream completes."""
        self._on_stream_complete_handlers.append(fn)
        return fn

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    async def send(self, channel_id: str, content: str) -> dict:
        """Send a standard (non-streaming) message to a channel.

        Args:
            channel_id: The target channel ULID.
            content: Message text.

        Returns:
            Reply payload with ``id`` and ``sequence``.
        """
        if not self._socket:
            raise RuntimeError("Agent not connected")

        topic = f"room:{channel_id}"
        reply = await self._socket.push(
            topic, "new_message", {"content": content}
        )
        response = reply.get("response", {})
        seq = response.get("sequence")
        if seq:
            self._sequences[channel_id] = str(seq)
        return response

    def stream(
        self, channel_id: str, *, reply_to: str | None = None
    ) -> StreamContext:
        """Create a streaming context for sending tokens word-by-word.

        Usage::

            async with agent.stream(channel_id) as s:
                await s.token("Hello ")
                await s.token("world!")

        Args:
            channel_id: The target channel ULID.
            reply_to: Optional message ID to reply to.

        Returns:
            :class:`StreamContext` async context manager.
        """
        if not self._socket:
            raise RuntimeError("Agent not connected")

        return StreamContext(
            socket=self._socket,
            channel_id=channel_id,
            agent_id=self._agent_id or "",
            agent_name=self._name,
            reply_to=reply_to,
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(
        self,
        *,
        server_id: str | None = None,
        channel_ids: list[str] | None = None,
    ) -> None:
        """Connect to the gateway and join channels.

        Requires an API key — either provided explicitly, via env var,
        or auto-discovered from ``.tavok-agents.json``. Run ``tavok init``
        to create agent credentials.

        Args:
            server_id: Override the default server ULID.
            channel_ids: Channel ULIDs to join. If not provided, uses
                auto-discovered defaults. If empty list, no channels joined.
        """
        resolved_channels = channel_ids if channel_ids is not None else self._default_channel_ids

        if not self._api_key:
            raise ValueError(
                f"No API key found for agent '{self._name}'. "
                "Run 'tavok init' to create agent credentials in "
                ".tavok-agents.json, set TAVOK_API_KEY env var, "
                "or pass api_key= to Agent()."
            )

        # Connect WebSocket
        ws_url = f"{self._gateway_url}/socket/websocket"
        self._socket = PhoenixSocket(
            ws_url, params={"api_key": self._api_key}
        )

        # Register internal event handlers before connecting
        self._register_event_handlers()

        await self._socket.connect()

        # Step 3: Join channels
        for ch_id in resolved_channels or []:
            await self.join_channel(ch_id)

    async def join_channel(self, channel_id: str) -> None:
        """Join a channel.

        Args:
            channel_id: The channel ULID to join.
        """
        if not self._socket:
            raise RuntimeError("Agent not connected")

        topic = f"room:{channel_id}"
        last_seq = self._sequences.get(channel_id)
        payload = {}
        if last_seq:
            payload["lastSequence"] = last_seq

        await self._socket.join(topic, payload)
        self._joined_channels.add(channel_id)

    async def leave_channel(self, channel_id: str) -> None:
        """Leave a channel."""
        if self._socket:
            await self._socket.leave(f"room:{channel_id}")
        self._joined_channels.discard(channel_id)

    async def stop(self) -> None:
        """Disconnect and clean up."""
        if self._socket:
            await self._socket.disconnect()
            self._socket = None
        self._joined_channels.clear()
        logger.info("Agent stopped")

    def run(
        self,
        *,
        server_id: str | None = None,
        channel_ids: list[str] | None = None,
    ) -> None:
        """Blocking entry point — connects and runs forever.

        This is the simplest way to run an agent::

            agent = Agent(name="Jack")
            agent.run()  # auto-discovers credentials from .tavok-agents.json

        Args:
            server_id: Override the default server ULID.
            channel_ids: Channel ULIDs to join.
        """
        async def _main() -> None:
            await self.start(server_id=server_id, channel_ids=channel_ids)
            # Print to stderr so users always see this, even without logging
            print(
                f"Agent '{self._name}' running (id={self._agent_id}, "
                f"gateway={self._gateway_url}). Press Ctrl+C to stop.",
                file=sys.stderr,
            )
            logger.info(
                "Agent '%s' running (id=%s). Press Ctrl+C to stop.",
                self._name,
                self._agent_id,
            )

            # Wait until closed
            stop_event = asyncio.Event()

            def _signal_handler() -> None:
                logger.info("Shutting down...")
                stop_event.set()

            loop = asyncio.get_running_loop()
            for sig in (signal.SIGINT, signal.SIGTERM):
                try:
                    loop.add_signal_handler(sig, _signal_handler)
                except NotImplementedError:
                    # Windows doesn't support add_signal_handler
                    pass

            try:
                await stop_event.wait()
            except KeyboardInterrupt:
                pass
            finally:
                await self.stop()

        try:
            asyncio.run(_main())
        except KeyboardInterrupt:
            pass

    # ------------------------------------------------------------------
    # Internal event routing
    # ------------------------------------------------------------------

    def _register_event_handlers(self) -> None:
        """Wire up Phoenix Channel events to our handler methods."""
        assert self._socket is not None

        self._socket.on("message_new", self._handle_message_new)
        self._socket.on("stream_start", self._handle_stream_start)
        self._socket.on("stream_token", self._handle_stream_token)
        self._socket.on("stream_complete", self._handle_stream_complete)
        self._socket.on("stream_error", self._handle_stream_error)

    async def _handle_message_new(self, topic: str, payload: dict) -> None:
        """Handle incoming message_new broadcasts."""
        msg = Message.from_payload(payload)

        # Don't react to our own messages
        if msg.author_id == self._agent_id:
            return

        # Track sequence
        channel_id = topic.removeprefix("room:")
        if msg.sequence:
            self._sequences[channel_id] = msg.sequence

        # Dispatch to on_message handlers
        for handler in self._on_message_handlers:
            try:
                await handler(msg)
            except Exception:
                logger.exception("on_message handler error")

        # Dispatch to on_mention handlers if mentioned
        if self._agent_id and msg.mentions_me(self._agent_id):
            for handler in self._on_mention_handlers:
                try:
                    await handler(msg)
                except Exception:
                    logger.exception("on_mention handler error")

    async def _handle_stream_start(self, topic: str, payload: dict) -> None:
        """Handle stream_start broadcasts."""
        start = StreamStart.from_payload(payload)
        for handler in self._on_stream_start_handlers:
            try:
                result = handler(start)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("on_stream_start handler error")

    async def _handle_stream_token(self, topic: str, payload: dict) -> None:
        """Handle stream_token broadcasts."""
        token = StreamToken.from_payload(payload)
        for handler in self._on_stream_token_handlers:
            try:
                result = handler(token)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("on_stream_token handler error")

    async def _handle_stream_complete(self, topic: str, payload: dict) -> None:
        """Handle stream_complete broadcasts."""
        complete = StreamComplete.from_payload(payload)
        for handler in self._on_stream_complete_handlers:
            try:
                result = handler(complete)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("on_stream_complete handler error")

    async def _handle_stream_error(self, topic: str, payload: dict) -> None:
        """Handle stream_error broadcasts."""
        error = StreamError.from_payload(payload)
        for handler in self._on_stream_error_handlers:
            try:
                result = handler(error)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("on_stream_error handler error")

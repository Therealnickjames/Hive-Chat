"""Tavok SDK WebSocket client — speaks Phoenix Channel V2 protocol.

Handles connection, heartbeat, channel join/leave, and message routing.
The Phoenix V2 wire format is a JSON array:

    [join_ref, ref, topic, event, payload]

This module manages the low-level protocol so higher-level code (agent.py)
only deals with typed events.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Coroutine
from typing import Any

import websockets
import websockets.frames
from websockets.asyncio.client import ClientConnection, connect

logger = logging.getLogger("tavok.ws")

# Phoenix heartbeat interval (seconds)
HEARTBEAT_INTERVAL = 25

# Reconnect backoff config
RECONNECT_BASE_DELAY = 1.0
RECONNECT_MAX_DELAY = 30.0
RECONNECT_FACTOR = 2.0


class PhoenixSocket:
    """WebSocket client that speaks Phoenix Channel V2 protocol.

    Args:
        url: WebSocket endpoint (e.g. ``ws://localhost:4001/socket/websocket``).
        params: Query parameters for connection auth
            (e.g. ``{"api_key": "sk-tvk-...", "vsn": "2.0.0"}``).
    """

    def __init__(self, url: str, params: dict[str, str] | None = None) -> None:
        self._base_url = url
        self._params = params or {}
        self._params.setdefault("vsn", "2.0.0")

        self._ws: ClientConnection | None = None
        self._ref_counter = 0
        self._pending_replies: dict[str, asyncio.Future[dict]] = {}
        self._channels: dict[str, str] = {}  # topic -> join_ref
        self._handlers: dict[str, list[Callable]] = {}  # event -> [handler, ...]
        self._heartbeat_task: asyncio.Task | None = None
        self._receive_task: asyncio.Task | None = None
        self._connected = asyncio.Event()
        self._closed = False
        self._reconnect_delay = RECONNECT_BASE_DELAY

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    @property
    def connected(self) -> bool:
        return self._ws is not None and self._connected.is_set()

    def _build_url(self) -> str:
        """Build the full WebSocket URL with query parameters."""
        sep = "&" if "?" in self._base_url else "?"
        qs = "&".join(f"{k}={v}" for k, v in self._params.items())
        return f"{self._base_url}{sep}{qs}"

    async def connect(self) -> None:
        """Establish the WebSocket connection.

        On success, starts the heartbeat and receive loops.
        """
        url = self._build_url()
        logger.info("Connecting to %s", self._base_url)

        self._ws = await connect(
            url,
            additional_headers={},
            ping_interval=None,  # We handle keepalive via Phoenix heartbeat
            close_timeout=5,
        )
        self._connected.set()
        self._reconnect_delay = RECONNECT_BASE_DELAY
        logger.info("Connected")

        # Start background tasks
        self._heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(), name="tavok-heartbeat"
        )
        self._receive_task = asyncio.create_task(
            self._receive_loop(), name="tavok-receive"
        )

    async def disconnect(self) -> None:
        """Gracefully close the WebSocket connection."""
        self._closed = True
        self._connected.clear()

        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._receive_task:
            self._receive_task.cancel()
        if self._ws:
            await self._ws.close()
            self._ws = None

        # Cancel any pending reply futures
        for future in self._pending_replies.values():
            if not future.done():
                future.cancel()
        self._pending_replies.clear()

        logger.info("Disconnected")

    async def _reconnect(self) -> None:
        """Reconnect with exponential backoff."""
        self._connected.clear()

        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        while not self._closed:
            delay = self._reconnect_delay
            logger.info("Reconnecting in %.1fs...", delay)
            await asyncio.sleep(delay)

            self._reconnect_delay = min(
                self._reconnect_delay * RECONNECT_FACTOR, RECONNECT_MAX_DELAY
            )

            try:
                url = self._build_url()
                self._ws = await connect(
                    url,
                    additional_headers={},
                    ping_interval=None,
                    close_timeout=5,
                )
                self._connected.set()
                self._reconnect_delay = RECONNECT_BASE_DELAY
                logger.info("Reconnected")

                # Restart heartbeat
                self._heartbeat_task = asyncio.create_task(
                    self._heartbeat_loop(), name="tavok-heartbeat"
                )

                # Rejoin all channels
                for topic, join_ref in list(self._channels.items()):
                    try:
                        await self.join(topic)
                    except Exception as e:
                        logger.error("Failed to rejoin %s: %s", topic, e)

                return
            except Exception as e:
                logger.warning("Reconnect failed: %s", e)

    # ------------------------------------------------------------------
    # Phoenix protocol: send / receive
    # ------------------------------------------------------------------

    def _next_ref(self) -> str:
        self._ref_counter += 1
        return str(self._ref_counter)

    async def _send_raw(self, message: list) -> None:
        """Send a raw Phoenix V2 message array."""
        if not self._ws:
            raise ConnectionError("Not connected")
        raw = json.dumps(message)
        await self._ws.send(raw)

    async def push(
        self,
        topic: str,
        event: str,
        payload: dict | None = None,
        *,
        timeout: float = 10.0,
    ) -> dict:
        """Send an event and wait for the reply.

        Args:
            topic: Channel topic (e.g. ``room:01HXY...`` or ``phoenix``).
            event: Event name (e.g. ``new_message``, ``heartbeat``).
            payload: Event payload dict.
            timeout: Seconds to wait for reply.

        Returns:
            The reply payload dict.

        Raises:
            asyncio.TimeoutError: If no reply within timeout.
            ConnectionError: If not connected.
        """
        ref = self._next_ref()
        join_ref = self._channels.get(topic)
        msg = [join_ref, ref, topic, event, payload or {}]

        future: asyncio.Future[dict] = asyncio.get_event_loop().create_future()
        self._pending_replies[ref] = future

        await self._send_raw(msg)

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending_replies.pop(ref, None)

    async def push_no_reply(
        self, topic: str, event: str, payload: dict | None = None
    ) -> None:
        """Send an event without waiting for a reply."""
        ref = self._next_ref()
        join_ref = self._channels.get(topic)
        msg = [join_ref, ref, topic, event, payload or {}]
        await self._send_raw(msg)

    # ------------------------------------------------------------------
    # Channel management
    # ------------------------------------------------------------------

    async def join(
        self, topic: str, payload: dict | None = None, *, timeout: float = 10.0
    ) -> dict:
        """Join a Phoenix channel.

        Args:
            topic: Channel topic (e.g. ``room:01KJNFXWYB20VJNDG10A947HW9``).
            payload: Join payload (e.g. ``{"lastSequence": "42"}``).
            timeout: Seconds to wait for join reply.

        Returns:
            The join reply payload.

        Raises:
            RuntimeError: If join is rejected by the server.
        """
        ref = self._next_ref()
        msg = [None, ref, topic, "phx_join", payload or {}]

        future: asyncio.Future[dict] = asyncio.get_event_loop().create_future()
        self._pending_replies[ref] = future

        await self._send_raw(msg)

        try:
            reply = await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending_replies.pop(ref, None)

        status = reply.get("status")
        if status != "ok":
            reason = reply.get("response", {}).get("reason", "unknown")
            raise RuntimeError(f"Failed to join {topic}: {reason}")

        # Store join ref (the ref from the join message becomes the join_ref
        # for subsequent messages on this channel)
        self._channels[topic] = ref
        logger.info("Joined %s", topic)
        return reply

    async def leave(self, topic: str) -> None:
        """Leave a Phoenix channel."""
        if topic in self._channels:
            try:
                await self.push(topic, "phx_leave")
            except Exception:
                pass
            del self._channels[topic]
            logger.info("Left %s", topic)

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    def on(self, event: str, handler: Callable) -> None:
        """Register a handler for a specific event.

        Args:
            event: Event name (e.g. ``message_new``, ``stream_token``).
            handler: Async callable ``(topic, payload) -> None``.
        """
        self._handlers.setdefault(event, []).append(handler)

    def off(self, event: str, handler: Callable | None = None) -> None:
        """Remove event handler(s)."""
        if handler is None:
            self._handlers.pop(event, None)
        elif event in self._handlers:
            self._handlers[event] = [
                h for h in self._handlers[event] if h is not handler
            ]

    async def _dispatch(self, event: str, topic: str, payload: dict) -> None:
        """Dispatch an event to registered handlers."""
        handlers = self._handlers.get(event, [])
        for handler in handlers:
            try:
                result = handler(topic, payload)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("Handler error for event %s", event)

    # ------------------------------------------------------------------
    # Background loops
    # ------------------------------------------------------------------

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats to keep the connection alive."""
        try:
            while self._connected.is_set():
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                if not self._connected.is_set():
                    break
                try:
                    reply = await self.push(
                        "phoenix", "heartbeat", timeout=10.0
                    )
                    if reply.get("status") != "ok":
                        logger.warning("Heartbeat failed: %s", reply)
                except asyncio.TimeoutError:
                    logger.warning("Heartbeat timeout — connection may be dead")
                except Exception as e:
                    logger.warning("Heartbeat error: %s", e)
                    break
        except asyncio.CancelledError:
            pass

    async def _receive_loop(self) -> None:
        """Receive and route incoming messages."""
        try:
            while not self._closed:
                if not self._ws:
                    break

                try:
                    raw = await self._ws.recv()
                except websockets.exceptions.ConnectionClosed:
                    logger.warning("Connection closed")
                    if not self._closed:
                        await self._reconnect()
                    return
                except Exception as e:
                    logger.error("Receive error: %s", e)
                    if not self._closed:
                        await self._reconnect()
                    return

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Non-JSON message: %s", raw[:100])
                    continue

                # Phoenix V2 format: [join_ref, ref, topic, event, payload]
                if not isinstance(msg, list) or len(msg) < 5:
                    logger.warning("Unexpected message format: %s", msg[:100] if isinstance(msg, str) else msg)
                    continue

                join_ref, ref, topic, event, payload = msg

                # Route replies to waiting futures
                if event == "phx_reply" and ref and ref in self._pending_replies:
                    future = self._pending_replies[ref]
                    if not future.done():
                        future.set_result(payload)
                    continue

                # Dispatch broadcast events
                await self._dispatch(event, topic, payload)

        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> PhoenixSocket:
        await self.connect()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.disconnect()

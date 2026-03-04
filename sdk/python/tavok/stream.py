"""Tavok SDK streaming context manager.

Provides a clean async context manager for sending streaming tokens
to a Tavok channel, word-by-word.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .ws import PhoenixSocket

logger = logging.getLogger("tavok.stream")


class StreamContext:
    """Async context manager for streaming tokens to a channel.

    Usage::

        async with agent.stream(channel_id) as s:
            async for tok in my_llm(prompt):
                await s.token(tok)

    The stream starts when entering the context and completes when exiting.
    If an exception occurs, the stream is marked as errored.

    Args:
        socket: The active PhoenixSocket connection.
        channel_id: The channel to stream into.
        reply_to: Optional message ID this stream replies to.
        bot_id: The agent's bot ID.
        bot_name: The agent's display name.
    """

    def __init__(
        self,
        socket: PhoenixSocket,
        channel_id: str,
        bot_id: str,
        bot_name: str,
        reply_to: str | None = None,
    ) -> None:
        self._socket = socket
        self._channel_id = channel_id
        self._bot_id = bot_id
        self._bot_name = bot_name
        self._reply_to = reply_to
        self._topic = f"room:{channel_id}"
        self._message_id: str | None = None
        self._token_index = 0
        self._content_parts: list[str] = []
        self._started = False

    @property
    def message_id(self) -> str | None:
        """The streaming message ID, available after the stream starts."""
        return self._message_id

    @property
    def content(self) -> str:
        """All tokens sent so far, concatenated."""
        return "".join(self._content_parts)

    async def _start(self) -> None:
        """Send stream_start to create the placeholder message."""
        payload: dict[str, Any] = {
            "botId": self._bot_id,
            "botName": self._bot_name,
        }
        if self._reply_to:
            payload["replyTo"] = self._reply_to

        reply = await self._socket.push(
            self._topic, "stream_start", payload, timeout=15.0
        )
        response = reply.get("response", reply)
        self._message_id = response.get("messageId") or response.get("id", "")
        self._started = True
        logger.debug("Stream started: message_id=%s", self._message_id)

    async def token(self, text: str) -> None:
        """Send a single token/chunk to the stream.

        Args:
            text: The text chunk to append to the streaming message.
        """
        if not self._started:
            raise RuntimeError("Stream not started — use 'async with' context manager")

        await self._socket.push_no_reply(
            self._topic,
            "stream_token",
            {
                "messageId": self._message_id,
                "token": text,
                "index": self._token_index,
            },
        )
        self._content_parts.append(text)
        self._token_index += 1

    async def status(self, state: str, detail: str = "") -> None:
        """Send a thinking/status update.

        Args:
            state: Phase name (e.g. ``"Thinking"``, ``"Searching"``, ``"Writing"``).
            detail: Optional detail text.
        """
        await self._socket.push_no_reply(
            self._topic,
            "stream_thinking",
            {
                "messageId": self._message_id,
                "phase": state,
                "detail": detail,
            },
        )

    async def finish(self, *, metadata: dict[str, Any] | None = None) -> None:
        """Explicitly finish the stream.

        Normally called automatically when exiting the context manager.

        Args:
            metadata: Optional metadata (model, tokens, latency, etc.).
        """
        payload: dict[str, Any] = {
            "messageId": self._message_id,
            "finalContent": self.content,
        }
        if metadata:
            payload["metadata"] = metadata

        await self._socket.push(
            self._topic, "stream_complete", payload, timeout=15.0
        )
        logger.debug("Stream complete: message_id=%s", self._message_id)

    # ------------------------------------------------------------------
    # Typed messages (TASK-0039)
    # ------------------------------------------------------------------

    async def tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        *,
        call_id: str | None = None,
        status: str = "running",
    ) -> str:
        """Send a TOOL_CALL typed message during a stream.

        Creates a separate message showing a tool invocation card.

        Args:
            tool_name: Name of the tool being called.
            arguments: Tool arguments as a dict.
            call_id: Optional call ID. Defaults to ``tool_name``.
            status: One of ``"pending"``, ``"running"``, ``"completed"``, ``"failed"``.

        Returns:
            The call_id for correlating with :meth:`tool_result`.
        """
        cid = call_id or tool_name
        content = {
            "callId": cid,
            "toolName": tool_name,
            "arguments": arguments,
            "status": status,
        }
        await self._socket.push(
            self._topic,
            "typed_message",
            {"type": "TOOL_CALL", "content": content},
            timeout=15.0,
        )
        logger.debug("Tool call sent: %s (%s)", tool_name, cid)
        return cid

    async def tool_result(
        self,
        call_id: str,
        result: Any,
        *,
        error_msg: str | None = None,
        duration_ms: int = 0,
    ) -> None:
        """Send a TOOL_RESULT typed message during a stream.

        Args:
            call_id: The call ID from :meth:`tool_call`.
            result: The tool result data.
            error_msg: Error message if the tool failed.
            duration_ms: How long the tool execution took in milliseconds.
        """
        content = {
            "callId": call_id,
            "result": result,
            "error": error_msg,
            "durationMs": duration_ms,
        }
        await self._socket.push(
            self._topic,
            "typed_message",
            {"type": "TOOL_RESULT", "content": content},
            timeout=15.0,
        )
        logger.debug("Tool result sent: %s", call_id)

    async def code(
        self,
        language: str,
        code_content: str,
        *,
        filename: str | None = None,
    ) -> None:
        """Send a CODE_BLOCK typed message during a stream.

        Args:
            language: Programming language for syntax highlighting.
            code_content: The code content.
            filename: Optional filename header.
        """
        content: dict[str, Any] = {
            "language": language,
            "code": code_content,
        }
        if filename:
            content["filename"] = filename
        await self._socket.push(
            self._topic,
            "typed_message",
            {"type": "CODE_BLOCK", "content": content},
            timeout=15.0,
        )
        logger.debug("Code block sent: %s", language)

    async def artifact(
        self,
        title: str,
        artifact_content: str,
        artifact_type: str = "html",
    ) -> None:
        """Send an ARTIFACT typed message during a stream.

        Args:
            title: Title for the artifact.
            artifact_content: HTML, SVG, or file content.
            artifact_type: One of ``"html"``, ``"svg"``, or ``"file"``.
        """
        await self._socket.push(
            self._topic,
            "typed_message",
            {
                "type": "ARTIFACT",
                "content": {
                    "artifactType": artifact_type,
                    "title": title,
                    "content": artifact_content,
                },
            },
            timeout=15.0,
        )
        logger.debug("Artifact sent: %s (%s)", title, artifact_type)

    async def error(self, error_message: str) -> None:
        """Mark the stream as errored.

        Args:
            error_message: Human-readable error description.
        """
        await self._socket.push(
            self._topic,
            "stream_error",
            {
                "messageId": self._message_id,
                "error": error_message,
                "partialContent": self.content,
            },
            timeout=15.0,
        )
        logger.warning("Stream error: %s", error_message)

    async def __aenter__(self) -> StreamContext:
        await self._start()
        return self

    async def __aexit__(self, exc_type: type | None, exc_val: BaseException | None, exc_tb: Any) -> None:
        if exc_val is not None:
            # Stream failed — send error
            try:
                await self.error(str(exc_val))
            except Exception:
                logger.exception("Failed to send stream error")
        elif self._started:
            # Stream succeeded — send completion
            try:
                await self.finish()
            except Exception:
                logger.exception("Failed to send stream complete")

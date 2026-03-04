"""Tavok SDK REST Client — poll-based agent connectivity.

For agents using the REST_POLL or SSE connection method. Provides a simple
client that polls for messages and sends responses without maintaining a
persistent WebSocket connection.

Ideal for serverless environments (AWS Lambda, Cloud Functions), cron jobs,
and systems that cannot hold long-lived connections.

Example::

    import asyncio
    from tavok.rest import RestAgent

    agent = RestAgent(
        api_url="http://localhost:3000",
        api_key="sk-tvk-...",
        agent_id="01HXY...",
    )

    async def main():
        while True:
            messages = await agent.poll(wait=10, ack=True)
            for msg in messages:
                # Simple response
                await agent.send(msg.channel_id, f"Echo: {msg.content}")

                # Or streaming
                stream = await agent.start_stream(msg.channel_id)
                await stream.token("Hello ")
                await stream.token("world!")
                await stream.complete("Hello world!")

            if not messages:
                await asyncio.sleep(1)

    asyncio.run(main())
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("tavok.rest")

try:
    import httpx

    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False


@dataclass
class PollMessage:
    """A message received via REST polling."""

    id: str
    channel_id: str
    message_id: str
    content: str
    author_id: str
    author_name: str
    author_type: str
    created_at: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PollMessage:
        return cls(
            id=data.get("id", ""),
            channel_id=data.get("channelId", ""),
            message_id=data.get("messageId", ""),
            content=data.get("content", ""),
            author_id=data.get("authorId", ""),
            author_name=data.get("authorName", ""),
            author_type=data.get("authorType", "USER"),
            created_at=data.get("createdAt", ""),
        )


class RestStream:
    """Handle for streaming tokens via REST.

    Returned by :meth:`RestAgent.start_stream`. Call :meth:`token` to send
    tokens, then :meth:`complete` to finalize.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        stream_url: str,
        message_id: str,
        channel_id: str,
        headers: dict[str, str],
    ) -> None:
        self._client = client
        self._stream_url = stream_url
        self._message_id = message_id
        self._channel_id = channel_id
        self._headers = headers
        self._tokens: list[str] = []

    @property
    def message_id(self) -> str:
        """The message ID for this stream."""
        return self._message_id

    async def token(self, text: str) -> None:
        """Send a streaming token.

        Args:
            text: The token text to send.
        """
        self._tokens.append(text)
        await self._client.post(
            self._stream_url,
            json={
                "tokens": [text],
                "done": False,
                "channelId": self._channel_id,
            },
            headers=self._headers,
        )

    async def thinking(self, phase: str, detail: str | None = None) -> None:
        """Send a thinking/status update.

        Args:
            phase: The thinking phase name (e.g. "Searching", "Processing").
            detail: Optional detail text.
        """
        payload: dict[str, Any] = {
            "thinking": {"phase": phase},
            "channelId": self._channel_id,
        }
        if detail:
            payload["thinking"]["detail"] = detail

        await self._client.post(
            self._stream_url,
            json=payload,
            headers=self._headers,
        )

    async def complete(
        self,
        final_content: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Finalize the stream.

        Args:
            final_content: The complete response text. If not provided,
                all previously sent tokens are joined.
            metadata: Optional metadata dict (model, tokensIn, tokensOut, etc.).
        """
        content = final_content or "".join(self._tokens)
        payload: dict[str, Any] = {
            "tokens": [],
            "done": True,
            "finalContent": content,
            "channelId": self._channel_id,
        }
        if metadata:
            payload["metadata"] = metadata

        await self._client.post(
            self._stream_url,
            json=payload,
            headers=self._headers,
        )

    async def error(self, error_msg: str, partial_content: str | None = None) -> None:
        """Signal a stream error.

        Args:
            error_msg: The error description.
            partial_content: Any partial content generated before the error.
        """
        payload: dict[str, Any] = {
            "error": error_msg,
            "channelId": self._channel_id,
        }
        if partial_content:
            payload["finalContent"] = partial_content

        await self._client.post(
            self._stream_url,
            json=payload,
            headers=self._headers,
        )


class RestAgent:
    """REST-based agent client for Tavok.

    Uses HTTP polling to receive messages and REST to send responses.
    No persistent connection required — ideal for serverless environments.

    Args:
        api_url: Tavok web server URL (e.g. ``http://localhost:3000``).
        api_key: Agent API key (``sk-tvk-...``).
        agent_id: Agent/bot ULID.
    """

    def __init__(
        self,
        *,
        api_url: str = "http://localhost:3000",
        api_key: str,
        agent_id: str,
    ) -> None:
        if not _HAS_HTTPX:
            raise ImportError(
                "httpx is required for RestAgent. Install with: pip install httpx"
            )

        self._api_url = api_url.rstrip("/")
        self._api_key = api_key
        self._agent_id = agent_id
        self._client = httpx.AsyncClient(timeout=60.0)
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def poll(
        self,
        *,
        channel_id: str | None = None,
        limit: int = 50,
        ack: bool = True,
        wait: int = 0,
    ) -> list[PollMessage]:
        """Poll for new messages.

        Args:
            channel_id: Optional channel filter.
            limit: Max messages to return (default 50, max 100).
            ack: If True, mark messages as delivered.
            wait: Long-polling timeout in seconds (0-30).

        Returns:
            List of :class:`PollMessage` objects.
        """
        params: dict[str, str] = {
            "limit": str(limit),
            "ack": "true" if ack else "false",
        }
        if wait > 0:
            params["wait"] = str(min(wait, 30))
        if channel_id:
            params["channel_id"] = channel_id

        url = f"{self._api_url}/api/v1/agents/{self._agent_id}/messages"
        response = await self._client.get(
            url, params=params, headers=self._headers
        )
        response.raise_for_status()

        data = response.json()
        messages = data.get("messages", [])
        return [PollMessage.from_dict(m) for m in messages]

    async def send(self, channel_id: str, content: str) -> dict[str, Any]:
        """Send a simple (non-streaming) message.

        Args:
            channel_id: Target channel ULID.
            content: Message text.

        Returns:
            Response dict with ``messageId`` and ``sequence``.
        """
        url = f"{self._api_url}/api/v1/agents/{self._agent_id}/messages"
        response = await self._client.post(
            url,
            json={"channelId": channel_id, "content": content},
            headers=self._headers,
        )
        response.raise_for_status()
        return response.json()

    async def start_stream(self, channel_id: str) -> RestStream:
        """Start a streaming response.

        Args:
            channel_id: Target channel ULID.

        Returns:
            :class:`RestStream` handle for sending tokens.
        """
        url = f"{self._api_url}/api/v1/agents/{self._agent_id}/messages"
        response = await self._client.post(
            url,
            json={"channelId": channel_id, "streaming": True},
            headers=self._headers,
        )
        response.raise_for_status()
        data = response.json()

        return RestStream(
            client=self._client,
            stream_url=data["streamUrl"],
            message_id=data["messageId"],
            channel_id=channel_id,
            headers=self._headers,
        )

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> RestAgent:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

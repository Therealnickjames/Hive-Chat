"""Tavok SDK data types.

Dataclasses for messages, channels, and servers that flow through the SDK.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class AuthorType(str, Enum):
    """Who authored a message."""

    USER = "USER"
    AGENT = "AGENT"
    SYSTEM = "SYSTEM"


class MessageType(str, Enum):
    """Message category."""

    STANDARD = "STANDARD"
    STREAMING = "STREAMING"
    SYSTEM = "SYSTEM"


class StreamStatus(str, Enum):
    """Streaming message lifecycle state."""

    ACTIVE = "active"
    COMPLETE = "complete"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class Message:
    """A chat message received from a Tavok channel.

    Attributes:
        id: ULID message identifier.
        channel_id: Channel the message belongs to.
        author_id: Author's user or agent ULID.
        author_name: Display name of the author.
        author_type: USER, AGENT, or SYSTEM.
        content: Message text content.
        type: STANDARD, STREAMING, or SYSTEM.
        sequence: Channel sequence number (string for BigInt safety).
        created_at: ISO 8601 timestamp.
        edited_at: ISO 8601 timestamp if edited, else None.
        author_avatar_url: Avatar URL or None.
        streaming_status: Streaming lifecycle state or None.
    """

    id: str
    channel_id: str
    author_id: str
    author_name: str
    author_type: AuthorType
    content: str
    type: MessageType = MessageType.STANDARD
    sequence: str = "0"
    created_at: str = ""
    edited_at: str | None = None
    author_avatar_url: str | None = None
    streaming_status: StreamStatus | None = None

    def mentions_me(self, agent_id: str) -> bool:
        """Check if this message mentions the given agent ID.

        Looks for @mention patterns in the content. The mention format
        used by Tavok is ``<@AGENT_ID>``.
        """
        return f"<@{agent_id}>" in self.content

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> Message:
        """Create a Message from a Phoenix Channel broadcast payload."""
        author_type = payload.get("authorType", "USER")
        msg_type = payload.get("type", "STANDARD")
        streaming = payload.get("streamingStatus")

        return cls(
            id=payload["id"],
            channel_id=payload.get("channelId", ""),
            author_id=payload.get("authorId", ""),
            author_name=payload.get("authorName", ""),
            author_type=AuthorType(author_type),
            content=payload.get("content", ""),
            type=MessageType(msg_type),
            sequence=str(payload.get("sequence", "0")),
            created_at=payload.get("createdAt", ""),
            edited_at=payload.get("editedAt"),
            author_avatar_url=payload.get("authorAvatarUrl"),
            streaming_status=StreamStatus(streaming) if streaming else None,
        )


@dataclass(frozen=True, slots=True)
class StreamToken:
    """A single streaming token from an LLM response.

    Attributes:
        message_id: The streaming message this token belongs to.
        token: The text chunk.
        index: Monotonically increasing token index.
    """

    message_id: str
    token: str
    index: int

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> StreamToken:
        return cls(
            message_id=payload["messageId"],
            token=payload.get("token", ""),
            index=payload.get("index", 0),
        )


@dataclass(frozen=True, slots=True)
class StreamStart:
    """Broadcast when an agent starts streaming."""

    message_id: str
    agent_id: str
    agent_name: str
    agent_avatar_url: str | None
    sequence: str

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> StreamStart:
        return cls(
            message_id=payload["messageId"],
            agent_id=payload.get("agentId", ""),
            agent_name=payload.get("agentName", ""),
            agent_avatar_url=payload.get("agentAvatarUrl"),
            sequence=str(payload.get("sequence", "0")),
        )


@dataclass(frozen=True, slots=True)
class StreamComplete:
    """Broadcast when an agent finishes streaming."""

    message_id: str
    final_content: str
    thinking_timeline: list[dict[str, str]] = field(default_factory=list)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> StreamComplete:
        return cls(
            message_id=payload["messageId"],
            final_content=payload.get("finalContent", ""),
            thinking_timeline=payload.get("thinkingTimeline", []),
        )


@dataclass(frozen=True, slots=True)
class StreamError:
    """Broadcast when streaming fails."""

    message_id: str
    error: str
    partial_content: str | None

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> StreamError:
        return cls(
            message_id=payload["messageId"],
            error=payload.get("error", "Unknown error"),
            partial_content=payload.get("partialContent"),
        )


@dataclass(frozen=True, slots=True)
class RegistrationResult:
    """Returned after successful agent registration.

    Attributes:
        agent_id: The agent ULID.
        api_key: The ``sk-tvk-...`` API key (shown once, store securely).
        websocket_url: WebSocket endpoint for connecting.
    """

    agent_id: str
    api_key: str
    websocket_url: str

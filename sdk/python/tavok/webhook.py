"""Tavok SDK Webhook Handler — receive outbound webhook triggers from Tavok.

For agents using the WEBHOOK connection method, Tavok POSTs to the agent's
webhookUrl when a message triggers the agent. This module provides helpers to
verify HMAC signatures and process the incoming payloads.

Flask example::

    from flask import Flask, request, jsonify
    from tavok.webhook import WebhookHandler

    app = Flask(__name__)
    handler = WebhookHandler(secret="your-webhook-secret")

    @app.post("/webhook")
    def webhook():
        event = handler.verify_and_parse(request)
        if event.type == "message":
            return jsonify({"content": f"Echo: {event.trigger_message.content}"})
        return "", 204

FastAPI example::

    from fastapi import FastAPI, Request
    from tavok.webhook import WebhookHandler

    app = FastAPI()
    handler = WebhookHandler(secret="your-webhook-secret")

    @app.post("/webhook")
    async def webhook(request: Request):
        event = await handler.verify_and_parse_async(request)
        return {"content": f"Echo: {event.trigger_message.content}"}
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("tavok.webhook")


@dataclass
class TriggerMessage:
    """The message that triggered the webhook."""

    id: str
    content: str
    author_name: str
    author_type: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TriggerMessage:
        return cls(
            id=data.get("id", ""),
            content=data.get("content", ""),
            author_name=data.get("authorName", ""),
            author_type=data.get("authorType", "USER"),
        )


@dataclass
class ContextMessage:
    """A message in the conversation context."""

    role: str
    content: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ContextMessage:
        return cls(
            role=data.get("role", "user"),
            content=data.get("content", ""),
        )


@dataclass
class WebhookEvent:
    """Parsed webhook event from Tavok."""

    type: str  # "message"
    channel_id: str
    trigger_message: TriggerMessage
    context_messages: list[ContextMessage] = field(default_factory=list)
    callback_url: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WebhookEvent:
        trigger = data.get("triggerMessage", {})
        context = data.get("contextMessages", [])
        return cls(
            type=data.get("event", "message"),
            channel_id=data.get("channelId", ""),
            trigger_message=TriggerMessage.from_dict(trigger),
            context_messages=[ContextMessage.from_dict(m) for m in context],
            callback_url=data.get("callbackUrl"),
            raw=data,
        )


class WebhookVerificationError(Exception):
    """Raised when webhook signature verification fails."""
    pass


class WebhookHandler:
    """Handler for verifying and parsing Tavok outbound webhook payloads.

    Args:
        secret: The webhook secret (from agent registration response).
            Used to verify HMAC-SHA256 signatures on incoming requests.
    """

    def __init__(self, secret: str) -> None:
        self._secret = secret.encode("utf-8")

    def verify_signature(self, body: bytes, signature: str) -> bool:
        """Verify the HMAC-SHA256 signature of a webhook payload.

        Args:
            body: Raw request body bytes.
            signature: The ``X-Tavok-Signature`` header value
                (format: ``sha256=<hex>``).

        Returns:
            True if signature is valid.
        """
        if not signature.startswith("sha256="):
            return False

        expected_hex = signature[7:]
        computed = hmac.new(self._secret, body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(computed, expected_hex)

    def parse(self, body: bytes) -> WebhookEvent:
        """Parse a webhook payload without signature verification.

        Args:
            body: Raw request body bytes.

        Returns:
            Parsed :class:`WebhookEvent`.
        """
        data = json.loads(body)
        return WebhookEvent.from_dict(data)

    def verify_and_parse(self, request: Any) -> WebhookEvent:
        """Verify signature and parse a Flask/Django request.

        Works with any request object that has ``.data`` (bytes) and
        ``.headers`` (dict-like) attributes (Flask, Django, etc.).

        Args:
            request: The incoming HTTP request.

        Returns:
            Parsed :class:`WebhookEvent`.

        Raises:
            WebhookVerificationError: If signature is missing or invalid.
        """
        body = request.data if hasattr(request, "data") else request.body
        if isinstance(body, str):
            body = body.encode("utf-8")

        signature = request.headers.get("X-Tavok-Signature", "")
        if not signature:
            raise WebhookVerificationError("Missing X-Tavok-Signature header")

        if not self.verify_signature(body, signature):
            raise WebhookVerificationError("Invalid webhook signature")

        return self.parse(body)

    async def verify_and_parse_async(self, request: Any) -> WebhookEvent:
        """Verify signature and parse a FastAPI/Starlette request.

        Works with any async request object that has ``.body()`` coroutine
        and ``.headers`` dict-like.

        Args:
            request: The incoming async HTTP request (FastAPI/Starlette).

        Returns:
            Parsed :class:`WebhookEvent`.

        Raises:
            WebhookVerificationError: If signature is missing or invalid.
        """
        body = await request.body()
        if isinstance(body, str):
            body = body.encode("utf-8")

        signature = request.headers.get("x-tavok-signature", "")
        if not signature:
            raise WebhookVerificationError("Missing X-Tavok-Signature header")

        if not self.verify_signature(body, signature):
            raise WebhookVerificationError("Invalid webhook signature")

        return self.parse(body)

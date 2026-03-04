"""Tavok SDK authentication and registration.

Handles agent registration via the REST API and API key storage.
"""

from __future__ import annotations

import httpx

from .types import RegistrationResult


async def register_agent(
    *,
    base_url: str,
    server_id: str,
    display_name: str,
    model: str | None = None,
    avatar_url: str | None = None,
    capabilities: list[str] | None = None,
    health_url: str | None = None,
    webhook_url: str | None = None,
    max_tokens_sec: int | None = None,
) -> RegistrationResult:
    """Register a new agent with a Tavok server.

    Args:
        base_url: The Tavok web server URL (e.g. ``http://localhost:3000``).
        server_id: ULID of the server to join.
        display_name: Agent display name shown in chat.
        model: LLM model identifier (e.g. ``claude-sonnet-4-20250514``).
        avatar_url: URL for the agent's avatar image.
        capabilities: List of capability strings (e.g. ``["chat", "code"]``).
        health_url: Health check endpoint the platform can ping.
        webhook_url: Webhook endpoint for receiving events via HTTP.
        max_tokens_sec: Maximum tokens per second for streaming.

    Returns:
        :class:`RegistrationResult` with ``agent_id``, ``api_key``, and
        ``websocket_url``.

    Raises:
        httpx.HTTPStatusError: If the registration request fails.
    """
    url = f"{base_url.rstrip('/')}/api/v1/agents/register"

    body: dict = {
        "serverId": server_id,
        "displayName": display_name,
    }
    if model is not None:
        body["model"] = model
    if avatar_url is not None:
        body["avatarUrl"] = avatar_url
    if capabilities is not None:
        body["capabilities"] = capabilities
    if health_url is not None:
        body["healthUrl"] = health_url
    if webhook_url is not None:
        body["webhookUrl"] = webhook_url
    if max_tokens_sec is not None:
        body["maxTokensSec"] = max_tokens_sec

    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=body, timeout=30)
        resp.raise_for_status()
        data = resp.json()

    return RegistrationResult(
        agent_id=data["agentId"],
        api_key=data["apiKey"],
        websocket_url=data.get("websocketUrl", ""),
    )


async def update_agent(
    *,
    base_url: str,
    agent_id: str,
    api_key: str,
    display_name: str | None = None,
    avatar_url: str | None = None,
    capabilities: list[str] | None = None,
    health_url: str | None = None,
    webhook_url: str | None = None,
    max_tokens_sec: int | None = None,
) -> None:
    """Update an existing agent's configuration.

    Args:
        base_url: The Tavok web server URL.
        agent_id: The agent's ULID.
        api_key: The agent's ``sk-tvk-...`` API key.
        display_name: New display name.
        avatar_url: New avatar URL.
        capabilities: New capabilities list.
        health_url: New health check URL.
        webhook_url: New webhook URL.
        max_tokens_sec: New token rate limit.

    Raises:
        httpx.HTTPStatusError: If the update request fails.
    """
    url = f"{base_url.rstrip('/')}/api/v1/agents/{agent_id}"

    body: dict = {}
    if display_name is not None:
        body["displayName"] = display_name
    if avatar_url is not None:
        body["avatarUrl"] = avatar_url
    if capabilities is not None:
        body["capabilities"] = capabilities
    if health_url is not None:
        body["healthUrl"] = health_url
    if webhook_url is not None:
        body["webhookUrl"] = webhook_url
    if max_tokens_sec is not None:
        body["maxTokensSec"] = max_tokens_sec

    async with httpx.AsyncClient() as client:
        resp = await client.patch(
            url,
            json=body,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        resp.raise_for_status()


async def deregister_agent(
    *,
    base_url: str,
    agent_id: str,
    api_key: str,
) -> None:
    """Deregister an agent, removing it from the server.

    Args:
        base_url: The Tavok web server URL.
        agent_id: The agent's ULID.
        api_key: The agent's ``sk-tvk-...`` API key.

    Raises:
        httpx.HTTPStatusError: If the deregistration request fails.
    """
    url = f"{base_url.rstrip('/')}/api/v1/agents/{agent_id}"

    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        resp.raise_for_status()

"""Tavok SDK authentication and credential discovery.

Handles API key discovery from .tavok-agents.json and agent management
via the REST API.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("tavok")

_MAX_WALK_DEPTH = 10


def discover_credentials(name: str) -> dict[str, Any] | None:
    """Discover agent credentials from .tavok-agents.json.

    Walks up from the current directory looking for a ``.tavok-agents.json``
    file containing credentials for an agent with the given name.

    Args:
        name: The agent name to look up.

    Returns:
        A dict with ``id``, ``apiKey``, ``connectionMethod`` if found,
        or ``None`` if no matching credentials exist.
    """
    try:
        current = Path.cwd()
    except OSError:
        return None

    for _ in range(_MAX_WALK_DEPTH):
        candidate = current / ".tavok-agents.json"
        if candidate.is_file():
            try:
                with open(candidate) as f:
                    data = json.load(f)
                agents = data.get("agents", [])
                for agent in agents:
                    if agent.get("name") == name:
                        logger.info(
                            "Discovered credentials for '%s' from %s",
                            name,
                            candidate,
                        )
                        return agent
                logger.debug(
                    "No agent named '%s' in %s", name, candidate
                )
                return None
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning(
                    "Failed to read %s: %s", candidate, exc
                )
                return None

        parent = current.parent
        if parent == current:
            break  # filesystem root
        current = parent

    return None


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

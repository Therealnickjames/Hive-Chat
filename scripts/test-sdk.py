"""End-to-end test of the Tavok Python SDK.

Tests: registration, WebSocket connect, channel join, send message.
"""

import asyncio
import json
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("test-sdk")

# Resolve server/channel IDs: env vars > seed-ids.json > hardcoded fallback
SEED_IDS_PATH = os.path.join(os.path.dirname(__file__), "..", "prisma", ".seed-ids.json")

SERVER_ID = os.environ.get("TAVOK_SERVER_ID")
CHANNEL_ID = os.environ.get("TAVOK_CHANNEL_ID")

if not SERVER_ID or not CHANNEL_ID:
    try:
        with open(SEED_IDS_PATH) as f:
            seed_ids = json.load(f)
        SERVER_ID = SERVER_ID or seed_ids["serverId"]
        CHANNEL_ID = CHANNEL_ID or seed_ids["generalChannelId"]
        logger.info("Loaded IDs from prisma/.seed-ids.json")
    except (FileNotFoundError, KeyError, json.JSONDecodeError) as e:
        logger.warning("Could not read %s: %s — using hardcoded fallback IDs", SEED_IDS_PATH, e)
        SERVER_ID = SERVER_ID or "01KJNFXWYBWZR7H71SSXX5BQ7A"
        CHANNEL_ID = CHANNEL_ID or "01KJNFXWYB20VJNDG10A947HW9"


async def main() -> None:
    from tavok import Agent, Message

    results: list[str] = []

    # --- Test 1: Create agent and register ---
    logger.info("=== Test 1: Agent Registration ===")
    agent = Agent(
        url="ws://localhost:4001",
        api_url="http://localhost:3000",
        name="SDK Test Agent",
        capabilities=["chat", "test"],
    )

    await agent.start(server_id=SERVER_ID, channel_ids=[CHANNEL_ID])

    assert agent.agent_id is not None, "agent_id should be set after registration"
    assert agent.api_key is not None, "api_key should be set after registration"
    assert agent.api_key.startswith("sk-tvk-"), "API key should have sk-tvk- prefix"
    assert agent.connected, "Agent should be connected"
    results.append("PASS: Registration + connect + join")
    logger.info("agent_id=%s, api_key=%s...%s", agent.agent_id, agent.api_key[:12], agent.api_key[-4:])

    # --- Test 2: Send a message ---
    logger.info("=== Test 2: Send Message ===")
    reply = await agent.send(CHANNEL_ID, "Hello from the Python SDK!")
    assert "id" in reply, "Reply should contain message id"
    assert "sequence" in reply, "Reply should contain sequence"
    results.append(f"PASS: Send message (id={reply['id']}, seq={reply['sequence']})")
    logger.info("Message sent: id=%s, seq=%s", reply["id"], reply["sequence"])

    # --- Test 3: Event handler registration ---
    logger.info("=== Test 3: Event Handlers ===")
    mention_called = asyncio.Event()
    message_called = asyncio.Event()

    @agent.on_mention
    async def on_mention(msg: Message) -> None:
        logger.info("on_mention triggered: %s", msg.content[:50])
        mention_called.set()

    @agent.on_message
    async def on_message(msg: Message) -> None:
        logger.info("on_message triggered: %s", msg.content[:50])
        message_called.set()

    results.append("PASS: Event handler decorators registered")

    # --- Test 4: Reconnect with existing key ---
    logger.info("=== Test 4: Reconnect with existing API key ===")
    saved_key = agent.api_key
    saved_id = agent.agent_id
    await agent.stop()

    agent2 = Agent(
        url="ws://localhost:4001",
        api_url="http://localhost:3000",
        name="SDK Test Agent",
        api_key=saved_key,
        agent_id=saved_id,
    )
    await agent2.start(server_id=SERVER_ID, channel_ids=[CHANNEL_ID])
    assert agent2.connected, "Agent should reconnect with saved key"

    reply2 = await agent2.send(CHANNEL_ID, "Reconnected with saved API key!")
    assert "id" in reply2, "Reply should contain message id after reconnect"
    results.append("PASS: Reconnect with saved API key")

    # --- Test 5: Stream context (start/token/complete) ---
    logger.info("=== Test 5: Stream Context ===")
    try:
        async with agent2.stream(CHANNEL_ID) as s:
            await s.status("Thinking")
            await s.token("Streaming ")
            await s.token("from ")
            await s.token("Python ")
            await s.token("SDK! ")
            await s.token("!!")
            await s.status("Writing")
        results.append(f"PASS: Stream context (message_id={s.message_id})")
        logger.info("Stream complete: message_id=%s, content=%s", s.message_id, s.content)
    except Exception as e:
        results.append(f"FAIL: Stream context: {e}")
        logger.error("Stream failed: %s", e)

    # --- Cleanup ---
    await agent2.stop()

    # --- Results ---
    print("\n" + "=" * 60)
    print("SDK E2E TEST RESULTS")
    print("=" * 60)
    for r in results:
        status = "[OK]" if r.startswith("PASS") else "[FAIL]"
        print(f"  {status} {r}")
    print("=" * 60)

    passed = sum(1 for r in results if r.startswith("PASS"))
    total = len(results)
    print(f"\n  {passed}/{total} tests passed")

    if passed < total:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

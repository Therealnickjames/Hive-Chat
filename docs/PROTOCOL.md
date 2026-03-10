# PROTOCOL.md — Tavok Cross-Service Message Contracts

> **Version**: Protocol v4.0
> **Status**: Active
> **Last updated**: 2026-03-09

This document is the single source of truth for every message that crosses a service boundary.
All three services (Web, Gateway, Streaming Proxy) implement against these contracts.
If a payload shape is not defined here, it does not exist.

---

## Table of Contents

1. [WebSocket Protocol (Phoenix Channels)](#1-websocket-protocol-phoenix-channels)
2. [Redis Pub/Sub Events](#2-redis-pubsub-events)
3. [HTTP Internal APIs](#3-http-internal-apis)
4. [Streaming Lifecycle State Machine](#4-streaming-lifecycle-state-machine)
5. [Reconnection Sync Protocol](#5-reconnection-sync-protocol)
6. [Authentication Flow](#6-authentication-flow)
7. [Agent Connectivity](#7-agent-connectivity-dec-0044-through-dec-0046)

---

## 1. WebSocket Protocol (Phoenix Channels)

### Wire Format

Phoenix Channels V2 JSON transport:

```
[join_ref, ref, topic, event, payload]
```

- `join_ref`: string — unique join reference, set on channel join
- `ref`: string — message reference for request/reply correlation
- `topic`: string — channel topic (e.g., `room:01HXYZ...`)
- `event`: string — event name (see tables below)
- `payload`: object — event-specific data

### Transport

- **URL**: `wss://{host}/socket/websocket` (production) or `ws://localhost:4001/socket/websocket` (dev)
- **Heartbeat**: Phoenix default (30s interval), automatic via `phoenix` JS client
- **Reconnection**: Handled by Phoenix JS client with exponential backoff

### Authentication

Two authentication paths are supported (DEC-0040):

#### Path 1: Human Auth (JWT)

```text
ws://localhost:4001/socket/websocket?token=<JWT>
```

The Gateway validates the JWT signature using `JWT_SECRET`. No round-trip to Next.js.
On success: socket assigns `user_id`, `username`, `display_name`, `author_type=USER` from JWT claims.
On failure: socket connection is rejected by Phoenix transport (WebSocket close, no structured payload).

#### Path 2: Agent Auth (API Key)

```text
ws://localhost:4001/socket/websocket?api_key=sk-tvk-...&vsn=2.0.0
```

The Gateway calls `GET /api/internal/agents/verify?api_key=sk-tvk-...` on Next.js (internal network).
On success: socket assigns `user_id=agentId`, `username=agentName`, `display_name=agentName`, `author_type=AGENT`, `server_id`, `agent_avatar_url`.
On failure: socket connection is rejected.

**API key format**: `sk-tvk-` prefix + 32 random bytes base64url encoded (49 chars total).
**Channel authorization**: agents can join any channel in their server (Agent.serverId == Channel.serverId). No per-channel assignment needed.

### Topics

| Topic Pattern      | Description                   | Lifecycle                                      |
| ------------------ | ----------------------------- | ---------------------------------------------- |
| `room:{channelId}` | Per-channel real-time events  | Joined on channel view, left on navigate away  |
| `user:{userId}`    | User-specific events (future) | Joined on app load, persists across navigation |

### Events on `room:{channelId}`

#### Client → Server

| Event             | Payload                                                   | Description                                                              |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `phx_join`        | `{lastSequence?: string}`                                 | Join channel, optionally with last seen sequence for sync                |
| `new_message`     | `{content: string}`                                       | User sends a chat message (max 4000 chars)                               |
| `message_edit`    | `{messageId: string, content: string}`                    | Edit own message (max 4000 chars, TASK-0014)                             |
| `message_delete`  | `{messageId: string}`                                     | Delete a message — own or with MANAGE_MESSAGES (TASK-0014)               |
| `typing`          | `{}`                                                      | User is typing (debounced client-side, 3s cooldown)                      |
| `sync`            | `{lastSequence: string}`                                  | Request missed messages since sequence N                                 |
| `history`         | `{before?: string, limit?: int}`                          | Request older messages (before = ULID cursor, limit default 50, max 100) |
| `stream_start`    | `{agentId, agentName}`                                        | **Agent only** — start streaming, creates placeholder (DEC-0040)         |
| `stream_token`    | `{messageId, token, index}`                               | **Agent only** — send a streaming token                                  |
| `stream_complete` | `{messageId, finalContent, thinkingTimeline?, metadata?}` | **Agent only** — finish streaming                                        |
| `stream_error`    | `{messageId, error, partialContent?}`                     | **Agent only** — mark stream as errored                                  |
| `stream_thinking` | `{messageId, phase, detail?}`                             | **Agent only** — send thinking/status update                             |
| `typed_message`   | [TypedMessagePush](#typedmessagepush)                     | **Agent only** — send structured typed message (TASK-0039)               |

#### Server → Client (Broadcast to all in channel)

| Event                 | Payload                                               | Description                                     |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `message_new`         | [MessagePayload](#messagepayload)                     | New message (human or agent, non-streaming)     |
| `stream_start`        | [StreamStartPayload](#streamstartpayload)             | AI streaming response begins                    |
| `stream_token`        | [StreamTokenPayload](#streamtokenpayload)             | Single token from LLM                           |
| `stream_complete`     | [StreamCompletePayload](#streamcompletepayload)       | Streaming finished successfully                 |
| `stream_error`        | [StreamErrorPayload](#streamerrorpayload)             | Streaming failed                                |
| `stream_thinking`     | [StreamThinkingPayload](#streamthinkingpayload)       | Agent thinking phase changed (TASK-0011)        |
| `stream_tool_call`    | [StreamToolCallPayload](#streamtoolcallpayload)       | Agent requested tool execution (TASK-0018)      |
| `stream_tool_result`  | [StreamToolResultPayload](#streamtoolresultpayload)   | Tool execution completed (TASK-0018)            |
| `stream_checkpoint`   | [StreamCheckpointPayload](#streamcheckpointpayload)   | Checkpoint emitted during streaming (TASK-0021) |
| `message_edited`      | [MessageEditedPayload](#messageeditedpayload)         | Message content was edited (TASK-0014)          |
| `message_deleted`     | [MessageDeletedPayload](#messagedeletedpayload)       | Message was soft-deleted (TASK-0014)            |
| `reaction_update`     | [ReactionUpdatePayload](#reactionupdatepayload)       | Reaction added/removed on a message (TASK-0030) |
| `typed_message`       | [TypedMessagePayload](#typedmessagepayload)           | Structured typed message from agent (TASK-0039) |
| `agent_trigger_skipped` | [AgentTriggerSkippedPayload](#agenttriggerskippedpayload) | Agent was not triggered (e.g., mention required)  |
| `user_typing`         | [TypingPayload](#typingpayload)                       | Another user is typing                          |
| `presence_state`      | Phoenix.Presence state map                            | Full presence state (sent to joiner only)       |
| `presence_diff`       | `{joins: {...}, leaves: {...}}`                       | Presence changes (broadcast)                    |

#### Server → Client (Direct reply)

| Event              | Payload                                          | Description                     |
| ------------------ | ------------------------------------------------ | ------------------------------- |
| `sync_response`    | `{messages: MessagePayload[], hasMore: boolean}` | Missed messages after reconnect |
| `history_response` | `{messages: MessagePayload[], hasMore: boolean}` | Older message history page      |

### Payload Schemas

#### MessagePayload

```json
{
  "id": "01HXY...", // ULID
  "channelId": "01HXY...", // ULID
  "authorId": "01HXY...", // ULID (User or Agent)
  "authorType": "USER", // "USER" | "AGENT" | "SYSTEM"
  "authorName": "alice", // display name for rendering
  "authorAvatarUrl": null, // string or null
  "content": "Hello world",
  "type": "STANDARD", // "STANDARD" | "STREAMING" | "SYSTEM" | "TOOL_CALL" | "TOOL_RESULT" | "CODE_BLOCK" | "ARTIFACT" | "STATUS"
  "streamingStatus": null, // null | "ACTIVE" | "COMPLETE" | "ERROR"
  "sequence": "42", // per-channel sequence number (BigInt-safe decimal string)
  "createdAt": "2026-02-23T12:00:00.000Z",
  "editedAt": null, // ISO 8601 string or null (TASK-0014)
  "metadata": null, // object or null — agent execution metadata (TASK-0039)
  "tokenHistory": null, // [{o: number, t: number}] or null — stream rewind data (TASK-0021)
  "checkpoints": null // [{index, label, contentOffset, timestamp}] or null — checkpoint resume data (TASK-0021)
}
```

#### StreamStartPayload

```json
{
  "messageId": "01HXY...", // ULID of the placeholder message
  "agentId": "01HXY...",
  "agentName": "Claude Assistant",
  "agentAvatarUrl": null,
  "sequence": "43"
}
```

#### StreamTokenPayload

```json
{
  "messageId": "01HXY...",
  "token": "Hello", // the text chunk
  "index": 0 // monotonically increasing, 0-based
}
```

#### StreamCompletePayload

```json
{
  "messageId": "01HXY...",
  "finalContent": "Hello! How can I help you today?",
  "thinkingTimeline": [
    { "phase": "Thinking", "timestamp": "..." },
    { "phase": "Writing", "timestamp": "..." }
  ],
  "metadata": {
    "model": "claude-sonnet-4-20250514",
    "provider": "anthropic",
    "tokensIn": 150,
    "tokensOut": 843,
    "latencyMs": 2300,
    "costUsd": 0.0042
  }
}
```

#### StreamErrorPayload

```json
{
  "messageId": "01HXY...",
  "error": "Provider returned 429: rate limited",
  "partialContent": "Hello! How can I" // may be null
}
```

#### StreamThinkingPayload

```json
{
  "messageId": "01HXY...",
  "phase": "Thinking", // configurable via agent's thinkingSteps
  "timestamp": "2026-03-01T12:00:00.123Z" // ISO 8601
}
```

Lifecycle: Go Proxy emits phase[0] from agent config's `thinkingSteps` after loading agent config (about to call LLM), then phase[1] when the first token arrives. Default phases: `["Thinking","Writing"]`. Custom phases (e.g. `["Planning","Researching","Drafting","Reviewing"]`) are configurable per agent. The frontend clears the phase on `stream_complete` or `stream_error`. See DEC-0037.

The Go Proxy accumulates all phase transitions into a `thinkingTimeline` array and includes it in the `PUT /api/internal/messages/{messageId}` finalization payload for post-completion replay.

#### StreamToolCallPayload

```json
{
  "messageId": "01HXY...",
  "callId": "toolu_01ABC...",
  "toolName": "current_time",
  "arguments": {},
  "timestamp": "2026-03-01T12:00:01.456Z"
}
```

Published when the LLM requests a tool execution. The Go Proxy detects `stop_reason: "tool_use"` from the provider, publishes this event, then executes the tool. The frontend uses this to show "Using current_time" in the thinking phase. (TASK-0018, DEC-0048)

#### StreamToolResultPayload

```json
{
  "messageId": "01HXY...",
  "callId": "toolu_01ABC...",
  "toolName": "current_time",
  "content": "Current time: 2026-03-01T12:00:01Z\nDate: 2026-03-01\nDay: Sunday",
  "isError": false,
  "timestamp": "2026-03-01T12:00:01.789Z"
}
```

Published after tool execution completes. The Go Proxy then feeds the tool result back into the LLM context and starts a new provider iteration. The tool execution loop is capped at 10 iterations to prevent infinite loops. (TASK-0018, DEC-0048)

#### StreamCheckpointPayload

```json
{
  "messageId": "01HXY...",
  "index": 0,
  "label": "After tool: current_time",
  "contentOffset": 245,
  "timestamp": "2026-03-01T12:00:02.000Z"
}
```

Published at semantically meaningful points during streaming: thinking phase transitions and tool call boundaries. Checkpoints enable two features:

1. **Stream Rewind** — After completion, the client can replay token history and jump to checkpoint positions on the scrub slider. Token history (`[{o: contentOffset, t: relativeMs}]`) and checkpoints are persisted on the Message record.
2. **Checkpoint Resume** — On stream error, the user can select a checkpoint and a different agent/model to resume generation from that point. Resume creates a new message with context up to the checkpoint's `contentOffset`.

The Go Proxy accumulates all checkpoints and includes them in the `PUT /api/internal/messages/{messageId}` finalization payload alongside `tokenHistory`. (TASK-0021, DEC-0053)

#### TypedMessagePush

Client → Server push from agents to create a typed message. AGENT-only — human users cannot push this event.

```json
{
  "type": "TOOL_CALL",
  "content": {
    "callId": "search_web",
    "toolName": "search_web",
    "arguments": { "query": "Elixir BEAM VM" },
    "status": "running"
  }
}
```

Valid types: `TOOL_CALL`, `TOOL_RESULT`, `CODE_BLOCK`, `ARTIFACT`, `STATUS`.
Content is type-specific (see [Typed Message Content Shapes](#typed-message-content-shapes)).

#### TypedMessagePayload

Server → Client broadcast for typed messages. Same structure as [MessagePayload](#messagepayload) with `type` set to one of the typed message types and `content` as a JSON string.

```json
{
  "id": "01HXY...",
  "channelId": "01HXY...",
  "authorId": "01HXY...",
  "authorType": "AGENT",
  "authorName": "My Agent",
  "authorAvatarUrl": null,
  "content": "{\"callId\":\"search_web\",\"toolName\":\"search_web\",\"arguments\":{\"query\":\"Elixir\"},\"status\":\"running\"}",
  "type": "TOOL_CALL",
  "streamingStatus": null,
  "sequence": "44",
  "createdAt": "2026-03-01T12:00:00.000Z",
  "editedAt": null,
  "metadata": null
}
```

#### Typed Message Content Shapes

##### TOOL_CALL

```json
{
  "callId": "search_web_1",
  "toolName": "search_web",
  "arguments": { "query": "Elixir BEAM VM" },
  "status": "running"
}
```

`status`: `"pending"` | `"running"` | `"completed"` | `"failed"`.

##### TOOL_RESULT

```json
{
  "callId": "search_web_1",
  "result": { "url": "https://...", "title": "..." },
  "error": null,
  "durationMs": 450
}
```

##### CODE_BLOCK

```json
{
  "language": "python",
  "code": "def hello():\n    print('Hello!')",
  "filename": "hello.py"
}
```

##### ARTIFACT

```json
{
  "artifactType": "html",
  "title": "Dashboard Preview",
  "content": "<div>...</div>"
}
```

`artifactType`: `"html"` | `"svg"` | `"file"`.

##### STATUS

```json
{
  "state": "searching",
  "detail": "Querying knowledge base..."
}
```

`state`: `"thinking"` | `"searching"` | `"coding"` | `"done"`.

#### MessageMetadata

Optional metadata on agent messages. Persisted in `Message.metadata` (JSONB). Set on `stream_complete` or directly on typed messages.

```json
{
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "tokensIn": 150,
  "tokensOut": 843,
  "latencyMs": 2300,
  "costUsd": 0.0042
}
```

All fields optional. Frontend renders as a collapsible bar: `Claude Sonnet 4 · 843 tokens · 2.3s`.

#### AgentTriggerSkippedPayload

Emitted when an agent exists in the channel but was not triggered (e.g., agent requires @mention but was not mentioned). The frontend uses this to show a hint to the user.

```json
{
  "agentId": "01HXY...",
  "agentName": "Jack",
  "triggerMode": "MENTION",
  "reason": "mention_required"
}
```

#### TypingPayload

```json
{
  "userId": "01HXY...",
  "username": "alice",
  "displayName": "Alice"
}
```

#### MessageEditedPayload

```json
{
  "messageId": "01HXY...",
  "content": "Updated message text",
  "editedAt": "2026-03-01T12:00:00.000Z"
}
```

Broadcast to all clients in channel when a message is edited. The Gateway calls the internal API synchronously before broadcasting — correctness > speed for edits. Only the message author can edit; agent messages cannot be edited.

#### MessageDeletedPayload

```json
{
  "messageId": "01HXY...",
  "deletedBy": "01HXY..."
}
```

Broadcast to all clients in channel when a message is soft-deleted. The author can delete own messages. Users with `MANAGE_MESSAGES` permission (bit 8) can delete any message. The internal API validates authorization; Gateway only broadcasts on success.

#### ReactionUpdatePayload

```json
{
  "messageId": "01HXY...",
  "reactions": [
    { "emoji": "👍", "count": 2, "userIds": ["01HXY...", "01HXZ..."] },
    { "emoji": "❤️", "count": 1, "userIds": ["01HXY..."] }
  ]
}
```

Broadcast to all clients in the channel (room or DM) when a reaction is added or removed. The `reactions` array is the full aggregated state — clients replace their local reactions for the given `messageId`. For room channels, broadcast via the room reaction API (`/api/messages/{messageId}/reactions`). For DM channels, broadcast via the DM reaction API (`/api/dms/{dmId}/messages/{messageId}/reactions`). Both APIs broadcast to their respective channel topic (`room:{channelId}` or `dm:{dmId}`). (TASK-0030)

---

## 2. Redis Pub/Sub Events

All Redis messages are JSON-encoded strings.

### Channel Patterns

| Redis Channel                                     | Publisher | Subscriber                   | Description                                     |
| ------------------------------------------------- | --------- | ---------------------------- | ----------------------------------------------- |
| `hive:channel:{channelId}:messages`               | Gateway   | (future: indexer, analytics) | New persisted message notification              |
| `hive:stream:request`                             | Gateway   | Go Proxy                     | Request AI response for a message               |
| `hive:stream:tokens:{channelId}:{messageId}`      | Go Proxy  | Gateway                      | Individual tokens from LLM                      |
| `hive:stream:status:{channelId}:{messageId}`      | Go Proxy  | Gateway                      | Stream completion or error                      |
| `hive:stream:thinking:{channelId}:{messageId}`    | Go Proxy  | Gateway                      | Agent thinking phase change (TASK-0011)         |
| `hive:stream:tool_call:{channelId}:{messageId}`   | Go Proxy  | Gateway                      | Tool call requested by LLM (TASK-0018)          |
| `hive:stream:tool_result:{channelId}:{messageId}` | Go Proxy  | Gateway                      | Tool execution result (TASK-0018)               |
| `hive:stream:checkpoint:{channelId}:{messageId}`  | Go Proxy  | Gateway                      | Stream checkpoint for rewind/resume (TASK-0021) |

### Stream Request Payload

Published by Gateway when a message triggers an AI response:

```json
{
  "channelId": "01HXY...",
  "messageId": "01HXY...",
  "agentId": "01HXY...",
  "triggerMessageId": "01HXY...",
  "contextMessages": [
    { "role": "user", "content": "What is Elixir?" },
    {
      "role": "assistant",
      "content": "Elixir is a functional programming language..."
    },
    { "role": "user", "content": "How does it compare to Go?" }
  ]
}
```

### Stream Token Payload

Published by Go Proxy for each token received from LLM:

```json
{
  "messageId": "01HXY...",
  "token": "Hello",
  "index": 0
}
```

### Stream Status Payload

Published by Go Proxy on stream completion or error:

```json
{
  "messageId": "01HXY...",
  "status": "complete",
  "finalContent": "Hello! How can I help you today?",
  "error": null,
  "tokenCount": 12,
  "durationMs": 1450
}
```

For errors:

```json
{
  "messageId": "01HXY...",
  "status": "error",
  "finalContent": null,
  "error": "Provider returned 429: rate limited",
  "partialContent": "Hello! How can I",
  "tokenCount": 4,
  "durationMs": 800
}
```

### Stream Thinking Payload

Published by Go Proxy when the agent's thinking phase changes:

```json
{
  "messageId": "01HXY...",
  "phase": "Thinking",
  "timestamp": "2026-03-01T12:00:00.123Z"
}
```

Phases are configurable per agent via `thinkingSteps` (default: `["Thinking","Writing"]`). Cleared by `stream_complete` or `stream_error` on the frontend.

### Sequence Number Assignment

Per-channel sequence numbers are assigned via Redis atomic increment:

```text
INCR hive:channel:{channelId}:seq
```

This returns the next sequence number. Used by Gateway before persisting any message.

---

## 3. HTTP Internal APIs

All internal APIs require the header:

```http
X-Internal-Secret: {INTERNAL_API_SECRET}
```

Requests missing this header or with an invalid secret receive `401 Unauthorized`.

### Gateway → Next.js (Web)

Base URL: `http://web:5555` (Docker internal network)

#### POST /api/internal/messages

Persist a new message.

**Request body:**

```json
{
  "id": "01HXY...",
  "channelId": "01HXY...",
  "authorId": "01HXY...",
  "authorType": "USER",
  "content": "Hello world",
  "type": "STANDARD",
  "streamingStatus": null,
  "sequence": "42"
}
```

**Response:** `201 Created` with the persisted message.

#### GET /api/internal/messages

Fetch messages for reconnection sync or history.

**Query params:**

- `channelId` (required): ULID
- `afterSequence` (optional): decimal string; return messages with sequence > N
- `before` (optional): return messages with id < ULID (cursor pagination)
- `limit` (optional): max results (default 50, max 100)

**Response:** `200 OK`

```json
{
  "messages": [MessagePayload, ...],
  "hasMore": true
}
```

#### GET /api/internal/channels/{channelId}/agent

Get the default agent configuration for a channel.

**Response:** `200 OK` with agent config, or `404` if no default agent.

```json
{
  "id": "01HXY...",
  "name": "Claude Assistant",
  "llmProvider": "anthropic",
  "llmModel": "claude-sonnet-4-20250514",
  "apiEndpoint": "https://api.anthropic.com",
  "systemPrompt": "You are a helpful assistant.",
  "temperature": 0.7,
  "maxTokens": 4096,
  "triggerMode": "ALWAYS"
}
```

Note: `apiKeyEncrypted` is decrypted server-side and included as `apiKey` in this internal response only.

#### GET /api/internal/channels/{channelId}/agents

Get ALL agents assigned to a channel (multi-agent — TASK-0012). Falls back to the single `defaultAgent` if no ChannelAgent entries exist.

**Response:** `200 OK` with array of agent configs.

```json
{
  "agents": [
    {
      "id": "01HXY...",
      "name": "Claude Assistant",
      "llmProvider": "anthropic",
      "llmModel": "claude-sonnet-4-20250514",
      "apiEndpoint": "https://api.anthropic.com",
      "systemPrompt": "You are a helpful assistant.",
      "temperature": 0.7,
      "maxTokens": 4096,
      "triggerMode": "ALWAYS"
    },
    {
      "id": "01HXZ...",
      "name": "GPT Helper",
      "llmProvider": "openai",
      "llmModel": "gpt-4o",
      "apiEndpoint": "https://api.openai.com",
      "systemPrompt": "You are a helpful assistant.",
      "temperature": 0.7,
      "maxTokens": 4096,
      "triggerMode": "ALWAYS"
    }
  ]
}
```

Note: Each agent's `apiKeyEncrypted` is decrypted server-side and included as `apiKey`. Returns `{"agents": []}` if no agents assigned. See DEC-0038.

#### PATCH /api/internal/messages/{messageId}

Edit a message's content. Called by Gateway on `message_edit` WebSocket event. (TASK-0014)

**Request body:**

```json
{
  "userId": "01HXY...",
  "content": "Updated message text"
}
```

**Validations:**

- Message exists and is not deleted
- `authorType` is not AGENT
- `authorId === userId` (only author can edit)
- `streamingStatus` is not ACTIVE
- `content` is non-empty, max 4000 chars

**Response:** `200 OK`

```json
{
  "messageId": "01HXY...",
  "content": "Updated message text",
  "editedAt": "2026-03-01T12:00:00.000Z"
}
```

**Errors:** `400` (bad input), `403` (not author / agent message), `404` (not found / deleted), `409` (active stream)

#### DELETE /api/internal/messages/{messageId}

Soft-delete a message. Called by Gateway on `message_delete` WebSocket event. (TASK-0014)

**Request body:**

```json
{
  "userId": "01HXY..."
}
```

**Authorization:** Author can always delete own messages. Non-authors need `MANAGE_MESSAGES` permission (bit 8) on the server.

**Response:** `200 OK`

```json
{
  "messageId": "01HXY...",
  "deletedBy": "01HXY..."
}
```

**Errors:** `403` (not author and missing permission), `404` (not found / already deleted)

#### GET /api/internal/agents/verify

Verify an agent API key. Called by Gateway on WebSocket connect with `?api_key=sk-tvk-...` (DEC-0040).

**Query params:**

- `api_key` (required): the raw API key string (`sk-tvk-...`)

**Response:** `200 OK`

```json
{
  "valid": true,
  "agentId": "01HXY...",
  "agentName": "My Agent",
  "agentAvatarUrl": null,
  "serverId": "01HXY...",
  "capabilities": ["text"]
}
```

On invalid/expired key: `200 OK` with `{"valid": false, "error": "..."}`.

#### GET /api/internal/channels/{channelId}

Get channel metadata including serverId. Used for agent channel authorization.

**Query params (optional):**

- `userId`: check membership for this user

**Response:** `200 OK`

```json
{
  "serverId": "01HXY...",
  "lastSequence": "42",
  "isMember": true
}
```

### Bootstrap API (DEC-0051)

First-run setup endpoint. Creates admin user, default server, and enables agent registration. Called by the CLI after services are healthy.

#### POST /api/v1/bootstrap

**Auth:** `Authorization: Bearer admin-{TAVOK_ADMIN_TOKEN}` (from `.env`)

**Guards (all must pass):**

1. Valid admin token
2. User count === 0 (first-run only)
3. Rate limit: 3 per 60s per IP

**Request body:**

```json
{
  "email": "admin@localhost",
  "username": "admin",
  "password": "generated-password",
  "displayName": "Admin",
  "serverName": "Tavok"
}
```

**Response:** `201 Created`

```json
{
  "admin": { "email": "admin@localhost", "username": "admin" },
  "server": { "id": "01KK...", "name": "Tavok" },
  "channel": { "id": "01KK...", "name": "general" },
  "urls": {
    "web": "http://localhost:5555",
    "gateway": "ws://localhost:4001/socket"
  }
}
```

**Error responses:**

- `401` — Missing or invalid admin token
- `403` — Already bootstrapped (users exist in database)
- `429` — Rate limited

#### POST /api/v1/bootstrap/agents (DEC-0060)

Create an agent via CLI. Admin token required (`Authorization: Bearer admin-{TAVOK_ADMIN_TOKEN}`).

**Request body:**

```json
{
  "name": "Jack",
  "serverId": "01HXY...",
  "connectionMethod": "WEBSOCKET"
}
```

Required: `name`, `serverId`. `connectionMethod` defaults to `WEBSOCKET`.

**Response:** `201 Created`

```json
{
  "id": "01HXY...",
  "name": "Jack",
  "apiKey": "sk-tvk-...",
  "serverId": "01HXY...",
  "connectionMethod": "WEBSOCKET",
  "websocketUrl": "ws://localhost:4001/socket/websocket"
}
```

**Error responses:**

- `401` — Missing or invalid admin token
- `400` — Missing name or serverId
- `404` — Server not found

### Public Agent API (DEC-0040)

These endpoints are publicly accessible (no internal secret required). Agents authenticate via `Authorization: Bearer sk-tvk-...` where noted.

Base URL: `http://localhost:5555` (or production URL)

#### GET /api/v1/agents/{id}

Get public agent info. No auth required.

**Response:** `200 OK`

```json
{
  "id": "01HXY...",
  "name": "My Agent",
  "avatarUrl": null,
  "serverId": "01HXY...",
  "capabilities": ["text", "code"],
  "isActive": true,
  "createdAt": "2026-03-01T12:00:00.000Z"
}
```

#### PATCH /api/v1/agents/{id}

Update agent configuration. Requires `Authorization: Bearer sk-tvk-...`.

**Request body (all fields optional):**

```json
{
  "displayName": "Updated Name",
  "capabilities": ["text", "code", "web_search"],
  "healthUrl": "http://new-url:8080/health",
  "systemPrompt": "Updated prompt"
}
```

**Response:** `200 OK` with updated agent info.

#### DELETE /api/v1/agents/{id}

Deregister an agent. Cascade deletes Agent + AgentRegistration. Requires `Authorization: Bearer sk-tvk-...`.

**Response:** `200 OK`

```json
{
  "ok": true,
  "message": "Agent deregistered"
}
```

### Go Proxy → Next.js (Web)

#### GET /api/internal/agents/{agentId}

Full agent configuration including decrypted API key.

**Response:** Same as channel agent endpoint above.

#### PUT /api/internal/messages/{messageId}

Update a streaming message on completion or error. Used by Go Proxy to finalize placeholder messages.

**Request body:**

```json
{
  "content": "Hello! How can I help you today?",
  "streamingStatus": "COMPLETE",
  "thinkingTimeline": "[{\"phase\":\"Thinking\",\"timestamp\":\"...\"},{\"phase\":\"Writing\",\"timestamp\":\"...\"}]",
  "metadata": {
    "model": "claude-sonnet-4-20250514",
    "tokensOut": 843,
    "latencyMs": 2300
  }
}
```

For errors:

```json
{
  "content": "Hello! How can I",
  "streamingStatus": "ERROR",
  "thinkingTimeline": "[{\"phase\":\"Thinking\",\"timestamp\":\"...\"}]"
}
```

The `thinkingTimeline` field is optional. If provided, it is a JSON string containing an array of `{phase, timestamp}` objects. Stored in Message.thinkingTimeline for post-completion replay.

The `metadata` field is optional (TASK-0039). If provided, it is a JSON object containing agent execution info (model, provider, tokensIn, tokensOut, latencyMs, costUsd). Stored in Message.metadata for frontend display.

The `tokenHistory` field is optional (TASK-0021). If provided, it is a JSON string containing an array of `{o: contentOffset, t: relativeMs}` objects. Each entry marks where a token batch ends in the final content and when it arrived. Stored in Message.tokenHistory for stream rewind replay.

The `checkpoints` field is optional (TASK-0021). If provided, it is a JSON string containing an array of `{index, label, contentOffset, timestamp}` objects. Stored in Message.checkpoints for checkpoint resume.

**Response:** `200 OK` with updated message fields (`id`, `content`, `streamingStatus`).

#### POST /api/internal/stream/resume

Resume a streaming message from a checkpoint. Creates a new STREAMING message with content up to the checkpoint's offset, ready for continuation by a different agent/model. (TASK-0021)

**Request body:**

```json
{
  "channelId": "01HXY...",
  "originalMessageId": "01HXY...",
  "checkpointIndex": 2,
  "agentId": "01HXY...",
  "userId": "01HXY..."
}
```

**Response:** `201 Created`

```json
{
  "messageId": "01HXY...",
  "channelId": "01HXY...",
  "agentId": "01HXY...",
  "agentName": "GPT-4",
  "content": "partial content up to checkpoint..."
}
```

**Errors:** `400` (missing fields), `404` (original message not found or no checkpoints), `500` (creation failure)

#### GET /api/internal/messages/{messageId}

Fetch a single message by ID. Used by Gateway StreamWatchdog to check stream terminal state.

**Response:** `200 OK` with message fields (`id`, `channelId`, `content`, `type`, `streamingStatus`), or `404` if not found.

### Session-Authenticated Endpoints (TASK-0016)

These endpoints use NextAuth session cookies (not internal secret). Called directly by the frontend.

#### POST /api/servers/{serverId}/channels/{channelId}/read

Mark a channel as read for the current user. Upserts `ChannelReadState` with `lastReadSeq = channel.lastSequence` and resets `mentionCount = 0`.

**Auth:** NextAuth session (cookie)

**Response:** `200 OK`

```json
{ "ok": true }
```

**Errors:** `401` (not authenticated), `403` (not a member)

#### GET /api/servers/{serverId}/unread

Get unread state for all channels in a server. Compares each channel's `lastSequence` with the user's `ChannelReadState.lastReadSeq`.

**Auth:** NextAuth session (cookie)

**Response:** `200 OK`

```json
{
  "channels": [
    {
      "channelId": "01HXY...",
      "hasUnread": true,
      "mentionCount": 2,
      "lastReadSeq": "42"
    }
  ]
}
```

**Errors:** `401` (not authenticated), `403` (not a member)

---

## 4. Streaming Lifecycle State Machine

```
         +----------+
         |   IDLE   |
         +----+-----+
              |
              | Gateway receives trigger message
              | Gateway publishes stream request to Redis
              | Gateway creates placeholder message (type=STREAMING, status=ACTIVE)
              | Gateway broadcasts stream_start to room
              |
              v
         +----------+
         |  ACTIVE  |<---- stream_token (repeats, index 0, 1, 2, ...)
         +----+-----+
              |
         +----+-----+
         |           |
    stream_complete  stream_error
         |           |
         v           v
    +----------+ +----------+
    | COMPLETE | |  ERROR   |
    +----------+ +----------+
```

### Invariants (MUST NOT be violated)

1. **Placeholder persisted before first token**: A message row with `type=STREAMING, streamingStatus=ACTIVE` MUST be persisted before the first `stream_token` arrives. The Gateway broadcasts `stream_start` and spawns background persistence concurrently. Go Proxy startup latency (~100ms+) provides natural timing margin. See DEC-0028.

2. **Token ordering**: Tokens carry a monotonically increasing `index` starting at 0. The client MUST render tokens in order. If a token arrives out of order, buffer and apply in sequence.

3. **Single writer**: Only one stream can be active per `messageId`. The Go Proxy owns the stream lifecycle for a given message.

4. **Completion persistence**: On `stream_complete`, the Go Proxy calls `PUT /api/internal/messages/{messageId}` to update the message with `streamingStatus=COMPLETE` and `content=finalContent`.

5. **Error persistence**: On `stream_error`, the Go Proxy calls `PUT /api/internal/messages/{messageId}` to update the message with `streamingStatus=ERROR` and `content=partialContent` (may be empty string).

6. **Client cleanup**: When a user switches channels, the client MUST stop rendering any active streams from the previous channel. On rejoin, stream state is reconstructed from the persisted message.

7. **Timeout**: If no token arrives for 30 seconds during an active stream, the Gateway publishes a `stream_error` and transitions to ERROR state.

---

## 4b. Message Delivery Semantics

### Broadcast-First with Background Persistence (DEC-0028)

The Gateway uses a **broadcast-first** pattern for all messages:

1. **User messages**: Gateway generates ULID + Redis sequence, broadcasts `message_new` to all clients immediately, then persists to PostgreSQL in a background task.
2. **Streaming placeholders**: Gateway generates ULID + Redis sequence, broadcasts `stream_start` immediately, then persists the placeholder in a background task concurrently with LLM context fetch.

**Why**: The broadcast payload is built entirely from in-memory data (socket assigns, ULID, Redis sequence, `DateTime.utc_now()`). There is zero dependency on the database response. Persisting first added 5-60ms of blocking latency per message — at 1000 users in one channel, this would queue all messages behind each HTTP call, freezing the Elixir channel process.

**Retry semantics**: Background persistence retries up to 3 times with exponential backoff (1s, 2s, 4s). The Web API returns 409 on duplicate message IDs, which the retry logic treats as success (idempotency guard).

**Failure mode**: If persistence permanently fails (Web API down for 7+ seconds), the message is visible in real-time sessions but absent from history/sync on refresh. This is logged at CRITICAL level. At 1000 users, real-time availability is prioritized over durability for edge-case infrastructure failures.

**Reconnection safety**: Client's `lastSequence` is updated on broadcast receipt (not on persist confirmation). Sync queries use `WHERE sequence > N` which handles gaps gracefully — the client never checks sequence contiguity.

---

## 5. Reconnection Sync Protocol

### Flow

```
1. Client disconnects (network drop, tab sleep, browser crash)
2. Phoenix JS client auto-reconnects with exponential backoff
3. Client re-joins room:{channelId}
   - Join params include: {lastSequence: N}
   - N = highest sequence number the client has seen for this channel
4. Gateway receives join with lastSequence
5. Gateway calls: GET /api/internal/messages?channelId=X&afterSequence=N&limit=100
6. Gateway sends sync_response to the rejoining client
7. If hasMore=true, client sends additional sync events to paginate
8. Phoenix.Presence automatically re-syncs presence state on rejoin
```

### Client-Side Responsibilities

- Track `lastSequence` per channel in memory (and optionally localStorage for crash recovery)
- On receiving `message_new` or `stream_complete`, update `lastSequence`
- On reconnect + rejoin, send `lastSequence` in join params
- Deduplicate: if a synced message ID already exists in the local message list, skip it
- Sort by sequence number after merging synced messages

### Edge Cases

- **Client has no lastSequence** (first join): Server returns no sync, client loads history via `history` event
- **Gap too large** (100+ messages missed): `hasMore=true`, client paginates or shows "X messages missed" UI
- **Active stream during disconnect**: On rejoin, the persisted message will have `streamingStatus=ACTIVE|COMPLETE|ERROR`. Client renders final state, does not attempt to resume streaming.

---

## 6. Authentication Flow

### 6a. Human Auth (JWT)

#### JWT Structure

```json
{
  "sub": "01HXY...", // user ID (ULID)
  "username": "alice",
  "displayName": "Alice",
  "email": "alice@example.com",
  "iat": 1708700000,
  "exp": 1708786400 // 24h expiry
}
```

#### Flow

1. User logs in via Next.js (`/api/auth/signin`)
2. NextAuth creates a session and issues a JWT signed with `JWT_SECRET`
3. Client stores JWT (httpOnly cookie for web, also available via NextAuth session)
4. Client extracts JWT and passes it as query param on WebSocket connect
5. Gateway validates JWT signature using `JWT_SECRET` (shared secret, no round-trip)
6. Gateway extracts `sub`, `username`, `displayName` and assigns to socket with `author_type=USER`

#### Token Refresh

- JWT has 24h expiry
- Client refreshes via NextAuth session refresh (automatic)
- On WebSocket disconnect due to expired token, client fetches new token and reconnects

### 6b. Agent Auth (API Key — DEC-0040)

#### API Key Format

```
sk-tvk-{32 random bytes base64url encoded}
```

Total length: 49 characters. Prefix `sk-tvk-` enables quick format validation.

#### Agent Creation Flow (DEC-0060)

Agents are created by server owners, not by self-registration.

**Via CLI (`tavok init`):**

1. CLI calls `POST /api/v1/bootstrap/agents` with `{name, serverId}`
2. Server creates Agent + AgentRegistration, generates API key
3. API key returned once; CLI saves to `.tavok-agents.json`
4. SDK auto-discovers credentials: `Agent(name="Jack")` just works

**Via Web UI:**

1. User opens Manage Agents modal, clicks Add Agent
2. Fills in agent details, selects connection method
3. Server creates Agent + AgentRegistration via internal API

#### WebSocket Connection Flow

1. Agent connects: `ws://host:4001/socket/websocket?api_key=sk-tvk-...&vsn=2.0.0`
2. Gateway checks `sk-tvk-` prefix format
3. Gateway calls `GET /api/internal/agents/verify?api_key=sk-tvk-...` (internal network)
4. Next.js hashes the key with SHA-256, looks up AgentRegistration by hash
5. Returns `{valid: true, agentId, agentName, agentAvatarUrl, serverId, capabilities}`
6. Gateway assigns socket: `user_id=agentId`, `username=agentName`, `author_type=AGENT`, `server_id`

#### Channel Join Authorization

- Agents can join any channel in their server
- On `phx_join` for `room:{channelId}`, Gateway calls `GET /api/internal/channels/{channelId}`
- Checks that `response.serverId == socket.assigns.server_id`
- If match: join succeeds. If mismatch: join rejected with `{:error, %{reason: "unauthorized"}}`

### 6c. Internal API Auth

Internal service-to-service calls use a shared `INTERNAL_API_SECRET` header.
This is NOT JWT — it's a simple shared secret for the internal Docker network only.
In production, these endpoints are not exposed to the public internet.

---

## 7. Agent Connectivity (DEC-0044 through DEC-0046)

Tavok supports 6 connection methods for agents. All methods converge to the same Phoenix Channel events via the Gateway Broadcast Controller — the UI never changes regardless of how an agent connects.

### 7a. Connection Methods

| #   | Method                | Direction           | Streaming                            | Use Case                                       |
| --- | --------------------- | ------------------- | ------------------------------------ | ---------------------------------------------- |
| 1   | **WebSocket**         | Bidirectional       | Native                               | Python SDK, TS SDK, any WS client (existing)   |
| 2   | **Inbound Webhook**   | Agent → Tavok       | Yes (batch POST)                     | curl, CI/CD, n8n, Zapier, monitoring, scripts  |
| 3   | **HTTP Webhook**      | Tavok → Agent       | Yes (SSE response or async callback) | LangGraph, CrewAI, Slack/Telegram-style agents |
| 4   | **REST Polling**      | Agent polls Tavok   | Yes (REST stream endpoint)           | Serverless (Lambda), cron, Telegram getUpdates |
| 5   | **SSE**               | Tavok pushes events | Yes (receive via SSE)                | Browser agents, restrictive proxies            |
| 6   | **OpenAI-Compatible** | Standard API        | Yes (SSE relay)                      | LiteLLM, LangChain, any OpenAI SDK client      |

### 7b. Architecture — Adapter Layer

All non-WebSocket connection methods converge to the same Phoenix Channel events via a single REST endpoint on the Gateway:

```
Agent (any method) → Next.js Adapter → POST /api/internal/broadcast → Phoenix PubSub → Browser
```

The Gateway Broadcast Controller accepts `{topic, event, payload}` and calls `Broadcast.endpoint_broadcast!/3`.

### 7c. Auth Model

All methods use the same `sk-tvk-...` API key. Inbound webhooks additionally use `whk_...` tokens embedded in URLs.

| Method                  | Auth                               | Validated By              |
| ----------------------- | ---------------------------------- | ------------------------- |
| WebSocket               | `?api_key=sk-tvk-...`              | Gateway → internal verify |
| Inbound Webhook         | `whk_...` in URL path              | Next.js token lookup      |
| HTTP Webhook (outbound) | `X-Tavok-Signature: sha256=HMAC`   | Agent verifies            |
| REST Polling            | `Authorization: Bearer sk-tvk-...` | Next.js hash lookup       |
| SSE                     | Header or `?api_key=sk-tvk-...`    | Next.js hash lookup       |
| OpenAI-Compatible       | `Authorization: Bearer sk-tvk-...` | Next.js hash lookup       |

### 7d. Inbound Webhook API

Discord-style "URL is the auth" pattern. The `whk_...` token in the URL path serves as both identifier and credential.

#### POST /api/v1/webhooks

Create a new inbound webhook. Requires `Authorization: Bearer sk-tvk-...`.

**Request body:**

```json
{
  "channelId": "01HXY...",
  "name": "CI Notifier"
}
```

**Response:** `201 Created`

```json
{
  "id": "01HXY...",
  "token": "whk_...",
  "url": "http://localhost:5555/api/v1/webhooks/whk_...",
  "channelId": "01HXY...",
  "name": "CI Notifier"
}
```

#### GET /api/v1/webhooks

List webhooks. Requires `Authorization: Bearer sk-tvk-...`. Query param: `serverId` (required). Tokens are NOT returned.

#### DELETE /api/v1/webhooks?webhookId={id}

Delete a webhook. Requires `Authorization: Bearer sk-tvk-...`.

#### POST /api/v1/webhooks/{token}

Send a message via inbound webhook. No auth header needed — the token IS the auth.

**Request body:**

```json
{
  "content": "Build passed!",
  "username": "CI Agent",
  "avatarUrl": "https://example.com/ci.png"
}
```

**Response:** `200 OK` with `{messageId, sequence}`.

For streaming, send `{"streaming": true}` to get a `{messageId, streamUrl}` response.

#### POST /api/v1/webhooks/{token}/stream

Stream tokens via inbound webhook.

**Request body:**

```json
{ "tokens": ["Hello ", "world!"], "done": false }
```

Final: `{"tokens": ["!"], "done": true, "finalContent": "Hello world!", "metadata": {...}}`

### 7e. HTTP Webhook (Outbound)

When a WEBHOOK-method agent is triggered by a message, the Gateway calls `WebClient.dispatch_webhook/2` which POSTs to Next.js `POST /api/internal/agents/{agentId}/dispatch`. Next.js then POSTs to the agent's `webhookUrl` with HMAC-SHA256 signing.

**Outbound payload (Tavok → Agent):**

```json
{
  "event": "message",
  "channelId": "01HXY...",
  "triggerMessage": {
    "id": "...",
    "content": "...",
    "authorName": "...",
    "authorType": "USER"
  },
  "contextMessages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "callbackUrl": "http://localhost:5555/api/v1/webhooks/{auto_token}/stream"
}
```

**Headers:** `X-Tavok-Signature: sha256=<HMAC_hex>`, `X-Tavok-Event: message`, `Content-Type: application/json`

**Agent response patterns:**

- **Sync:** Return `200` with `{"content": "..."}` → broadcast as `message_new`
- **Async:** Return `202 Accepted`, later POST to `callbackUrl`

### 7f. REST Polling API

#### GET /api/v1/agents/{id}/messages

Poll for messages. Requires `Authorization: Bearer sk-tvk-...`.

**Query params:**

- `channel_id` — optional channel filter
- `limit` — max messages (default 50, max 100)
- `ack` — if `true`, mark returned messages as delivered
- `wait` — long-polling timeout in seconds (0-30, default 0)

**Response:** `200 OK`

```json
{
  "messages": [
    {
      "id": "01HXY...",
      "channelId": "01HXY...",
      "messageId": "01HXY...",
      "content": "Hello!",
      "authorId": "01HXY...",
      "authorName": "Alice",
      "authorType": "USER",
      "createdAt": "2026-03-01T12:00:00.000Z"
    }
  ],
  "hasMore": false,
  "pollAgainAfterMs": 1000
}
```

#### POST /api/v1/agents/{id}/messages

Send a message or start streaming. Requires `Authorization: Bearer sk-tvk-...`.

**Simple message:** `{"channelId": "...", "content": "Hello!"}`
**Start streaming:** `{"channelId": "...", "streaming": true}` → returns `{messageId, sequence, streamUrl}`

#### POST /api/v1/agents/{id}/messages/{messageId}/stream

Stream tokens. Requires `Authorization: Bearer sk-tvk-...`.

**Tokens:** `{"tokens": ["Hello ", "world!"], "done": false, "channelId": "..."}`
**Complete:** `{"tokens": [], "done": true, "finalContent": "...", "channelId": "...", "metadata": {...}}`
**Thinking:** `{"thinking": {"phase": "Searching", "detail": "..."}, "channelId": "..."}`
**Error:** `{"error": "Something went wrong", "channelId": "..."}`

### 7g. SSE Event Stream

#### GET /api/v1/agents/{id}/events

Server-Sent Events stream. Auth via `Authorization: Bearer sk-tvk-...` header or `?api_key=sk-tvk-...` query param.

**Query params:** `channels` (required, comma-separated channel IDs)

**Events:**

| Event         | Data                                                                   | Description                       |
| ------------- | ---------------------------------------------------------------------- | --------------------------------- |
| `connected`   | `{agentId, channels, timestamp}`                                       | Initial connection confirmation   |
| `message_new` | `{id, channelId, content, authorId, authorType, streamingStatus, ...}` | New message in subscribed channel |
| `heartbeat`   | `{timestamp}`                                                          | Keepalive (every 15s)             |

Agent sends responses via REST (POST /api/v1/agents/{id}/messages).

#### GET /api/v1/agents/{id}/channels/{channelId}/messages

Fetch channel message history. Auth: `Authorization: Bearer sk-tvk-...`.

Channel must belong to the agent's server.

**Query params:**

| Param            | Type | Default | Description                                           |
| ---------------- | ---- | ------- | ----------------------------------------------------- |
| `limit`          | int  | 50      | Max messages to return (1–100)                        |
| `before`         | ULID | —       | Cursor: return messages older than this ID            |
| `after_sequence` | int  | —       | Sync cursor: return messages newer than this sequence |

When `after_sequence` is set, messages are returned in ascending sequence order (oldest first).
When `before` is set (or neither cursor), messages are returned in chronological order (oldest first within the page), with `hasMore` indicating older messages exist.

**Response:**

```json
{
  "messages": [
    {
      "id": "01HXY...",
      "channelId": "01HXY...",
      "authorId": "01HXY...",
      "authorType": "USER",
      "authorName": "alice",
      "authorAvatarUrl": null,
      "content": "Hello!",
      "type": "STANDARD",
      "streamingStatus": null,
      "sequence": "1",
      "createdAt": "2026-03-09T12:00:00.000Z",
      "editedAt": null,
      "metadata": null,
      "reactions": []
    }
  ],
  "hasMore": false
}
```

#### GET /api/v1/agents/{id}/server

Server info and channel/agent discovery. Auth: `Authorization: Bearer sk-tvk-...`.

Returns the server the agent belongs to, including all channels (with `websocketTopic` for each) and all active agents.

**Response:**

```json
{
  "server": {
    "id": "01HXY...",
    "name": "Tavok",
    "iconUrl": null
  },
  "channels": [
    {
      "id": "01HXY...",
      "name": "general",
      "topic": null,
      "type": "TEXT",
      "position": 0,
      "websocketTopic": "room:01HXY..."
    }
  ],
  "agents": [
    {
      "id": "01HXY...",
      "name": "MyBot",
      "avatarUrl": null,
      "triggerMode": "MENTION",
      "connectionMethod": "WEBSOCKET"
    }
  ]
}
```

### 7h. OpenAI-Compatible API

#### POST /api/v1/chat/completions

OpenAI Chat Completions format. Auth: `Authorization: Bearer sk-tvk-...`.

The `model` field encodes the target channel: `tavok-channel-{channelId}`.

**Request:**

```json
{
  "model": "tavok-channel-01HXY...",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": false
}
```

**Non-streaming response:** Standard OpenAI `chat.completion` format with `usage` including token counts from agent metadata.

**Streaming:** Set `"stream": true`. Returns SSE chunks in `chat.completion.chunk` format terminated with `data: [DONE]`.

#### GET /api/v1/models

List available channels as "models" in OpenAI format. Auth: `Authorization: Bearer sk-tvk-...`.

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "tavok-channel-01HXY...",
      "object": "model",
      "created": 1708700000,
      "owned_by": "tavok",
      "permission": []
    }
  ]
}
```

### 7i. Internal Dispatch Endpoints

Called by the Gateway (internal network only). Require `X-Internal-Secret`.

#### POST /api/internal/broadcast

Gateway Broadcast Controller. Accepts `{topic, event, payload}`, calls `Broadcast.endpoint_broadcast!/3`.

#### POST /api/internal/agents/{agentId}/dispatch

Dispatches a trigger to a WEBHOOK agent. Called by Gateway when `connectionMethod=WEBHOOK`. Includes trigger message and context messages. Next.js handles HMAC signing and outbound HTTP call.

#### POST /api/internal/agents/{agentId}/enqueue

Queues a message for a REST_POLL agent. Called by Gateway when `connectionMethod=REST_POLL`. Creates an `AgentMessage` row with 24h TTL.

---

## §8 Direct Messages (TASK-0019, DEC-0049)

DMs are private 1:1 conversations outside the server/channel hierarchy.

### 8a. WebSocket Topic

Topic pattern: `dm:{dmChannelId}`

**Join params**: `{ lastSequence?: string }` — for reconnection sync (same pattern as `room:*`).

**Authorization**: Gateway calls `GET /api/internal/dms/verify?dmId={id}&userId={userId}` to verify participant membership. AGENT connections are rejected with `{reason: "agents_cannot_join_dms"}`.

### 8b. Client → Server Events

| Event            | Payload                                  | Description                                |
| ---------------- | ---------------------------------------- | ------------------------------------------ |
| `new_message`    | `{ content: string }`                    | Send a DM. Max 4000 chars.                 |
| `typing`         | `{}`                                     | Typing indicator (2s throttle server-side) |
| `message_edit`   | `{ messageId, content }`                 | Edit own message                           |
| `message_delete` | `{ messageId }`                          | Delete own message                         |
| `sync`           | `{ lastSequence }`                       | Request missed messages                    |
| `history`        | `{ before?: messageId, limit?: number }` | Load older messages (max 100)              |

### 8c. Server → Client Events

| Event             | Payload                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `message_new`     | `{ id, dmId, authorId, authorType:"USER", authorName, content, type:"STANDARD", sequence, createdAt, reactions:[] }` |
| `typing`          | `{ userId, username, displayName }`                                                                                  |
| `message_edited`  | `{ messageId, content, editedAt }`                                                                                   |
| `message_deleted` | `{ messageId, deletedBy }`                                                                                           |
| `reaction_update` | `{ messageId, reactions: [{emoji, count, userIds}] }` — DM reaction added/removed (TASK-0030)                        |
| `sync_messages`   | `{ messages: MessagePayload[] }`                                                                                     |
| `presence_state`  | Phoenix Presence state map                                                                                           |

### 8d. DM Internal APIs (Gateway → Web)

#### GET /api/internal/dms/verify

Verify a user is a DM participant.

Query: `dmId`, `userId`
Response: `{ valid: boolean, dmId, otherUser: { id, username, displayName } }`

#### POST /api/internal/dms/messages

Persist a DM message.

Body: `{ id, dmId, authorId, content, sequence }`
Response: `{ id, dmId, authorId, content, sequence, createdAt }`

#### GET /api/internal/dms/messages

Fetch DM messages with pagination.

Query: `dmId`, `afterSequence?`, `before?`, `limit?`
Response: `{ messages: DirectMessage[], hasMore: boolean }`

#### PATCH /api/internal/dms/messages/{messageId}

Edit a DM message.

Body: `{ content }`
Response: `{ id, content, editedAt }`

#### DELETE /api/internal/dms/messages/{messageId}

Soft-delete a DM message (sets `isDeleted: true`).

Response: `{ id, isDeleted: true }`

### 8e. DM Client APIs (Session-Authenticated)

#### GET /api/dms

List user's DM conversations with last message preview, sorted by recent activity.

Response: `{ dms: [{ id, participant, lastMessage, updatedAt }] }`

#### POST /api/dms

Create or get existing DM channel.

Body: `{ userId }` — the target user.
Validation: Users must share at least one server.
Response: `{ dm: { id, participant, isNew } }`

#### GET /api/dms/{dmId}/messages

DM message history with cursor pagination.

Query: `before?`, `limit?` (default 50, max 100)
Response: `{ messages: DirectMessage[], hasMore: boolean }`

#### GET /api/dms/{dmId}/messages/{messageId}/reactions

Get aggregated reactions for a DM message.

Response: `{ reactions: [{emoji, count, userIds, hasReacted}] }`

#### POST /api/dms/{dmId}/messages/{messageId}/reactions

Add a reaction to a DM message (TASK-0030).

Body: `{ emoji: string }`
Response: `{ reactions: [{emoji, count, userIds}] }`

Broadcasts `reaction_update` to `dm:{dmId}`.

#### DELETE /api/dms/{dmId}/messages/{messageId}/reactions

Remove a reaction from a DM message (TASK-0030).

Body: `{ emoji: string }`
Response: `{ reactions: [{emoji, count, userIds}] }`

Broadcasts `reaction_update` to `dm:{dmId}`.

### 8f. Redis Keys

| Key                  | Type         | Purpose                         |
| -------------------- | ------------ | ------------------------------- |
| `hive:dm:{dmId}:seq` | INCR counter | Message sequence per DM channel |

---

## 9. Channel Charter / Swarm Modes (TASK-0020, DEC-0050)

Multi-agent collaboration modes with human-defined rules, enforced by the Go orchestrator.

### 9a. Swarm Modes

| Mode                 | Description                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| `HUMAN_IN_THE_LOOP`  | Default. Agents respond only when mentioned/triggered. No charter enforcement. |
| `LEAD_AGENT`         | First agent in order leads. Others assist when asked.                          |
| `ROUND_ROBIN`        | Agents take turns in defined order. Go rejects out-of-turn requests.           |
| `STRUCTURED_DEBATE`  | Agents present opposing viewpoints.                                            |
| `CODE_REVIEW_SPRINT` | Sequential code review pattern. Go enforces turn order.                        |
| `FREEFORM`           | Any agent can respond anytime.                                                 |
| `CUSTOM`             | User-defined rules via charter text.                                           |

### 9b. Charter Session Lifecycle

```
INACTIVE → [start] → ACTIVE → [pause] → PAUSED → [resume] → ACTIVE
                        ↓                                       ↓
                      [end]                                   [end]
                        ↓                                       ↓
                    COMPLETED ← ← ← ← ← ← ← ← ← ← ← ← COMPLETED
                        ↑
             (auto: maxTurns reached)
```

### 9c. Channel Charter API (Session-Authenticated)

**PATCH** `/api/servers/{serverId}/channels/{channelId}`

Extended with charter fields:

- `swarmMode` — enum string (see 9a)
- `charterGoal` — text (nullable)
- `charterRules` — text (nullable)
- `charterAgentOrder` — JSON array of agent IDs (nullable)
- `charterMaxTurns` — integer >= 0 (0 = unlimited)

Requires `MANAGE_CHANNELS` permission.

**POST** `/api/servers/{serverId}/channels/{channelId}/charter`

Charter session control:

- Body: `{ action: "start" | "pause" | "resume" | "end" }`
- State machine validation (see 9b)
- Requires `MANAGE_CHANNELS` permission

### 9d. Internal Charter APIs

**GET** `/api/internal/channels/{channelId}` — Extended response:

```json
{
  "channelId": "...",
  "serverId": "...",
  "lastSequence": "42",
  "swarmMode": "ROUND_ROBIN",
  "charterGoal": "Review the auth module",
  "charterRules": "Each agent focuses on one concern",
  "charterAgentOrder": ["bot1", "bot2", "bot3"],
  "charterMaxTurns": 8,
  "charterCurrentTurn": 3,
  "charterStatus": "ACTIVE"
}
```

**POST** `/api/internal/channels/{channelId}/charter-turn` — Turn increment:

- Atomically increments `charterCurrentTurn`
- Auto-completes if `maxTurns > 0 && currentTurn >= maxTurns`
- Response: `{ currentTurn, maxTurns, completed }`

**POST** `/api/internal/channels/{channelId}/charter-control` — Internal charter control:

- Body: `{ action, serverId }`
- Used by Gateway for WebSocket-initiated charter actions

### 9e. WebSocket Events

**Client → Server:**

| Event             | Payload                        | Notes                           |
| ----------------- | ------------------------------ | ------------------------------- |
| `charter_control` | `{ action: "pause" \| "end" }` | User pauses/ends active charter |

**Server → Client:**

| Event            | Payload                                                   | Notes                |
| ---------------- | --------------------------------------------------------- | -------------------- |
| `charter_status` | `{ channelId, currentTurn, maxTurns, status, timestamp }` | Charter state change |

### 9f. Redis Keys

| Key                                      | Type    | Purpose                            |
| ---------------------------------------- | ------- | ---------------------------------- |
| `hive:stream:charter_status:{channelId}` | PUB/SUB | Charter status updates for live UI |

### 9g. Go Proxy Charter Enforcement

After loading agent config, the Go proxy:

1. Fetches charter config via `GET /api/internal/channels/{channelId}`
2. If charter is active and mode != `HUMAN_IN_THE_LOOP`:
   - Checks max turns (rejects if exceeded)
   - Checks turn order for `ROUND_ROBIN`/`CODE_REVIEW_SPRINT`
3. Injects charter context into system prompt
4. After stream completes: `POST /api/internal/channels/{channelId}/charter-turn`
5. Publishes `charter_status` event to Redis

---

## 10. Rate Limiting (DEC-0035, BUG-005)

Two layers of rate limiting enforced by the Elixir Gateway:

### Per-Channel Rate Limit

- **Limit**: 20 messages per second per channel (across all users)
- **Window**: 1-second sliding window (ETS counter, reset every 1s)
- **Enforcement**: `new_message` events exceeding the limit receive `{:error, %{reason: "rate_limited"}}`

### Per-User Rate Limit (BUG-005)

- **Limit**: 5 messages per 10 seconds per user per channel
- **Window**: 10-second sliding window (ETS counter, reset every 10s)
- **Enforcement**: Same `{:error, %{reason: "rate_limited"}}` reply
- **Scope**: Keyed by `{channel_id, user_id}` — different channels and different users have independent counters

### Client Handling

When a message is rate-limited, the Gateway replies with an error instead of broadcasting. The client should display a transient "slow down" notice and suppress further sends briefly.

### Bootstrap API Rate Limit

- `POST /api/v1/bootstrap`: 3 requests per 60 seconds per IP (enforced by Next.js middleware)

---

## Changelog

| Date       | Version | Change                                                                                                                                                                                                                                      |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-23 | v1      | Initial protocol definition                                                                                                                                                                                                                 |
| 2026-02-28 | v1.1    | Fix finalization endpoint (POST → PUT), add GET single message, add content length constraint, document StreamWatchdog endpoint                                                                                                             |
| 2026-02-28 | v1.2    | Add §4b Message Delivery Semantics (broadcast-first pattern, DEC-0028), update Invariant 1 for concurrent persist                                                                                                                           |
| 2026-02-28 | v1.3    | Add stream_thinking event, StreamThinkingPayload, hive:stream:thinking Redis channel (TASK-0011, DEC-0037)                                                                                                                                  |
| 2026-03-01 | v1.4    | Add GET /api/internal/channels/{id}/agents multi-agent endpoint (TASK-0012, DEC-0038)                                                                                                                                                       |
| 2026-03-01 | v1.5    | Add message_edit/message_delete client events, message_edited/message_deleted broadcasts, PATCH/DELETE internal endpoints, editedAt in MessagePayload (TASK-0014)                                                                           |
| 2026-03-01 | v1.6    | Add POST mark-as-read + GET unread state session endpoints, ChannelReadState model, mentionCount increment on message persist (TASK-0015, TASK-0016)                                                                                        |
| 2026-03-01 | v1.7    | Extend StreamThinkingPayload with timestamp, configurable thinkingSteps per agent, thinkingTimeline persistence in messages, timeline in stream_complete payload (TASK-0011)                                                                |
| 2026-03-01 | v1.8    | Add agent self-registration API (POST/GET/PATCH/DELETE /api/v1/agents), dual WebSocket auth (JWT + API key), GET /api/internal/agents/verify, agent channel authorization (DEC-0040)                                                        |
| 2026-03-01 | v1.9    | Add agent-originated streaming events (stream_start/token/complete/error/thinking as client events for AGENT connections), Python SDK (tavok-sdk v0.1.0)                                                                                    |
| 2026-03-01 | v2.0    | Add typed messages (TOOL_CALL, TOOL_RESULT, CODE_BLOCK, ARTIFACT, STATUS), metadata field on Message, typed_message channel event, metadata in stream_complete (TASK-0039, DEC-0042)                                                        |
| 2026-03-01 | v3.0    | Add §7 Agent Connectivity — 6 connection methods (Inbound Webhook, HTTP Webhook, REST Polling, SSE, OpenAI-Compatible), Gateway Broadcast Controller, adapter layer architecture (DEC-0044 through DEC-0046)                                |
| 2026-03-01 | v3.1    | Add MCP-compatible tool interface — stream_tool_call/stream_tool_result events, tool execution loop in Go proxy, enabledTools on Agent, built-in current_time and web_search tools (TASK-0018, DEC-0048)                                    |
| 2026-03-01 | v3.2    | Add §8 Direct Messages — dm:{dmChannelId} topic, DmChannel module, internal DM APIs, client DM APIs, separate Prisma models (DirectMessageChannel, DmParticipant, DirectMessage), frontend DM hooks and components (TASK-0019, DEC-0049)    |
| 2026-03-01 | v3.3    | Add §9 Channel Charter / Swarm Modes — 7 swarm modes, charter session lifecycle, Go-enforced turn order, charter injection into system prompt, charter_status WebSocket events, frontend swarm settings + live header (TASK-0020, DEC-0050) |
| 2026-03-02 | v3.4    | Add stream_checkpoint event, StreamCheckpointPayload, hive:stream:checkpoint Redis channel, tokenHistory + checkpoints on MessagePayload, POST /api/internal/stream/resume endpoint (TASK-0021, DEC-0053)                                   |
| 2026-03-02 | v3.5    | Add reaction_update event for room and DM channels, ReactionUpdatePayload schema, DM reaction CRUD endpoints (GET/POST/DELETE /api/dms/{dmId}/messages/{messageId}/reactions), DmReaction model (TASK-0030)                                 |
| 2026-03-08 | v3.6    | Add Bootstrap API (POST /api/v1/bootstrap) — first-run setup with admin token auth, creates admin user + server + channel with agent registration enabled (DEC-0051)                                                                        |
| 2026-03-09 | v3.7    | Add GET /api/v1/agents/{id}/channels/{channelId}/messages — agent channel history with cursor pagination (before ULID, after_sequence)                                                                                                      |
| 2026-03-09 | v3.8    | Add GET /api/v1/agents/{id}/server — agent server/channel/agent discovery endpoint. Add topicPattern, dmTopicPattern, serverInfoUrl to registration response. CLI init now shows topic pattern and channel discovery URL.                   |
| 2026-03-09 | v4.0    | Remove self-registration (DEC-0060), add CLI agent setup via POST /api/v1/bootstrap/agents, add agent_trigger_skipped event (BUG-007), add §10 Rate Limiting with per-user limits (BUG-005), auto channel assignment via ChannelAgent (DEC-0061) |
| 2026-03-09 | v4.1    | Rename Bot → Agent across all services (DEC-0062): AuthorType.BOT → AGENT, Prisma model Bot → Agent, all API paths /bots/ → /agents/, botId → agentId, fix SDK agent trigger routing (WEBSOCKET skips BYOK), add charter_update delivery to SDK agents on join |

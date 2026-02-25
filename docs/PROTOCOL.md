# PROTOCOL.md — HiveChat Cross-Service Message Contracts

> **Version**: Protocol v1
> **Status**: Active
> **Last updated**: 2026-02-23

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

On WebSocket connect, the client sends a JWT token as a query parameter:

```
ws://localhost:4001/socket/websocket?token=<JWT>
```

The Gateway validates the JWT signature using `JWT_SECRET`. No round-trip to Next.js.
On success: socket assigns `user_id`, `username`, `display_name` from JWT claims.
On failure: socket connection rejected with `{reason: "unauthorized"}`.

### Topics

| Topic Pattern | Description | Lifecycle |
| --- | --- | --- |
| `room:{channelId}` | Per-channel real-time events | Joined on channel view, left on navigate away |
| `user:{userId}` | User-specific events (future) | Joined on app load, persists across navigation |

### Events on `room:{channelId}`

#### Client → Server

| Event | Payload | Description |
| --- | --- | --- |
| `phx_join` | `{lastSequence?: string}` | Join channel, optionally with last seen sequence for sync |
| `new_message` | `{content: string}` | User sends a chat message |
| `typing` | `{}` | User is typing (debounced client-side, 3s cooldown) |
| `sync` | `{lastSequence: string}` | Request missed messages since sequence N |
| `history` | `{before?: string, limit?: int}` | Request older messages (before = ULID cursor, limit default 50, max 100) |

#### Server → Client (Broadcast to all in channel)

| Event | Payload | Description |
| --- | --- | --- |
| `message_new` | [MessagePayload](#messagepayload) | New message (human or bot, non-streaming) |
| `stream_start` | [StreamStartPayload](#streamstartpayload) | AI streaming response begins |
| `stream_token` | [StreamTokenPayload](#streamtokenpayload) | Single token from LLM |
| `stream_complete` | [StreamCompletePayload](#streamcompletepayload) | Streaming finished successfully |
| `stream_error` | [StreamErrorPayload](#streamerrorpayload) | Streaming failed |
| `user_typing` | [TypingPayload](#typingpayload) | Another user is typing |
| `presence_state` | Phoenix.Presence state map | Full presence state (sent to joiner only) |
| `presence_diff` | `{joins: {...}, leaves: {...}}` | Presence changes (broadcast) |

#### Server → Client (Direct reply)

| Event | Payload | Description |
| --- | --- | --- |
| `sync_response` | `{messages: MessagePayload[], hasMore: boolean}` | Missed messages after reconnect |
| `history_response` | `{messages: MessagePayload[], hasMore: boolean}` | Older message history page |

### Payload Schemas

#### MessagePayload

```json
{
  "id": "01HXY...",           // ULID
  "channelId": "01HXY...",   // ULID
  "authorId": "01HXY...",    // ULID (User or Bot)
  "authorType": "USER",      // "USER" | "BOT" | "SYSTEM"
  "authorName": "alice",     // display name for rendering
  "authorAvatarUrl": null,   // string or null
  "content": "Hello world",
  "type": "STANDARD",        // "STANDARD" | "STREAMING" | "SYSTEM"
  "streamingStatus": null,   // null | "ACTIVE" | "COMPLETE" | "ERROR"
  "sequence": "42",          // per-channel sequence number (BigInt-safe decimal string)
  "createdAt": "2026-02-23T12:00:00.000Z"
}
```

#### StreamStartPayload

```json
{
  "messageId": "01HXY...",       // ULID of the placeholder message
  "botId": "01HXY...",
  "botName": "Claude Assistant",
  "botAvatarUrl": null,
  "sequence": "43"
}
```

#### StreamTokenPayload

```json
{
  "messageId": "01HXY...",
  "token": "Hello",             // the text chunk
  "index": 0                    // monotonically increasing, 0-based
}
```

#### StreamCompletePayload

```json
{
  "messageId": "01HXY...",
  "finalContent": "Hello! How can I help you today?"
}
```

#### StreamErrorPayload

```json
{
  "messageId": "01HXY...",
  "error": "Provider returned 429: rate limited",
  "partialContent": "Hello! How can I"   // may be null
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

---

## 2. Redis Pub/Sub Events

All Redis messages are JSON-encoded strings.

### Channel Patterns

| Redis Channel | Publisher | Subscriber | Description |
| --- | --- | --- | --- |
| `hive:channel:{channelId}:messages` | Gateway | (future: indexer, analytics) | New persisted message notification |
| `hive:stream:request` | Gateway | Go Proxy | Request AI response for a message |
| `hive:stream:tokens:{channelId}:{messageId}` | Go Proxy | Gateway | Individual tokens from LLM |
| `hive:stream:status:{channelId}:{messageId}` | Go Proxy | Gateway | Stream completion or error |

### Stream Request Payload

Published by Gateway when a message triggers an AI response:

```json
{
  "channelId": "01HXY...",
  "messageId": "01HXY...",
  "botId": "01HXY...",
  "triggerMessageId": "01HXY...",
  "contextMessages": [
    {"role": "user", "content": "What is Elixir?"},
    {"role": "assistant", "content": "Elixir is a functional programming language..."},
    {"role": "user", "content": "How does it compare to Go?"}
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

### Sequence Number Assignment

Per-channel sequence numbers are assigned via Redis atomic increment:

```
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

Base URL: `http://web:3000` (Docker internal network)

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

#### GET /api/internal/channels/{channelId}/bot

Get the default bot configuration for a channel.

**Response:** `200 OK` with bot config, or `404` if no default bot.

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

### Go Proxy → Next.js (Web)

#### GET /api/internal/bots/{botId}

Full bot configuration including decrypted API key.

**Response:** Same as channel bot endpoint above.

#### POST /api/internal/messages

Persist a completed or errored streaming message.

**Request body:**

```json
{
  "id": "01HXY...",
  "channelId": "01HXY...",
  "authorId": "01HXY...",
  "authorType": "BOT",
  "content": "Hello! How can I help you today?",
  "type": "STREAMING",
  "streamingStatus": "COMPLETE",
  "sequence": "43"
}
```

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

1. **Placeholder first**: A message row with `type=STREAMING, streamingStatus=ACTIVE` MUST exist in the database BEFORE the first `stream_token` is broadcast.

2. **Token ordering**: Tokens carry a monotonically increasing `index` starting at 0. The client MUST render tokens in order. If a token arrives out of order, buffer and apply in sequence.

3. **Single writer**: Only one stream can be active per `messageId`. The Go Proxy owns the stream lifecycle for a given message.

4. **Completion persistence**: On `stream_complete`, the Go Proxy calls `POST /api/internal/messages` to update the message with `streamingStatus=COMPLETE` and `content=finalContent`.

5. **Error persistence**: On `stream_error`, the Go Proxy calls `POST /api/internal/messages` to update the message with `streamingStatus=ERROR` and `content=partialContent` (may be empty string).

6. **Client cleanup**: When a user switches channels, the client MUST stop rendering any active streams from the previous channel. On rejoin, stream state is reconstructed from the persisted message.

7. **Timeout**: If no token arrives for 30 seconds during an active stream, the Gateway publishes a `stream_error` and transitions to ERROR state.

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

### JWT Structure

```json
{
  "sub": "01HXY...",          // user ID (ULID)
  "username": "alice",
  "displayName": "Alice",
  "email": "alice@example.com",
  "iat": 1708700000,
  "exp": 1708786400           // 24h expiry
}
```

### Flow

1. User logs in via Next.js (`/api/auth/signin`)
2. NextAuth creates a session and issues a JWT signed with `JWT_SECRET`
3. Client stores JWT (httpOnly cookie for web, also available via NextAuth session)
4. Client extracts JWT and passes it as query param on WebSocket connect
5. Gateway validates JWT signature using `JWT_SECRET` (shared secret, no round-trip)
6. Gateway extracts `sub`, `username`, `displayName` and assigns to socket

### Token Refresh

- JWT has 24h expiry
- Client refreshes via NextAuth session refresh (automatic)
- On WebSocket disconnect due to expired token, client fetches new token and reconnects

### Internal API Auth

Internal service-to-service calls use a shared `INTERNAL_API_SECRET` header.
This is NOT JWT — it's a simple shared secret for the internal Docker network only.
In production, these endpoints are not exposed to the public internet.

---

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-02-23 | v1 | Initial protocol definition |

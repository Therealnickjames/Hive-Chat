# STREAMING.md — Token Streaming Lifecycle Rules

> This is the detailed reference for Tavok's streaming system.
> For the wire-level contracts, see `docs/PROTOCOL.md` §4.
> For the product vision, see `docs/internal/Tavok.md` (local only).

---

## Overview

Token streaming is Tavok's differentiator. When an AI agent responds in a channel, tokens flow smoothly word-by-word — not hacked together with message edits.

The streaming system involves all three services:
1. **Gateway** (Elixir): Detects trigger, creates placeholder message, broadcasts stream events
2. **Streaming Proxy** (Go): Calls LLM API, parses SSE, pushes tokens via Redis
3. **Web** (Next.js): Persists messages, serves bot config

---

## State Machine

See `docs/PROTOCOL.md` §4 for the complete state machine diagram and invariants.

Summary:
- `IDLE` → `ACTIVE` → `COMPLETE` or `ERROR`
- Placeholder message created BEFORE first token
- Tokens carry monotonic `index` for ordering
- Final content persisted on completion
- Partial content preserved on error

---

## Trigger Flow

1. User sends message in channel with a bot assigned
2. Gateway checks bot's `triggerMode`:
   - `ALWAYS`: every message triggers the bot
   - `MENTION`: only messages containing `@botname`
   - `KEYWORD`: messages containing configured keywords
3. Gateway creates a placeholder message: `type=STREAMING, streamingStatus=ACTIVE`
4. Gateway broadcasts `stream_start` to all clients in the channel
5. Gateway publishes stream request to Redis `hive:stream:request`
6. Go Proxy picks up the request and begins LLM API call

---

## Provider System

### Provider Interface

All LLM providers implement a common interface (`streaming/internal/provider/provider.go`):

```go
type Provider interface {
    Name() string
    Stream(ctx context.Context, req StreamRequest, tokens chan<- Token) (*StreamResult, error)
}
```

The `Stream` method opens a connection to the LLM API, parses the response format, and sends normalized `Token` values through the channel. The caller (stream manager) handles batching, Redis publishing, and lifecycle management.

### Provider Registry

`streaming/internal/provider/registry.go` maps provider names to implementations:

| Provider Name | Implementation | API Format | Auth |
|---------------|---------------|------------|------|
| `anthropic` | Anthropic | `/v1/messages`, `content_block_delta` events | `x-api-key` header |
| `openai` | OpenAI | `/v1/chat/completions`, `choices[0].delta.content` | `Bearer` token |
| `ollama` | OpenAI (reused) | OpenAI-compatible format | None (local) |
| `openrouter` | OpenAI (reused) | OpenAI-compatible format | `Bearer` token |
| `custom` | OpenAI (reused) | OpenAI-compatible (assumed) | `Bearer` token (optional) |

Unknown provider names fall back to OpenAI-compatible with a warning log.

### Transport Layer (TASK-0013)

The transport layer decouples HTTP connection mechanics from response format parsing.

**Transport interface** (`streaming/internal/provider/transport.go`):

```go
type Transport interface {
    OpenStream(ctx context.Context, req *http.Request) (io.ReadCloser, error)
}
```

**HTTPSSETransport** is the default implementation used by all providers. It opens an HTTP POST connection and returns the SSE response body for parsing.

Each provider is composed of:
- **Transport**: How to connect (HTTP SSE today, WebSocket/gRPC in future)
- **Format adapter**: How to parse the response (OpenAI vs Anthropic event formats)

Providers accept custom transports via `NewOpenAIWithTransport(t)` and `NewAnthropicWithTransport(t)` for testing and extensibility.

### Custom Headers

`StreamRequest.Headers` supports provider-specific headers. Example for OpenRouter:

```go
StreamRequest{
    Headers: map[string]string{
        "HTTP-Referer": "https://tavok.ai",
        "X-Title":      "Tavok",
    },
}
```

Headers are applied after standard provider headers, so they can override defaults if needed.

### Shared Infrastructure

**HTTP Client** (`streaming/internal/provider/http.go`): All providers use `NewStreamingHTTPClient()` with tuned transport settings (DEC-0034): MaxConnsPerHost=200, MaxIdleConnsPerHost=20, IdleConnTimeout=120s, Timeout=5min.

**SSE Parser** (`streaming/internal/sse/parser.go`): Generic Server-Sent Events parser per WHATWG spec. Handles `event:` and `data:` fields, multi-line data, 1MB max buffer.

### Adding a New Provider

**OpenAI-compatible endpoint** (Ollama, vLLM, LiteLLM):
1. Add entry to `NewRegistry()` in `registry.go`
2. Add default endpoint/model to `PROVIDER_DEFAULTS` in `manage-bots-modal.tsx`

**New API format** (e.g., Google Gemini):
1. Create `streaming/internal/provider/gemini.go` implementing `Provider`
2. Use `NewHTTPSSETransport()` for the transport (or implement a custom `Transport`)
3. Implement format-specific request building, auth headers, and SSE event parsing
4. Register in `NewRegistry()`

**New transport** (e.g., WebSocket for OpenAI Realtime):
1. Implement the `Transport` interface
2. Use `NewOpenAIWithTransport(myTransport)` to inject it

All providers produce the same output: `{messageId, token, index}`

---

## Error Handling

| Error Type | Handling |
|---|---|
| Provider returns 4xx/5xx | Set `stream_error`, include provider error message |
| Provider connection timeout | Set `stream_error` after 30s with no tokens |
| Provider returns empty stream | Set `stream_error` with "empty response" |
| Token timeout (30s gap) | Gateway sets `stream_error` |
| Redis connection lost | Gateway sets `stream_error`, logs for investigation |
| Client disconnects mid-stream | Stream continues server-side, final message persisted normally |

---

## Performance Targets

| Metric | Target | Description |
|---|---|---|
| TTFT (Time to First Token) | < 200ms overhead | Measured from LLM first token to client render (excludes LLM latency) |
| Token-to-screen latency | < 50ms | From Go Proxy receiving token to client rendering it |
| Max concurrent streams | 1000+ | Per Go Proxy instance |
| Memory per stream | < 1MB | Goroutine + buffer |

---

## Testing Checklist

When modifying streaming code, verify:
- [ ] Happy path: message → stream_start → tokens → stream_complete
- [ ] Error path: message → stream_start → tokens → stream_error (partial content preserved)
- [ ] Timeout: message → stream_start → 30s silence → stream_error
- [ ] Channel switch mid-stream: client clears old stream, new channel loads correctly
- [ ] Reconnect mid-stream: client sees final state (COMPLETE or ERROR), not a stuck ACTIVE
- [ ] Concurrent streams: multiple channels streaming simultaneously, no cross-talk
- [ ] Token ordering: tokens render in order even if they arrive out of order

---

## V1 Enhancements (Planned)

### Multi-Stream Support

V1 enables multiple agents streaming simultaneously in the same channel. Each stream is independent:
- Multiple `stream_start` events can be active concurrently per channel
- Each stream has its own `messageId`, token buffer, and index sequence
- `requestAnimationFrame` batching handles multiple concurrent token flows (tokens accumulated per-messageId in a `Map<messageId, string>` ref)
- Completion or error of one stream does not affect others
- Client must track multiple active stream states per channel

### Agent Thinking Timeline

Agents emit thinking state changes during execution. New protocol events (to be defined in PROTOCOL.md):

```json
{
  "messageId": "01HXY...",
  "state": "planning",        // e.g., "planning", "searching", "coding", "reviewing"
  "label": "Planning approach" // human-readable description
}
```

Thinking states flow through the same pipeline as tokens: Go → Redis → Gateway → WebSocket → Client. States are persisted with the message for replay.

### Provider Transport Strategies (DEC-0024, DEC-0036, TASK-0013)

V1 implements the `Transport` interface, decoupling HTTP mechanics from format parsing. Both OpenAI and Anthropic providers now accept pluggable transports. Custom headers support enables OpenRouter integration.

Current transport: **HTTPSSETransport** for all providers (OpenAI, Anthropic, Ollama, OpenRouter, custom).

Future transports (extension points ready):
- **WebSocket**: OpenAI Realtime/Responses API
- **gRPC**: Local model inference

### Tool Execution Mid-Stream

V1 agents can invoke tools during generation (MCP-compatible interface, DEC-0022):

```
Agent generates → Tool call detected → Go pauses stream → Executes tool → 
Feeds result back → Agent continues generating → Tokens resume
```

Tool results are included in the thinking timeline. The client shows tool execution as a visible step.

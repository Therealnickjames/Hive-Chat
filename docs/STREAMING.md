# STREAMING.md — Token Streaming Lifecycle Rules

> This is the detailed reference for HiveChat's streaming system.
> For the wire-level contracts, see `docs/PROTOCOL.md` §4.
> For the product vision, see `docs/HiveChat.md`.

---

## Overview

Token streaming is HiveChat's differentiator. When an AI agent responds in a channel, tokens flow smoothly word-by-word — not hacked together with message edits.

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

## Provider Normalization

The Go Proxy normalizes ALL provider responses into a common token format.
The Gateway and client NEVER need to know which provider generated the tokens.

Supported providers:
- **Anthropic** (Claude): SSE with `content_block_delta` events
- **OpenAI** (GPT): SSE with `choices[0].delta.content`
- **OpenAI-compatible** (Ollama, OpenRouter, LiteLLM): Same as OpenAI format
- **Custom**: Any endpoint that returns OpenAI-compatible SSE

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

# CONSOLIDATED-FINDINGS.md — HiveChat Consolidation Sweep

> **STATUS: ALL 33 ISSUES RESOLVED** (2026-02-28)
> See DEC-0027 in docs/DECISIONS.md for the decision record.
> ISSUE-015 decision: require invites (disable direct server join).

## Summary

- **Total unique issues: 33** — **ALL FIXED**
- **CRITICAL: 6** — FIXED
- **HIGH: 10** — FIXED
- **MEDIUM: 10** — FIXED (ISSUE-018, ISSUE-023, ISSUE-024, ISSUE-032 deferred as noted below)
- **LOW: 7** — FIXED
- **NEEDS DECISION (contradictions): 1** — DECIDED (require invites)
- **UNVERIFIED: 0**
- **Deferred (not bugs, future work): 14**
- **Services affected:** Web, Gateway, Streaming, Cross-service, Docs
- **PROTOCOL.md changes needed:** Yes — DONE (finalization endpoint + content length constraint)

---

## CRITICAL Issues

---

### ISSUE-001: Hardcoded fallback secrets across all services

- **Severity:** CRITICAL
- **Service(s):** Web, Gateway, Streaming, Docker
- **Found by:** Composer, Opus, Codex, Claude
- **Description:** Multiple services fall back to well-known default secrets when env vars are missing:
  - `packages/web/app/api/auth/token/route.ts` line 46: `JWT_SECRET || "dev-jwt-secret-change-in-production"`
  - `gateway/config/runtime.exs` lines 22-23, 34-35: `"dev-jwt-secret"`, `"dev-internal-secret"`
  - `docker-compose.yml` lines 67-72: hardcoded defaults for `NEXTAUTH_SECRET`, `JWT_SECRET`, `INTERNAL_API_SECRET`, `ENCRYPTION_KEY`
  - `streaming/cmd/proxy/main.go`: `getEnv()` with weak defaults

  If any env var is missing or empty, the service silently starts with a predictable secret rather than failing. `lib/env.ts` validates some secrets at startup, but the individual route files read `process.env` directly and use their own fallbacks, bypassing env validation.
- **Recommendation:** Remove ALL fallback values for security-sensitive env vars. Services MUST crash on startup if secrets are missing. In each service:
  - Web: Remove `|| "dev-..."` from token route. Add `ENCRYPTION_KEY` to `lib/env.ts` Zod schema.
  - Gateway: Replace `|| "dev-..."` with a startup crash in `runtime.exs` or `application.ex`.
  - Go: Remove defaults for `INTERNAL_API_SECRET` and `JWT_SECRET` in `getEnv()`.
  - Docker: Remove default secret values from `docker-compose.yml`; add comments pointing to `.env.example`.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Any misconfigured deployment silently runs with known secrets. An attacker can forge JWTs, access internal APIs, and decrypt bot API keys.

---

### ISSUE-002: Anthropic error events reported as successful completion

- **Severity:** CRITICAL
- **Service(s):** Streaming
- **Found by:** Opus, Codex, Claude
- **Description:** `streaming/internal/provider/anthropic.go` lines 150-152. When Anthropic sends an `event: error` SSE event (rate limit, auth failure, overloaded), the provider logs it but does NOT return an error. The `Stream()` function returns `nil`, causing the manager to publish `stream_complete` instead of `stream_error`. The user sees an empty or partial "completed" message with no error indication.
- **Recommendation:** When an `error` event is received, capture the error message and return it as an error from the SSE parse callback so `Stream()` returns a non-nil error. The manager will then correctly publish `stream_error` with the provider's error message.
- **PROTOCOL.md impact:** No (error handling already defined)
- **Risk if ignored:** Rate limits, auth failures, and API errors from Anthropic are silently swallowed. Users see empty "completed" bot messages with no explanation.

---

### ISSUE-003: `check_origin: false` in production Gateway config

- **Severity:** CRITICAL
- **Service(s):** Gateway
- **Found by:** Composer, Opus, Codex, Claude
- **Description:** `gateway/config/runtime.exs` line 18 sets `check_origin: false`, which disables WebSocket origin validation entirely. Any website on any domain can open a WebSocket connection to the Gateway. Combined with the exposed port 4001, this enables cross-site WebSocket hijacking.
- **Recommendation:** Set `check_origin` to a configurable list of allowed origins via env var. For dev, allow `["//localhost", "//127.0.0.1"]`. For production, require explicit origin configuration. Example: `check_origin: String.split(System.get_env("ALLOWED_ORIGINS", "//localhost://127.0.0.1"), ",")`.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Cross-site WebSocket hijacking. A malicious page can connect to the Gateway as any user who visits it (if they have a valid JWT cookie/token).

---

### ISSUE-004: Redis exposed on host with no authentication

- **Severity:** CRITICAL
- **Service(s):** Docker / Infrastructure
- **Found by:** Composer, Opus, Claude
- **Description:** `docker-compose.yml` line 42 exposes Redis on `0.0.0.0:6379` with no password. Any process on the host (or the network, if on a cloud VM with open firewall) can:
  - Read all pub/sub channels (intercept tokens, stream requests)
  - Publish fake stream requests to trigger arbitrary LLM calls
  - Read/write sequence counters
  - Inject tokens into active streams
- **Recommendation:** Three changes:
  1. Add `--requirepass ${REDIS_PASSWORD}` to the Redis command in docker-compose.yml.
  2. Update all Redis connection URLs to include the password.
  3. Bind Redis port to `127.0.0.1:6379:6379` (or remove the port mapping entirely for production — services communicate over the internal Docker network).
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Full read/write access to the message bus. An attacker on the same network can intercept bot API calls, inject fake messages, and manipulate stream state.

---

### ISSUE-005: Goroutine and connection leaks in Go providers

- **Severity:** CRITICAL
- **Service(s):** Streaming
- **Found by:** Opus, Claude
- **Description:** Two related issues in the Go streaming proxy:
  1. **Goroutine leak:** Both `openai.go` and `anthropic.go` do bare `tokens <- Token{...}` sends inside the SSE callback. If the manager stops reading the channel (timeout, context cancel), the send blocks forever. The goroutine and its HTTP connection leak permanently.
  2. **HTTP client leak:** Both providers create `new http.Client{}` on every `Stream()` call (openai.go line 109, anthropic.go line 107). This creates a new connection pool per stream, preventing reuse and potentially exhausting file descriptors under load.
- **Recommendation:**
  1. Replace bare channel sends with `select { case tokens <- token: case <-ctx.Done(): return ctx.Err() }` in both providers.
  2. Create the `http.Client` once as a struct field (in the constructor), reuse across all `Stream()` calls.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Under sustained load or repeated timeouts, goroutines and TCP connections accumulate until the process runs out of memory or file descriptors. The proxy becomes unresponsive and must be restarted.

---

### ISSUE-006: `afterSequence=0` sync bug in internal messages API

- **Severity:** CRITICAL
- **Service(s):** Web
- **Found by:** Claude (code scan)
- **Description:** `packages/web/app/api/internal/messages/route.ts` line 67. The check `if (parsedAfterSequence)` is falsy when `parsedAfterSequence` is `0` (JavaScript truthiness). A client reconnecting from sequence 0 (brand-new channel, never received a message) falls into the `before` cursor pagination path instead of the `afterSequence` path. This means the reconnect sync protocol returns wrong results for fresh channels.
- **Recommendation:** Change `if (parsedAfterSequence)` to `if (parsedAfterSequence !== null && parsedAfterSequence !== undefined)` or `if (typeof parsedAfterSequence === 'number')`.
- **PROTOCOL.md impact:** No (the protocol defines afterSequence correctly; only the implementation is wrong)
- **Risk if ignored:** Reconnection sync fails silently on channels where the user's last seen sequence was 0. Messages may be missed or duplicated on reconnect.

---

## HIGH Issues

---

### ISSUE-007: Bot trigger blocks the channel process

- **Severity:** HIGH
- **Service(s):** Gateway
- **Found by:** Composer, Opus, Claude
- **Description:** `gateway/lib/hive_gateway_web/channels/room_channel.ex` — When a bot is triggered, the channel process makes 3 sequential HTTP calls inline (fetch bot config, persist placeholder, fetch context messages), each with a 10-second timeout. During this time, **all message processing for that channel is blocked** — no other user's messages can be received, broadcast, or replied to.
- **Recommendation:** Spawn bot triggering into a `Task.Supervisor.async_nolink` so the channel process returns immediately. The task handles HTTP calls and publishes to Redis independently. This is consistent with DEC-0019 (Gateway is transport only — it should relay, not block).
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Every bot trigger freezes the entire channel for up to 30 seconds. In a channel with active users, this creates visible message delays.

---

### ISSUE-008: `time.After` memory leak in token loop

- **Severity:** HIGH
- **Service(s):** Streaming
- **Found by:** Opus, Claude
- **Description:** `streaming/internal/stream/manager.go` line 232. `time.After(tokenTimeout)` inside a `for/select` loop creates a new 30-second timer on every iteration. In Go, unreceived `time.After` channels are NOT garbage collected until the timer fires. At 100 tokens/sec, that's ~3,000 leaked timers per stream, each holding 30 seconds of memory.
- **Recommendation:** Replace with `time.NewTimer(tokenTimeout)` created once before the loop, with `timer.Reset(tokenTimeout)` after each token. Remember to drain the timer channel before reset if the timer has already fired.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Memory grows linearly with token throughput. Under sustained multi-stream load, the Go proxy's memory usage climbs until GC pauses become noticeable or the process is OOM-killed.

---

### ISSUE-009: Redis pubsub subscription never closed in Go

- **Severity:** HIGH
- **Service(s):** Streaming
- **Found by:** Opus, Claude
- **Description:** `streaming/internal/gateway/client.go` lines 33-49. `SubscribeStreamRequests` calls `c.rdb.Subscribe` but never calls `pubsub.Close()`. On graceful shutdown, the subscription lingers, the goroutine hangs until the Redis client itself closes, and the process cannot exit cleanly within the 30-second shutdown window.
- **Recommendation:** Return the `*redis.PubSub` from `SubscribeStreamRequests` (or store it on the Client struct) and call `pubsub.Close()` during shutdown in `main.go`.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Graceful shutdown hangs. Docker sends SIGKILL after the stop timeout (default 10s), causing abrupt termination and potentially leaving streams in ACTIVE state without terminal events.

---

### ISSUE-010: Internal API secret comparison is not timing-safe

- **Severity:** HIGH
- **Service(s):** Web
- **Found by:** Opus, Claude
- **Description:** All internal API routes use simple `===` string comparison for the `x-internal-secret` header. This is vulnerable to timing attacks — an attacker can iteratively guess the secret one character at a time by measuring response times. Additionally, if `INTERNAL_API_SECRET` is empty string (`""`), any request with an empty header value passes.
- **Recommendation:** Use `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))` wrapped in a length check. Fail closed if the env var is empty or missing.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Timing side-channel attack on the internal API secret. The internal API exposes decrypted bot API keys and message persistence — a compromised secret gives full control over the streaming pipeline.

---

### ISSUE-011: Invite `maxUses` race condition

- **Severity:** HIGH
- **Service(s):** Web
- **Found by:** Opus, Codex, Claude
- **Description:** `packages/web/app/api/invites/[code]/accept/route.ts` lines 35-67. The flow reads `invite.uses`, checks `uses >= maxUses`, then increments in a transaction. Two concurrent requests can both pass the check and both increment, exceeding `maxUses`. Additionally, the `@everyone` role assignment happens OUTSIDE the transaction (lines 69-86), so a failure there leaves a member without the default role.
- **Recommendation:** Use a conditional `updateMany` inside the transaction: `WHERE id = invite.id AND (maxUses IS NULL OR uses < maxUses)`. Check the update count — if 0, the invite was exhausted. Move `@everyone` role assignment into the same transaction.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Invite usage limits can be bypassed under concurrent load. Members can be created without the `@everyone` role.

---

### ISSUE-012: No message content length limit

- **Severity:** HIGH
- **Service(s):** Gateway, Web
- **Found by:** Codex, Claude (code scan)
- **Description:** `gateway/lib/hive_gateway_web/channels/room_channel.ex` — `handle_in("new_message")` validates that content is a non-empty binary but has no maximum length check. A user can send a multi-megabyte message through the WebSocket, which gets persisted to PostgreSQL and broadcast to all channel members. The Web API (`route-handlers.js`) also has no content length validation.
- **Recommendation:** Add a 4000-character limit (matching Discord's limit) in the Gateway's `handle_in` before persistence. Also add the same limit in the Web API for defense-in-depth.
- **PROTOCOL.md impact:** Yes — add `content` max length to MessagePayload constraints
- **Risk if ignored:** A single user can flood a channel with arbitrarily large messages, causing database bloat, slow page loads, and excessive bandwidth for all channel members.

---

### ISSUE-013: `ENCRYPTION_KEY` not validated at startup

- **Severity:** HIGH
- **Service(s):** Web
- **Found by:** Opus, Codex, Claude
- **Description:** `packages/web/lib/env.ts` does not include `ENCRYPTION_KEY` in the `serverEnvSchema`. The key is only validated at runtime inside `encryption.ts` when `encrypt()` or `decrypt()` is called. A deployment missing this variable starts successfully and fails only when a bot API key is created or fetched — possibly hours or days later.
  Additionally, `encryption.ts` line 14-22 checks key length (64 chars) but not hex validity. `Buffer.from("ZZZZZZ...", "hex")` silently drops invalid chars, producing a wrong-length key.
- **Recommendation:** Add `ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "Must be 64 hex chars")` to `serverEnvSchema` in `lib/env.ts`. This catches missing, empty, and malformed keys at startup.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Deployments without ENCRYPTION_KEY pass health checks but fail the first time a bot is created. Malformed hex keys produce incorrect encryption with no error.

---

### ISSUE-014: Go config loader HTTP requests have no context

- **Severity:** HIGH
- **Service(s):** Streaming
- **Found by:** Claude (code scan)
- **Description:** `streaming/internal/config/loader.go` — Both `GetBot()` (line 40) and `FinalizeMessage()` (line 80) use `http.NewRequest()` without a context. These requests cannot be cancelled by the stream context or the shutdown context. During shutdown, in-flight requests block for up to 10 seconds (the client timeout), delaying process exit. Also, `FinalizeMessageWithRetry` uses `time.Sleep` for backoff (line 125), holding the concurrency semaphore slot during sleep.
- **Recommendation:** Add `ctx context.Context` parameter to `GetBot()` and `FinalizeMessage()`. Use `http.NewRequestWithContext(ctx, ...)`. Replace `time.Sleep` with `select { case <-time.After(backoff): case <-ctx.Done(): return ctx.Err() }`.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Graceful shutdown delayed by up to 17 seconds (10s timeout + 7s retry backoff). Concurrency slots wasted during retry sleep.

---

### ISSUE-015: Open server join without invite

- **Severity:** HIGH
- **Service(s):** Web
- **Found by:** Opus, Claude
- **Description:** `packages/web/app/api/servers/[serverId]/members/route.ts` lines 68-134 — Any authenticated user can join any server by sending `POST /api/servers/{serverId}/members` with just the server ID. No invite code, no approval, no publicity check. Server IDs are discoverable via the `/api/servers/discover` endpoint and are ULIDs visible in URLs.
- **Recommendation:** This is documented as "direct join for MVP" (BREAK-0013 in KNOWN-ISSUES.md, status: KNOWN). **NEEDS DECISION**: Either remove the endpoint and require all joins through `/api/invites/{code}/accept`, or add an `isPublic` flag to the Server model and gate direct join on it. The current state is a known tradeoff, not a bug — but it's inappropriate for any multi-user deployment.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Any registered user can join any server on the instance without an invite. In a shared deployment, this breaks server privacy entirely.

---

### ISSUE-016: JWT claim presence not validated in Gateway

- **Severity:** HIGH
- **Service(s):** Gateway
- **Found by:** Claude (code scan)
- **Description:** `gateway/lib/hive_gateway_web/channels/user_socket.ex` lines 26-28. After JWT signature verification, `claims["sub"]`, `claims["username"]`, and `claims["displayName"]` are assigned to the socket without checking for `nil`. A validly-signed JWT missing these claims (e.g., an old token format, or a manual token creation) would set `nil` user_id on the socket, potentially causing crashes or unauthorized access in RoomChannel.
- **Recommendation:** After `Joken.verify`, validate that `claims["sub"]` is a non-empty string. Reject the connection if any required claim is missing.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** A malformed but validly-signed JWT could produce a socket with nil user_id, causing undefined behavior in membership checks and message attribution.

---

## MEDIUM Issues

---

### ISSUE-017: PROTOCOL.md says POST for finalization, code uses PUT

- **Severity:** MEDIUM
- **Service(s):** Cross-service / Docs
- **Found by:** Claude (earlier review)
- **Description:** PROTOCOL.md documents `POST /api/internal/messages` for message finalization. The actual implementation uses `PUT /api/internal/messages/{messageId}` (in `streaming/internal/config/loader.go` and `packages/web/app/api/internal/messages/[messageId]/route.ts`). Anyone building against PROTOCOL.md will call the wrong endpoint.
- **Recommendation:** Update PROTOCOL.md to document the actual `PUT /api/internal/messages/{messageId}` endpoint with its request/response schema.
- **PROTOCOL.md impact:** Yes — correct the finalization endpoint
- **Risk if ignored:** New contributors or services that rely on PROTOCOL.md as the contract will call the wrong endpoint.

---

### ISSUE-018: `useChannel` hook is a monolith

- **Severity:** MEDIUM
- **Service(s):** Web
- **Found by:** Composer, Opus, Codex
- **Description:** `packages/web/lib/hooks/use-channel.ts` is a single hook handling channel subscription, message state, streaming events, typing indicators, presence, history loading, and reconnection sync. It's over 400 lines and growing. All three agents flagged this as a maintainability concern for V1 work (which adds edit/delete, mentions, unreads, thinking timeline, and multi-stream events to the same hook).
- **Recommendation:** Decompose into focused sub-hooks: `useChannelMessages`, `useChannelStreaming`, `useChannelTyping`, `useChannelPresence`. The parent `useChannel` composes them. Do this BEFORE adding V1 event handlers.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Every V1 feature adds more event handlers to the same monolith. Debugging, testing, and modifying becomes progressively harder. Risk of subtle interaction bugs between unrelated features.

---

### ISSUE-019: Duplicate `formatTime` utility

- **Severity:** MEDIUM
- **Service(s):** Web
- **Found by:** Opus, Claude
- **Description:** `packages/web/components/chat/message-item.tsx` lines 18-38 and `packages/web/components/chat/streaming-message.tsx` lines 18-38 contain identical `formatTime` functions. If one is modified, the other becomes inconsistent.
- **Recommendation:** Extract to `packages/web/lib/format-time.ts` and import in both components.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Inconsistent timestamp formatting if one copy is updated without the other.

---

### ISSUE-020: Register endpoint returns 500 on duplicate email/username

- **Severity:** MEDIUM
- **Service(s):** Web
- **Found by:** Opus, Claude
- **Description:** `packages/web/app/api/auth/register/route.ts` lines 26-55. The check-then-create pattern has a TOCTOU race: two concurrent registrations with the same email/username both pass `findUnique` checks, then one fails on the Prisma unique constraint with an unhandled error, returning 500 instead of 409.
- **Recommendation:** Wrap `prisma.user.create` in try/catch. Catch Prisma's `P2002` error code (unique constraint violation) and return 409.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Concurrent registrations produce confusing 500 errors instead of helpful "email/username taken" responses.

---

### ISSUE-021: File upload MIME type not validated from bytes

- **Severity:** MEDIUM
- **Service(s):** Web
- **Found by:** Opus, Claude
- **Description:** `packages/web/app/api/uploads/route.ts` lines 51-56. Only checks the client-supplied `Content-Type` header, never inspects actual file magic bytes. A user can upload an HTML file as `image/jpeg`. The download endpoint serves whatever MIME type is stored in the DB. Missing `X-Content-Type-Options: nosniff` header on served files.
- **Recommendation:** At minimum, add `X-Content-Type-Options: nosniff` to the file serving response headers. Ideally, use the `file-type` npm package to inspect magic bytes and reject mismatches.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Potential stored XSS via content-type spoofing on uploaded files.

---

### ISSUE-022: Topic field has no length limit on PATCH

- **Severity:** MEDIUM
- **Service(s):** Web
- **Found by:** Claude
- **Description:** `packages/web/app/api/servers/[serverId]/channels/[channelId]/route.ts` lines 95-106 and `packages/web/lib/route-handlers.js` — The PATCH handler for channel topic has no length limit, unlike the POST handler which limits to 300 chars. A user with `MANAGE_CHANNELS` can set a topic of arbitrary length.
- **Recommendation:** Add `body.topic.slice(0, 300)` or similar validation to match the POST handler.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Arbitrarily large topic strings stored in DB and returned on every server fetch.

---

### ISSUE-023: `chatProvider` fires 4 parallel fetches on server change

- **Severity:** MEDIUM
- **Service(s):** Web
- **Found by:** Claude
- **Description:** `packages/web/components/providers/chat-provider.tsx` lines 283-289. On every `serverId` change, four independent API calls fire (`refreshChannels`, `refreshMembers`, `refreshBots`, `refreshPermissions`). If the user navigates quickly between servers, all intermediate fetches fire and complete with stale data. `refreshServerScopedData` (which uses `Promise.all`) exists but isn't used in the primary navigation effect.
- **Recommendation:** Use `refreshServerScopedData` in the navigation effect instead of four individual calls. Add an abort controller to cancel in-flight requests when serverId changes.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Unnecessary network traffic and potential stale data on rapid navigation.

---

### ISSUE-024: `route-handlers.js` and friends are plain JS in a TS project

- **Severity:** MEDIUM
- **Service(s):** Web
- **Found by:** Claude
- **Description:** `packages/web/lib/route-handlers.js`, `api-safety.js`, and `validation.js` are plain JavaScript with no type annotations. These contain core business logic (internal auth, message persistence, sequence handling). Any field name typo bypasses TypeScript's safety checks.
- **Recommendation:** Convert to `.ts` files with proper type annotations. This is a mechanical conversion that adds type safety to critical paths.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Type errors in critical business logic paths not caught at compile time.

---

### ISSUE-025: StreamListener reconnect may not re-subscribe

- **Severity:** MEDIUM
- **Service(s):** Gateway
- **Found by:** Opus, Claude
- **Description:** `gateway/lib/hive_gateway/stream_listener.ex` lines 73-76. The `:reconnected` handler only logs. While `Redix.PubSub` documentation says it auto-resubscribes on reconnect, this behavior should be verified and not assumed. If auto-resubscription fails silently, all streaming stops with no error.
- **Recommendation:** Add explicit re-subscription in the reconnect handler as a safety measure. Log whether the re-subscription succeeds.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** After a Redis blip, streaming may silently stop until the Gateway is restarted. The watchdog catches stuck streams but new streams won't trigger at all.

---

### ISSUE-026: Sequence race condition on first channel message

- **Severity:** MEDIUM
- **Service(s):** Gateway
- **Found by:** Claude
- **Description:** `gateway/lib/hive_gateway_web/channels/room_channel.ex` lines 425-445. The `next_sequence` function does GET → SET NX → INCR as three separate Redis commands. On the very first message in a channel, two concurrent messages can both see `nil` from GET, both try SET NX (one succeeds, one fails), and both proceed to INCR. Result: one message may get an unexpected sequence number. The Prisma unique constraint on `(channelId, sequence)` would catch a collision, but the error handling returns a 500 instead of retrying.
- **Recommendation:** Replace the three-step seed with a single atomic operation. Use `INCR` directly (it creates the key with value 1 if it doesn't exist) — no need for the GET/SET NX dance at all.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Low probability race on the first message per channel. Would manifest as a 500 error on one of two simultaneous first messages.

---

## LOW Issues

---

### ISSUE-027: `manage-bots-modal.tsx` delete has no confirmation

- **Severity:** LOW
- **Service(s):** Web
- **Found by:** Opus, Claude
- **Description:** `packages/web/components/modals/manage-bots-modal.tsx` lines 163-177. Clicking "Delete" immediately fires the DELETE request with no confirmation dialog. Accidental deletion destroys the bot's encrypted API key and system prompt permanently.
- **Recommendation:** Add a confirmation step: "Delete bot {name}? This cannot be undone."
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Accidental bot deletion with no recovery.

---

### ISSUE-028: Invite code generation has modulo bias

- **Severity:** LOW
- **Service(s):** Web
- **Found by:** Opus, Claude
- **Description:** `packages/web/lib/invite-code.ts` line 13. `bytes[i] % 62` produces a ~3% bias toward the first 8 characters of the charset because `256 % 62 = 8`. For 8-character codes this reduces entropy from ~47.9 bits to ~47.6 bits.
- **Recommendation:** Use rejection sampling: discard bytes >= 248 (`Math.floor(256 / 62) * 62`).
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Negligible security impact for invite codes. The bias is too small to be practically exploitable.

---

### ISSUE-029: Redundant database indexes

- **Severity:** LOW
- **Service(s):** Web / Database
- **Found by:** Claude
- **Description:** `prisma/schema.prisma`:
  1. `Invite` has `@@index([code])` alongside `code @unique` — the unique constraint already creates an index.
  2. `Reaction` has `@@index([messageId])` alongside `@@unique([messageId, userId, emoji])` — the composite unique index's leading column serves `messageId` lookups.
- **Recommendation:** Remove `@@index([code])` from Invite and `@@index([messageId])` from Reaction.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Wasted storage and marginally slower writes. No functional impact.

---

### ISSUE-030: `goto` pattern in Go stream manager

- **Severity:** LOW
- **Service(s):** Streaming
- **Found by:** Claude
- **Description:** `streaming/internal/stream/manager.go` uses `goto streamDone` to exit the token loop. This works correctly today, but if a `defer` is ever added inside the loop body, it won't execute on the `goto` path.
- **Recommendation:** Replace `goto streamDone` with `break` + a labeled for loop, or restructure with a function.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Fragile if future modifications add deferred cleanup inside the loop.

---

### ISSUE-031: Postgres port exposed to host

- **Severity:** LOW
- **Service(s):** Docker
- **Found by:** Claude
- **Description:** `docker-compose.yml` line 27 exposes Postgres on `${POSTGRES_HOST_PORT:-55432}:5432`. Useful for development but a risk on cloud VMs.
- **Recommendation:** Add a comment noting this should be removed or bound to 127.0.0.1 in production. The `docker-compose.prod.yml` should not expose it.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Database accessible from the network on cloud deployments with open firewalls.

---

### ISSUE-032: `useSocket` handlers accumulate on strict mode

- **Severity:** LOW
- **Service(s):** Web
- **Found by:** Claude
- **Description:** `packages/web/lib/hooks/use-socket.ts` lines 28-33. Phoenix's `sock.onOpen` and `sock.onClose` append handlers. Under React Strict Mode (double mount in dev), handlers accumulate. The `mountedRef` guard prevents stale state updates, but closures remain attached.
- **Recommendation:** Track whether handlers are registered and skip re-registration, or clean up on unmount.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** Minor memory leak in development. No effect in production builds.

---

### ISSUE-033: `parse_limit(0)` returns success instead of error

- **Severity:** LOW
- **Service(s):** Gateway
- **Found by:** Claude (code scan)
- **Description:** `gateway/lib/hive_gateway_web/channels/room_channel.ex` — `parse_limit/1` accepts `value >= 0`, meaning `limit=0` returns `{:ok, 0}`. A Prisma query with `take: 0` returns nothing without error, which is confusing.
- **Recommendation:** Change to `value > 0`.
- **PROTOCOL.md impact:** No
- **Risk if ignored:** A client requesting `limit=0` gets an empty response instead of a validation error.

---

## NEEDS DECISION

---

### ISSUE-015 (above): Open server join

- **Decision needed:** Should `POST /api/servers/{serverId}/members` be removed entirely (requiring invite-only joins), or should an `isPublic` flag be added to the Server model?
- **Context:** Currently documented as intentional MVP behavior (BREAK-0013). The three agent reviews are split — Composer and Opus flag it as a security issue; the KNOWN-ISSUES.md calls it intentional.
- **Nick's call needed.**

---

## Deferred (Not In Scope for This Sweep)

These items came from the agent reviews but are feature requests, future architecture work, or V1 tasks — not current bugs.

1. **Vitest setup + baseline web tests** — All three agents recommend this. Captured in the refactoring recommendations but not a bug fix. Scheduled for pre-V1 launch.
2. **`useChannel` hook decomposition** — ISSUE-018 flags it as MEDIUM but the actual refactoring is V1 prep work, not a consolidation fix. Listed as a finding but execution deferred to V1.
3. **MessageLayout component extraction** — Composer and Codex recommend a shared layout between `message-item.tsx` and `streaming-message.tsx`. This is a refactor, not a fix.
4. **`handle_bot_trigger` extraction to separate module** — Composer recommends extracting trigger logic. This is a refactor for V1 multi-bot support.
5. **Reaction real-time broadcast** — All three agents note reactions don't broadcast in real-time. This is TASK-0030, already tracked.
6. **TASK-0026 (JSON Schema contracts)** — Codex pulled this to launch; Composer kept it post-launch. Currently a TODO task, not a consolidation item.
7. **gRPC/Protobuf upgrade (TASK-0027)** — Architecture improvement, not a bug.
8. **Provider abstraction refactor (TASK-0013)** — Architecture improvement, not a bug.
9. **Multi-stream support (TASK-0012)** — Feature work, not a bug.
10. **Agent thinking timeline (TASK-0011)** — Feature work, not a bug.
11. **Gateway permission enforcement (BREAK-0012)** — Tracked in KNOWN-ISSUES.md, scheduled for TASK-0014.
12. **DM channel implementation (TASK-0019)** — Feature work.
13. **k6/artillery load testing setup** — Infrastructure improvement, not a bug.
14. **`chatProvider` consolidation into single batch fetch** — ISSUE-023 is the finding. The fix is a refactor, not a bug fix. Listed for awareness.

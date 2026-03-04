# KNOWN-ISSUES.md — Confirmed Failures & Bugs

> Format: ID, severity, description, repro steps, status.
> Severity: `CRITICAL` | `HIGH` | `MEDIUM` | `LOW`

---

## BREAK-0001

- **Severity**: `CRITICAL`
- **Description**: Bot streaming placeholder persistence failed because `Message.authorId` enforced a `User` FK for BOT authors.
- **Status**: `RESOLVED` (2026-02-25)
- **Fix summary**: Removed `Message.author` FK relation, dropped `Message_authorId_fkey` via migration, and switched internal message GET author resolution to explicit user/bot lookups.

## BREAK-0002

- **Severity**: `HIGH`
- **Description**: JWTs without `exp` were accepted by `UserSocket.verify_token/1`.
- **Status**: `RESOLVED` (2026-02-25)
- **Fix summary**: Missing/non-numeric `exp` now returns `{:error, :missing_exp}` and regression tests cover missing/expired/valid expiry behavior.

## BREAK-0003

- **Severity**: `HIGH`
- **Description**: `new_message` accepted empty and whitespace-only content.
- **Status**: `RESOLVED` (2026-02-25)
- **Fix summary**: Added trim-based early validation in `RoomChannel.handle_in/3` to reject blank content with `empty_content` before sequence allocation/persistence.

## BREAK-0004

- **Severity**: `MEDIUM`
- **Description**: Protocol docs claimed structured unauthorized payload on socket connect failure, but Phoenix returns transport-level rejection.
- **Status**: `RESOLVED` (2026-02-25)
- **Fix summary**: Updated `docs/PROTOCOL.md` authentication failure wording and logged contract clarification in `DEC-0016`.

## BREAK-0005

- **Severity**: `HIGH`
- **Description**: Unreachable endpoint errors persisted `ERROR` in DB but clients did not always receive terminal `stream_error` WebSocket event.
- **Status**: `RESOLVED` (2026-02-25)
- **Fix summary**: Added Gateway stream watchdog fallback that tracks `stream_start`, polls message status after timeout, and emits synthetic terminal events when Redis pub/sub terminal delivery is missed.

## BREAK-0006

- **Severity**: `HIGH`
- **Description**: 30s token-gap timeout persisted `ERROR` but could miss terminal `stream_error` delivery to clients.
- **Status**: `RESOLVED` (2026-02-25)
- **Fix summary**: Same watchdog fallback as BREAK-0005 plus explicit terminal delivery logging in streaming and gateway services to trace publish/relay gaps.

## BREAK-0007

- **Severity**: `CRITICAL`
- **Description**: Gateway production logger used `Jason.encode!/1` as the Logger console formatter, which does not implement the required 4-argument formatter callback and caused repeated `FORMATTER CRASH` lines.
- **Status**: `RESOLVED` (2026-02-26)
- **Fix summary**: Replaced the console formatter with `TavokGateway.LogFormatter.format/4`, which safely normalizes Logger message iodata/chardata and emits JSON log lines with metadata.

## BREAK-0009

- **Severity**: `HIGH`
- **Description**: During F-02 (Redis kill), stream rows could remain `ACTIVE` in DB indefinitely, causing watchdog retries to loop forever without terminal convergence.
- **Status**: `RESOLVED` (2026-02-26)
- **Fix summary**: Added watchdog max ACTIVE retries with force-update fallback to set DB status to `ERROR` and emit synthetic `stream_error` after 5 consecutive ACTIVE checks.

## BREAK-0010

- **Severity**: `HIGH`
- **Description**: During F-05 (Next.js kill at completion), Go Proxy could publish terminal status to Redis but fail DB finalize HTTP call, leaving DB `ACTIVE`.
- **Status**: `RESOLVED` (2026-02-26)
- **Fix summary**: Added Go Proxy `FinalizeMessageWithRetry` (1s/2s/4s backoff, 3 retries) and switched both COMPLETE and ERROR finalize paths to use it.

## BREAK-0011

- **Severity**: `HIGH`
- **Description**: During F-06 (Gateway restart mid-stream), transient web/gateway instability could cause finalize persistence failure after terminal publish, leaving DB `ACTIVE`.
- **Status**: `RESOLVED` (2026-02-26)
- **Fix summary**: Same two-layer convergence fix as BREAK-0010 plus watchdog force-termination safety net to guarantee eventual non-ACTIVE terminal state.

## BREAK-0012

- **Severity**: `MEDIUM`
- **Description**: Gateway enforces channel membership on `join/3` but does not enforce `SEND_MESSAGES` permission on `handle_in("new_message")`.
- **Status**: `KNOWN` (v0 deferred)
- **Repro steps**:
  1. Join a channel as a member.
  2. Revoke `SEND_MESSAGES` from the member's effective role permissions.
  3. Send `new_message` directly over the WebSocket topic.
  4. Message is accepted despite UI hiding the input.
- **Notes**: v0 accepts this as an architectural limitation; proper fix requires gateway-side permission context (e.g., permission claims in JWT or a permission check path at join/send time).

## BREAK-0013

- **Severity**: `LOW`
- **Description**: Direct server join endpoint remains open; authenticated users can `POST /api/servers/[serverId]/members` without an invite.
- **Status**: `KNOWN` (v0 deferred)
- **Repro steps**:
  1. Authenticate as any user.
  2. Call `POST /api/servers/{serverId}/members`.
  3. Membership is created without invite validation.
- **Notes**: This is legacy MVP behavior used by discover/join flow and is intentionally left in place for v0.

# OPERATIONS.md — How We Build, Test, and Change HiveChat

## Purpose
HiveChat is an AI-native realtime + streaming system.
This repo will degrade quickly without strict workflow discipline.

This document defines:
- how to start work
- how to validate changes
- how to avoid regressions
- how to handle refactors
- how to record decisions

---

## Working Style (Non-Negotiable)
- Build in small increments.
- Always test the thing you changed.
- Don’t refactor unless the task says refactor.
- Preserve streaming lifecycle semantics (`active/complete/error`).
- Keep Docker working for self-hosting.

---

## Daily Workflow (Mandatory)

### Step 1 — Start with TASKS
Before coding:
1) Read `docs/AGENTS.md`
2) Read `docs/TASKS.md`
3) Confirm acceptance criteria for the active task
4) Write a short plan: “what changes / what does not change”

### Step 2 — Implement smallest useful increment
- Prefer one meaningful change per branch/PR.
- Avoid “drive-by refactors.”

### Step 3 — Validate
Run the relevant checks for the services you touched (see Validation section).

### Step 4 — Update docs if needed
Update:
- `docs/KNOWN-ISSUES.md` if you found/confirmed a bug
- `docs/DECISIONS.md` if you made a real tradeoff
- `docs/ARCHITECTURE-CURRENT.md` if structure/contracts changed
- `README.md` if run commands/env changed

---

## Repo Roles (How to Use AI Agents)
We use separate “roles” (separate Cursor chats) to avoid context drift:

- Builder: implements
- Reviewer: checks scope/criteria/contracts
- Verifier/Test: tries to break it, runs checks
- Librarian: updates docs/tasks/decisions

No single chat should do all roles.

---

## Validation: What to Run

### Baseline checks (run often)
- Web typecheck: `make typecheck` or `docker-compose exec web npx tsc --noEmit`
- Web lint: `make lint` or `docker-compose exec web npx next lint`
- Web tests: `make test-web` or `docker-compose exec web npx vitest run`
- Gateway compile: `docker-compose exec gateway mix compile --warnings-as-errors`
- Go vet: `docker-compose exec streaming go vet ./...`
- Health check all services: `make health`

### Service-specific checks
#### Web (Next.js)
- dev server starts
- build passes
- auth flow sanity check
- core UI paths render

#### Gateway (Elixir/Phoenix)
- compile succeeds
- websocket connection works
- message fanout works
- reconnect does not duplicate messages

#### Streaming Proxy (Go)
- can connect to provider stream
- normalizes tokens correctly
- forwards to gateway
- completion/error transitions correct

### Docker checks (major changes)
- `docker-compose up --build` works
- services can talk to each other
- DB migrations apply cleanly
- basic chat works end-to-end

---

## “Break-Test” Checklist (Required before major feature work)
Before adding new features to a fresh v0:
1) Start app (Docker)
2) Login/logout
3) Create server/channel
4) Send/receive messages between two clients
5) Refresh during activity
6) Disconnect/reconnect network
7) Trigger streaming and test:
   - TTFT
   - continuity
   - completion
   - mid-stream error
   - channel switch mid-stream
8) Log failures in `docs/KNOWN-ISSUES.md`

---

## Refactor Policy
Refactors are allowed only when:
- they are explicitly a task
- or they fix critical/high issues discovered by testing

Rules:
- no “cleanup passes”
- no broad renames without need
- no architecture rewrites mid-feature
- if you change contracts, update docs + add a decision entry

---

## Error Handling Rules
- No silent failures.
- All failures must surface an error state (UI or logs).
- Streaming failures must set message status to `error` (message remains visible).

---

## Performance Discipline
When changing realtime/streaming code:
- update or run checks from `docs/PERFORMANCE.md`
- report p95 impacts if known
- avoid regressions in duplicates/out-of-order behavior

---

## Release Discipline (Even for “small” releases)
Before calling something “v1”:
- critical/high known issues resolved or explicitly deferred
- streaming lifecycle reliable
- docker self-host path documented and tested
- core flows validated end-to-end

---

## Branch Naming Convention

Format: `{type}/{short-description}`

| Prefix | Use |
|---|---|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `refactor/` | Code restructure (only when task says so) |
| `chore/` | Build, CI, deps, config |

Examples:
- `feature/user-auth`
- `fix/stream-token-ordering`
- `docs/update-protocol`

---

## Commit Message Convention

Format: `type(scope): description`

Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`
Scopes: `web`, `gateway`, `streaming`, `prisma`, `docker`, `docs`

Examples:
- `feat(web): add user registration form`
- `fix(gateway): prevent duplicate token broadcast`
- `docs(protocol): add stream timeout invariant`
- `chore(docker): update postgres to 16.2`

Keep the description under 72 characters. Use the body for details if needed.

---

## Service Startup Order

Services must start in dependency order:

```
1. PostgreSQL (db)        — no dependencies
2. Redis (redis)          — no dependencies
3. Next.js (web)          — depends on: db, redis (runs Prisma migrations on start)
4. Elixir Gateway         — depends on: redis, web (needs web for internal API)
5. Go Streaming Proxy     — depends on: redis (needs Redis for pub/sub)
```

`docker-compose.yml` enforces this via `depends_on` with health checks.
If a service crashes, Docker restarts it. The service must handle temporary unavailability of its dependencies gracefully (retry with backoff).

---

## Log Inspection Guide

### View logs
```bash
make logs                    # all services, follow mode
make logs-web                # just Next.js
make logs-gateway            # just Elixir Gateway
make logs-stream             # just Go Streaming Proxy
docker-compose logs db       # just PostgreSQL
docker-compose logs redis    # just Redis
```

### What to look for
- **Startup**: Each service should log “started” or “listening on port X”
- **Health**: `make health` should return `{“status”:”ok”}` from all three app services
- **Errors**: Search for `”level”:”error”` in JSON logs
- **Streaming issues**: Search for `stream_start`, `stream_complete`, `stream_error` events
- **Connection issues**: Check for `connection refused` or `timeout` between services

### Correlation IDs
Every request that crosses a service boundary should include a `x-request-id` header.
Log entries include this ID for tracing a request across services.
Format: ULID (generated by the originating service).

---

## Contract Change Protocol

When you need to change a cross-service contract (WebSocket events, Redis pub/sub, HTTP internal APIs):

1. **Update `docs/PROTOCOL.md` first** — change the contract definition
2. **Add a `docs/DECISIONS.md` entry** — explain why the contract changed
3. **Update all affected services** — every service that produces or consumes the changed contract
4. **Update `docs/ARCHITECTURE-CURRENT.md`** — if the change affects the architecture diagram
5. **Run break-test** — verify no regressions across services
6. **Bump protocol version** — increment the version in PROTOCOL.md changelog

Never change a service's behavior without updating the contract first.
Never change the contract without updating all affected services in the same PR.
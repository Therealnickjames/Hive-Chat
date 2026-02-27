# ARCHITECTURE-TARGET.md — Where We Want to End Up

> This is derived from `docs/HiveChat.md`. It describes the full MVP architecture.
> Compare with `docs/ARCHITECTURE-CURRENT.md` to see the gap.

---

## Target Architecture

See `docs/HiveChat.md` for the full architecture diagram.

### Summary

```
Clients (Browser/PWA)
    │ HTTPS              │ WebSocket
    ▼                    ▼
Next.js App          Elixir Gateway
(TypeScript)         (Phoenix/OTP)
│                    │
│  ┌─────────────────┤
│  │                 │
▼  ▼                 ▼
PostgreSQL        Go Proxy
                     │
                     ▼
                  LLM APIs
```

### Full MVP Feature Set (Target)

Phase 1 — Foundation: DONE (scaffold)
Phase 2 — Core Chat: servers, channels, real-time messaging, presence, history
Phase 3 — Token Streaming: bot config, Go proxy, smooth client rendering
Phase 4 — Polish: roles, mentions, reactions, markdown, member list, dark theme, uploads, invites
Phase 5 — Self-Hosting: one-command deploy, docs, Caddy HTTPS, admin dashboard

### What NOT to Build

See `docs/HiveChat.md` "What NOT To Build Yet" section.

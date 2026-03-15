# RELEASE-GATE.md — Release Validation Checklist

Every release must pass all gates before deployment. No exceptions.

---

## Gate 1: Unit Tests (Automated — CI)

```bash
make test-unit
```

- [ ] Web unit tests pass (Vitest)
- [ ] CLI unit tests pass (Vitest)
- [ ] Gateway unit tests pass (ExUnit)
- [ ] Streaming unit tests pass (Go test)
- [ ] Hook smoke tests pass

**Failure = no release.**

---

## Gate 2: Type Safety (Automated — CI)

```bash
make lint
```

- [ ] TypeScript compiles without errors
- [ ] Elixir formatter passes
- [ ] Go vet passes

---

## Gate 3: Migration Smoke Test (Automated — CI)

```bash
make db-migrate-test
```

- [ ] All migrations apply cleanly on fresh database
- [ ] Key tables and enums verified
- [ ] Reapply is idempotent

---

## Gate 4: Integration Tests (Automated — CI)

```bash
make regression-harness
```

- [ ] All 22 regression scenarios pass (K-001 through K-022)
- [ ] Playwright E2E tests pass

---

## Gate 5: Pre-Deploy Backup

```bash
make db-backup
```

- [ ] Database backup created and verified
- [ ] Backup file size is non-trivial (not empty/corrupt)

---

## Gate 6: Load Test (Pre-Release — Manual)

```bash
k6 run tests/load/k6-messaging.js
k6 run tests/load/k6-typing-storm.js
```

- [ ] p95 HTTP latency < 2000ms
- [ ] p95 WebSocket connect < 3000ms
- [ ] p95 message delivery < 1000ms
- [ ] WebSocket connect fail rate < 10%
- [ ] Typing storm doesn't crash the server

---

## Gate 7: Soak Test (Pre-Major-Release — Manual)

```bash
k6 run tests/load/k6-soak.js
```

- [ ] 10-minute sustained load at 10 VUs
- [ ] p95 delivery latency < 2000ms
- [ ] Error rate < 5%
- [ ] No memory leak (RSS growth < 20% over duration)
- [ ] Health checks pass throughout

---

## Gate 8: Failure Recovery (Pre-Major-Release — Manual)

```bash
pwsh scripts/stress-harness.ps1
```

- [ ] F-01: Redis restart — streams recover
- [ ] F-02: Streaming proxy restart — active streams converge to terminal state
- [ ] F-03: Web restart during active streams — no orphaned ACTIVE messages
- [ ] F-04: Reconnect recovery — clients reconnect and receive missed messages

---

## Gate 9: Smoke Test (Post-Deploy)

```bash
make health
```

- [ ] All 3 health endpoints return OK
- [ ] Login works
- [ ] Send and receive a message
- [ ] Agent streaming triggers and completes (if LLM keys configured)

---

## Quick Reference

| Gate | Type | When | Tool |
|------|------|------|------|
| 1. Unit tests | Auto | Every PR | `make test-unit` |
| 2. Type safety | Auto | Every PR | `make lint` |
| 3. Migration test | Auto | Every PR | `make db-migrate-test` |
| 4. Integration | Auto | Every PR | `make regression-harness` |
| 5. Backup | Manual | Pre-deploy | `make db-backup` |
| 6. Load test | Manual | Pre-release | `k6 run tests/load/k6-messaging.js` |
| 7. Soak test | Manual | Major releases | `k6 run tests/load/k6-soak.js` |
| 8. Failure recovery | Manual | Major releases | `pwsh scripts/stress-harness.ps1` |
| 9. Post-deploy smoke | Manual | Post-deploy | `make health` + manual check |

# PERFORMANCE.md — Performance Benchmarks & Targets

> Updated when real-time or streaming code changes.
> Report p95 impacts for any changes to the hot path.

---

## Targets

| Metric | Target | Current | Notes |
|---|---|---|---|
| TTFT overhead (gateway + proxy) | < 200ms | N/A | Excludes LLM provider latency |
| Token-to-screen latency | < 50ms | N/A | Go Proxy → Redis → Gateway → WebSocket → Browser |
| WebSocket connect time | < 100ms | N/A | Including JWT validation |
| Message broadcast latency | < 20ms | N/A | Gateway receive → all clients receive |
| Max concurrent WebSocket connections | 10,000+ per Gateway | N/A | Per Elixir node |
| Max concurrent LLM streams | 1,000+ per Proxy | N/A | Per Go instance |
| Memory per WebSocket connection | < 50KB | N/A | Elixir process overhead |
| Memory per LLM stream | < 1MB | N/A | Goroutine + token buffer |

---

## How to Measure

*TODO: Add benchmarking scripts and load test configuration once core features are working.*

---

## Historical Results

*No results yet. First benchmarks after TASK-0003 (Core Chat) is complete.*

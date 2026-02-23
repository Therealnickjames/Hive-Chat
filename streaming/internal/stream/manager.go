// Package stream manages active LLM streaming sessions.
//
// The manager:
// - Listens for stream requests on Redis pub/sub (hive:stream:request)
// - Spawns a goroutine per stream
// - Pushes tokens to Redis (hive:stream:tokens:{channelId}:{messageId})
// - Publishes completion/error to Redis (hive:stream:status:{channelId}:{messageId})
//
// See docs/PROTOCOL.md §2 for Redis event contracts.
// See docs/PROTOCOL.md §4 for streaming lifecycle invariants.
//
// TODO: Implement in TASK-0004
package stream

import (
	"log/slog"
	"sync"
)

// Manager tracks all active streams and coordinates lifecycle.
type Manager struct {
	mu      sync.RWMutex
	active  map[string]struct{} // messageId → active stream
	logger  *slog.Logger
}

// NewManager creates a new stream manager.
func NewManager(logger *slog.Logger) *Manager {
	return &Manager{
		active: make(map[string]struct{}),
		logger: logger,
	}
}

// ActiveCount returns the number of currently active streams.
func (m *Manager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.active)
}

package stream

import (
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"testing"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestNewManagerDefaultsToConfiguredConcurrency(t *testing.T) {
	manager := NewManager(silentLogger(), nil, nil, nil, 3)

	if manager.maxConcurrentStreams != 3 {
		t.Fatalf("expected maxConcurrentStreams=3, got %d", manager.maxConcurrentStreams)
	}
	if cap(manager.semaphore) != 3 {
		t.Fatalf("expected semaphore cap=3, got %d", cap(manager.semaphore))
	}
}

func TestNewManagerDefaultsConcurrencyWhenZero(t *testing.T) {
	manager := NewManager(silentLogger(), nil, nil, nil, 0)

	if manager.maxConcurrentStreams != 32 {
		t.Fatalf("expected default maxConcurrentStreams=32, got %d", manager.maxConcurrentStreams)
	}
	if cap(manager.semaphore) != 32 {
		t.Fatalf("expected default semaphore cap=32, got %d", cap(manager.semaphore))
	}
}

func TestNewManagerDefaultsConcurrencyWhenNegative(t *testing.T) {
	manager := NewManager(silentLogger(), nil, nil, nil, -5)

	if manager.maxConcurrentStreams != 32 {
		t.Fatalf("expected default maxConcurrentStreams=32, got %d", manager.maxConcurrentStreams)
	}
}

func TestConcurrencyLimitRejectsAdditionalSlots(t *testing.T) {
	manager := &Manager{
		logger:              silentLogger(),
		active:              make(map[string]struct{}),
		maxConcurrentStreams: 1,
		semaphore:           make(chan struct{}, 1),
	}

	if !manager.tryAcquireSlot() {
		t.Fatal("expected first slot to be acquired")
	}
	if manager.tryAcquireSlot() {
		t.Fatal("expected second slot acquisition to be rejected")
	}

	manager.releaseSlot()

	if !manager.tryAcquireSlot() {
		t.Fatal("expected slot to be reusable after release")
	}
}

func TestActiveCountStartsAtZero(t *testing.T) {
	manager := NewManager(silentLogger(), nil, nil, nil, 10)

	if manager.ActiveCount() != 0 {
		t.Fatalf("expected ActiveCount=0, got %d", manager.ActiveCount())
	}
}

func TestActiveCountTracksConcurrentStreams(t *testing.T) {
	manager := &Manager{
		logger:              silentLogger(),
		active:              make(map[string]struct{}),
		maxConcurrentStreams: 10,
		semaphore:           make(chan struct{}, 10),
	}

	manager.mu.Lock()
	manager.active["msg-1"] = struct{}{}
	manager.active["msg-2"] = struct{}{}
	manager.active["msg-3"] = struct{}{}
	manager.mu.Unlock()

	if manager.ActiveCount() != 3 {
		t.Fatalf("expected ActiveCount=3, got %d", manager.ActiveCount())
	}

	manager.mu.Lock()
	delete(manager.active, "msg-2")
	manager.mu.Unlock()

	if manager.ActiveCount() != 2 {
		t.Fatalf("expected ActiveCount=2, got %d", manager.ActiveCount())
	}
}

func TestSemaphoreConcurrency(t *testing.T) {
	manager := &Manager{
		logger:              silentLogger(),
		active:              make(map[string]struct{}),
		maxConcurrentStreams: 5,
		semaphore:           make(chan struct{}, 5),
	}

	for i := 0; i < 5; i++ {
		if !manager.tryAcquireSlot() {
			t.Fatalf("expected slot %d to be acquired", i)
		}
	}

	if manager.tryAcquireSlot() {
		t.Fatal("expected slot 6 to be rejected")
	}

	for i := 0; i < 5; i++ {
		manager.releaseSlot()
	}

	if !manager.tryAcquireSlot() {
		t.Fatal("expected slot to be available after release")
	}
}

func TestStreamRequestDeserialization(t *testing.T) {
	raw := `{
		"channelId": "ch-1",
		"messageId": "msg-1",
		"botId": "bot-1",
		"triggerMessageId": "trigger-1",
		"contextMessages": [
			{"role": "user", "content": "hello"},
			{"role": "assistant", "content": "hi"}
		]
	}`

	var req streamRequest
	if err := json.Unmarshal([]byte(raw), &req); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if req.ChannelID != "ch-1" {
		t.Errorf("ChannelID = %q, want %q", req.ChannelID, "ch-1")
	}
	if req.MessageID != "msg-1" {
		t.Errorf("MessageID = %q, want %q", req.MessageID, "msg-1")
	}
	if req.BotID != "bot-1" {
		t.Errorf("BotID = %q, want %q", req.BotID, "bot-1")
	}
	if req.TriggerMsgID != "trigger-1" {
		t.Errorf("TriggerMsgID = %q, want %q", req.TriggerMsgID, "trigger-1")
	}
	if len(req.ContextMessages) != 2 {
		t.Fatalf("ContextMessages len = %d, want 2", len(req.ContextMessages))
	}
	if req.ContextMessages[0].Role != "user" {
		t.Errorf("ContextMessages[0].Role = %q, want %q", req.ContextMessages[0].Role, "user")
	}
}

func TestStreamRequestDeserializationInvalid(t *testing.T) {
	var req streamRequest
	err := json.Unmarshal([]byte("not json"), &req)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestStreamRequestDeserializationEmpty(t *testing.T) {
	var req streamRequest
	err := json.Unmarshal([]byte(`{}`), &req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if req.ChannelID != "" {
		t.Errorf("ChannelID = %q, want empty", req.ChannelID)
	}
	if len(req.ContextMessages) != 0 {
		t.Errorf("ContextMessages len = %d, want 0", len(req.ContextMessages))
	}
}

func TestActiveCountIsThreadSafe(t *testing.T) {
	manager := &Manager{
		logger:              silentLogger(),
		active:              make(map[string]struct{}),
		maxConcurrentStreams: 100,
		semaphore:           make(chan struct{}, 100),
	}

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			key := string(rune('A' + id))
			manager.mu.Lock()
			manager.active[key] = struct{}{}
			manager.mu.Unlock()
			_ = manager.ActiveCount()
			manager.mu.Lock()
			delete(manager.active, key)
			manager.mu.Unlock()
		}(i)
	}
	wg.Wait()

	if manager.ActiveCount() != 0 {
		t.Fatalf("expected ActiveCount=0 after all goroutines done, got %d", manager.ActiveCount())
	}
}

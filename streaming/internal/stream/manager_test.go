package stream

import (
	"io"
	"log/slog"
	"testing"
)

func TestNewManagerDefaultsToConfiguredConcurrency(t *testing.T) {
	manager := NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, 3)

	if manager.maxConcurrentStreams != 3 {
		t.Fatalf("expected maxConcurrentStreams=3, got %d", manager.maxConcurrentStreams)
	}
	if cap(manager.semaphore) != 3 {
		t.Fatalf("expected semaphore cap=3, got %d", cap(manager.semaphore))
	}
}

func TestConcurrencyLimitRejectsAdditionalSlots(t *testing.T) {
	manager := &Manager{
		logger:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		active:               make(map[string]struct{}),
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

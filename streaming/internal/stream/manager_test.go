package stream

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/TavokAI/Tavok/streaming/internal/provider"
	"github.com/TavokAI/Tavok/streaming/internal/tools"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestNewManagerDefaultsToConfiguredConcurrency(t *testing.T) {
	manager := NewManager(silentLogger(), nil, nil, nil, nil, 3)

	if manager.maxConcurrentStreams != 3 {
		t.Fatalf("expected maxConcurrentStreams=3, got %d", manager.maxConcurrentStreams)
	}
	if cap(manager.semaphore) != 3 {
		t.Fatalf("expected semaphore cap=3, got %d", cap(manager.semaphore))
	}
}

func TestNewManagerDefaultsConcurrencyWhenZero(t *testing.T) {
	manager := NewManager(silentLogger(), nil, nil, nil, nil, 0)

	if manager.maxConcurrentStreams != 32 {
		t.Fatalf("expected default maxConcurrentStreams=32, got %d", manager.maxConcurrentStreams)
	}
	if cap(manager.semaphore) != 32 {
		t.Fatalf("expected default semaphore cap=32, got %d", cap(manager.semaphore))
	}
}

func TestNewManagerDefaultsConcurrencyWhenNegative(t *testing.T) {
	manager := NewManager(silentLogger(), nil, nil, nil, nil, -5)

	if manager.maxConcurrentStreams != 32 {
		t.Fatalf("expected default maxConcurrentStreams=32, got %d", manager.maxConcurrentStreams)
	}
}

func TestConcurrencyLimitRejectsAdditionalSlots(t *testing.T) {
	manager := &Manager{
		logger:               silentLogger(),
		active:               make(map[string]struct{}),
		maxConcurrentStreams: 1,
		semaphore:            make(chan struct{}, 1),
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
	manager := NewManager(silentLogger(), nil, nil, nil, nil, 10)

	if manager.ActiveCount() != 0 {
		t.Fatalf("expected ActiveCount=0, got %d", manager.ActiveCount())
	}
}

func TestActiveCountTracksConcurrentStreams(t *testing.T) {
	manager := &Manager{
		logger:               silentLogger(),
		active:               make(map[string]struct{}),
		maxConcurrentStreams: 10,
		semaphore:            make(chan struct{}, 10),
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
		logger:               silentLogger(),
		active:               make(map[string]struct{}),
		maxConcurrentStreams: 5,
		semaphore:            make(chan struct{}, 5),
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

// --- TASK-0012: Multi-Stream in One Channel Tests ---

func TestMultipleBotsTrackedIndependently(t *testing.T) {
	manager := &Manager{
		logger:               silentLogger(),
		active:               make(map[string]struct{}),
		maxConcurrentStreams: 10,
		semaphore:            make(chan struct{}, 10),
	}

	// Simulate 3 bots streaming concurrently in the same channel
	// Each bot gets a unique messageId (per the multi-bot protocol)
	botMessages := []string{"msg-bot1-ch1", "msg-bot2-ch1", "msg-bot3-ch1"}

	for _, msgID := range botMessages {
		if !manager.tryAcquireSlot() {
			t.Fatalf("failed to acquire slot for %s", msgID)
		}
		manager.mu.Lock()
		manager.active[msgID] = struct{}{}
		manager.mu.Unlock()
	}

	if manager.ActiveCount() != 3 {
		t.Fatalf("expected 3 active streams, got %d", manager.ActiveCount())
	}

	// First bot completes
	manager.mu.Lock()
	delete(manager.active, "msg-bot1-ch1")
	manager.mu.Unlock()
	manager.releaseSlot()

	if manager.ActiveCount() != 2 {
		t.Fatalf("expected 2 active streams after bot1 completes, got %d", manager.ActiveCount())
	}

	// Second bot errors — still tracked until removed
	manager.mu.Lock()
	delete(manager.active, "msg-bot2-ch1")
	manager.mu.Unlock()
	manager.releaseSlot()

	if manager.ActiveCount() != 1 {
		t.Fatalf("expected 1 active stream after bot2 errors, got %d", manager.ActiveCount())
	}

	// Third bot completes
	manager.mu.Lock()
	delete(manager.active, "msg-bot3-ch1")
	manager.mu.Unlock()
	manager.releaseSlot()

	if manager.ActiveCount() != 0 {
		t.Fatalf("expected 0 active streams after all complete, got %d", manager.ActiveCount())
	}
}

func TestMultiStreamSemaphoreIsolation(t *testing.T) {
	// With concurrency limit of 3, exactly 3 bots can stream simultaneously
	manager := &Manager{
		logger:               silentLogger(),
		active:               make(map[string]struct{}),
		maxConcurrentStreams: 3,
		semaphore:            make(chan struct{}, 3),
	}

	// Acquire 3 slots (one per bot)
	for i := 0; i < 3; i++ {
		if !manager.tryAcquireSlot() {
			t.Fatalf("expected slot %d to be acquired", i)
		}
	}

	// 4th bot in same channel should be rejected (semaphore full)
	if manager.tryAcquireSlot() {
		t.Fatal("expected 4th concurrent stream to be rejected")
	}

	// Release one slot — 4th bot can now proceed
	manager.releaseSlot()
	if !manager.tryAcquireSlot() {
		t.Fatal("expected slot to be available after release")
	}
}

func TestMultiStreamRequestDeserialization(t *testing.T) {
	// Verify two stream requests for the same channel but different bots
	// can coexist without field collision
	raw1 := `{
		"channelId": "ch-1",
		"messageId": "msg-bot1",
		"botId": "bot-1",
		"triggerMessageId": "trigger-1",
		"contextMessages": [{"role": "user", "content": "hello"}]
	}`
	raw2 := `{
		"channelId": "ch-1",
		"messageId": "msg-bot2",
		"botId": "bot-2",
		"triggerMessageId": "trigger-1",
		"contextMessages": [{"role": "user", "content": "hello"}]
	}`

	var req1, req2 streamRequest
	if err := json.Unmarshal([]byte(raw1), &req1); err != nil {
		t.Fatalf("unmarshal req1: %v", err)
	}
	if err := json.Unmarshal([]byte(raw2), &req2); err != nil {
		t.Fatalf("unmarshal req2: %v", err)
	}

	// Same channel, same trigger
	if req1.ChannelID != req2.ChannelID {
		t.Errorf("ChannelIDs should match: %q != %q", req1.ChannelID, req2.ChannelID)
	}
	if req1.TriggerMsgID != req2.TriggerMsgID {
		t.Errorf("TriggerMsgIDs should match: %q != %q", req1.TriggerMsgID, req2.TriggerMsgID)
	}

	// Different message IDs and bot IDs
	if req1.MessageID == req2.MessageID {
		t.Error("MessageIDs should differ for multi-bot")
	}
	if req1.BotID == req2.BotID {
		t.Error("BotIDs should differ for multi-bot")
	}
}

func TestActiveCountIsThreadSafe(t *testing.T) {
	manager := &Manager{
		logger:               silentLogger(),
		active:               make(map[string]struct{}),
		maxConcurrentStreams: 100,
		semaphore:            make(chan struct{}, 100),
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

// --- appendToolContext Tests (TASK-0018) ---

func newTestManager() *Manager {
	return &Manager{
		logger:               silentLogger(),
		active:               make(map[string]struct{}),
		maxConcurrentStreams: 10,
		semaphore:            make(chan struct{}, 10),
	}
}

func TestAppendToolContext_SingleToolCall(t *testing.T) {
	m := newTestManager()

	initialMsgs := []provider.StreamMessage{
		{Role: "user", Content: "What time is it?"},
	}

	toolCalls := []provider.ToolCall{
		{ID: "call-1", Name: "current_time", Arguments: map[string]interface{}{"timezone": "UTC"}},
	}

	results := []tools.ToolCallResult{
		{CallID: "call-1", Name: "current_time", Content: "2026-03-02T12:00:00Z", IsError: false},
	}

	got := m.appendToolContext(initialMsgs, toolCalls, results, "anthropic")

	// Should have: original message + assistant tool_use message + tool result message
	if len(got) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(got))
	}

	// First message unchanged
	if got[0].Role != "user" || got[0].Content != "What time is it?" {
		t.Errorf("first message modified: role=%q content=%q", got[0].Role, got[0].Content)
	}

	// Second message: assistant with tool calls JSON
	if got[1].Role != "assistant" {
		t.Errorf("second message role = %q, want assistant", got[1].Role)
	}
	if !strings.Contains(got[1].Content, "Tool calls:") {
		t.Errorf("second message should contain tool calls marker, got: %q", got[1].Content)
	}
	if !strings.Contains(got[1].Content, "current_time") {
		t.Errorf("second message should contain tool name, got: %q", got[1].Content)
	}
	if !strings.Contains(got[1].Content, "call-1") {
		t.Errorf("second message should contain call ID, got: %q", got[1].Content)
	}

	// Third message: user with tool result
	if got[2].Role != "user" {
		t.Errorf("third message role = %q, want user", got[2].Role)
	}
	if !strings.Contains(got[2].Content, "Tool result for current_time") {
		t.Errorf("third message should contain tool result marker, got: %q", got[2].Content)
	}
	if !strings.Contains(got[2].Content, "call-1") {
		t.Errorf("third message should contain call ID, got: %q", got[2].Content)
	}
	if !strings.Contains(got[2].Content, "2026-03-02T12:00:00Z") {
		t.Errorf("third message should contain result content, got: %q", got[2].Content)
	}
}

func TestAppendToolContext_MultipleToolCalls(t *testing.T) {
	m := newTestManager()

	initialMsgs := []provider.StreamMessage{
		{Role: "user", Content: "Search and tell me the time"},
	}

	toolCalls := []provider.ToolCall{
		{ID: "call-1", Name: "web_search", Arguments: map[string]interface{}{"query": "news"}},
		{ID: "call-2", Name: "current_time", Arguments: map[string]interface{}{}},
	}

	results := []tools.ToolCallResult{
		{CallID: "call-1", Name: "web_search", Content: "Found 10 results", IsError: false},
		{CallID: "call-2", Name: "current_time", Content: "12:00 UTC", IsError: false},
	}

	got := m.appendToolContext(initialMsgs, toolCalls, results, "anthropic")

	// original + 1 assistant message + 2 tool result messages = 4
	if len(got) != 4 {
		t.Fatalf("expected 4 messages, got %d", len(got))
	}

	// The single assistant message should contain both tool calls
	if !strings.Contains(got[1].Content, "web_search") {
		t.Errorf("assistant message should contain web_search, got: %q", got[1].Content)
	}
	if !strings.Contains(got[1].Content, "current_time") {
		t.Errorf("assistant message should contain current_time, got: %q", got[1].Content)
	}

	// Each result gets its own message
	if !strings.Contains(got[2].Content, "web_search") {
		t.Errorf("first result message should reference web_search, got: %q", got[2].Content)
	}
	if !strings.Contains(got[3].Content, "current_time") {
		t.Errorf("second result message should reference current_time, got: %q", got[3].Content)
	}
}

func TestAppendToolContext_ErrorResult(t *testing.T) {
	m := newTestManager()

	initialMsgs := []provider.StreamMessage{}

	toolCalls := []provider.ToolCall{
		{ID: "call-err", Name: "web_search", Arguments: map[string]interface{}{"query": "test"}},
	}

	results := []tools.ToolCallResult{
		{CallID: "call-err", Name: "web_search", Content: "connection refused", IsError: true},
	}

	got := m.appendToolContext(initialMsgs, toolCalls, results, "openai")

	// assistant + tool result = 2
	if len(got) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(got))
	}

	// Error result should be wrapped with [Tool error: ...]
	if !strings.Contains(got[1].Content, "Tool error:") {
		t.Errorf("error result should contain 'Tool error:' marker, got: %q", got[1].Content)
	}
	if !strings.Contains(got[1].Content, "connection refused") {
		t.Errorf("error result should contain error message, got: %q", got[1].Content)
	}
}

func TestAppendToolContext_NonErrorResultNotWrapped(t *testing.T) {
	m := newTestManager()

	toolCalls := []provider.ToolCall{
		{ID: "call-ok", Name: "my_tool", Arguments: map[string]interface{}{}},
	}

	results := []tools.ToolCallResult{
		{CallID: "call-ok", Name: "my_tool", Content: "success data", IsError: false},
	}

	got := m.appendToolContext(nil, toolCalls, results, "anthropic")

	if len(got) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(got))
	}

	// Non-error result should NOT contain "Tool error:" wrapper
	if strings.Contains(got[1].Content, "Tool error:") {
		t.Errorf("non-error result should not contain 'Tool error:' marker, got: %q", got[1].Content)
	}
	if !strings.Contains(got[1].Content, "success data") {
		t.Errorf("result should contain actual content, got: %q", got[1].Content)
	}
}

func TestAppendToolContext_PreservesExistingMessages(t *testing.T) {
	m := newTestManager()

	existing := []provider.StreamMessage{
		{Role: "system", Content: "You are helpful"},
		{Role: "user", Content: "Hello"},
		{Role: "assistant", Content: "Hi there"},
		{Role: "user", Content: "Use a tool"},
	}

	toolCalls := []provider.ToolCall{
		{ID: "c1", Name: "tool1", Arguments: map[string]interface{}{}},
	}

	results := []tools.ToolCallResult{
		{CallID: "c1", Name: "tool1", Content: "done", IsError: false},
	}

	got := m.appendToolContext(existing, toolCalls, results, "anthropic")

	// 4 existing + 1 assistant + 1 result = 6
	if len(got) != 6 {
		t.Fatalf("expected 6 messages, got %d", len(got))
	}

	// Verify existing messages are untouched
	for i := 0; i < 4; i++ {
		if got[i].Role != existing[i].Role || got[i].Content != existing[i].Content {
			t.Errorf("message[%d] modified: got {%q, %q}, want {%q, %q}",
				i, got[i].Role, got[i].Content, existing[i].Role, existing[i].Content)
		}
	}
}

func TestAppendToolContext_EmptyToolCallsAndResults(t *testing.T) {
	m := newTestManager()

	existing := []provider.StreamMessage{
		{Role: "user", Content: "test"},
	}

	got := m.appendToolContext(existing, []provider.ToolCall{}, []tools.ToolCallResult{}, "anthropic")

	// original + 1 assistant (empty tool calls array) + 0 results = 2
	if len(got) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(got))
	}
	if got[1].Role != "assistant" {
		t.Errorf("second message role = %q, want assistant", got[1].Role)
	}
}

func TestAppendToolContext_NilInitialMessages(t *testing.T) {
	m := newTestManager()

	toolCalls := []provider.ToolCall{
		{ID: "c1", Name: "tool1", Arguments: map[string]interface{}{}},
	}
	results := []tools.ToolCallResult{
		{CallID: "c1", Name: "tool1", Content: "result", IsError: false},
	}

	got := m.appendToolContext(nil, toolCalls, results, "openai")

	// nil + 1 assistant + 1 result = 2
	if len(got) != 2 {
		t.Fatalf("expected 2 messages from nil initial, got %d", len(got))
	}
}

func TestAppendToolContext_ToolCallsSerializedAsJSON(t *testing.T) {
	m := newTestManager()

	toolCalls := []provider.ToolCall{
		{ID: "tc-42", Name: "web_search", Arguments: map[string]interface{}{"query": "golang testing"}},
	}
	results := []tools.ToolCallResult{
		{CallID: "tc-42", Name: "web_search", Content: "results", IsError: false},
	}

	got := m.appendToolContext(nil, toolCalls, results, "anthropic")

	// The assistant message content should contain valid JSON for tool calls
	assistantContent := got[0].Content
	// Extract JSON from "[Tool calls: {...}]" format
	prefix := "[Tool calls: "
	suffix := "]"
	if !strings.HasPrefix(assistantContent, prefix) || !strings.HasSuffix(assistantContent, suffix) {
		t.Fatalf("unexpected assistant content format: %q", assistantContent)
	}
	jsonStr := assistantContent[len(prefix) : len(assistantContent)-len(suffix)]

	var parsed []provider.ToolCall
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		t.Fatalf("failed to parse tool calls JSON from assistant message: %v\nJSON: %s", err, jsonStr)
	}
	if len(parsed) != 1 {
		t.Fatalf("expected 1 tool call in JSON, got %d", len(parsed))
	}
	if parsed[0].Name != "web_search" {
		t.Errorf("parsed tool call name = %q, want web_search", parsed[0].Name)
	}
	if parsed[0].ID != "tc-42" {
		t.Errorf("parsed tool call ID = %q, want tc-42", parsed[0].ID)
	}
}

func TestAppendToolContext_ResultMessageFormat(t *testing.T) {
	m := newTestManager()

	toolCalls := []provider.ToolCall{
		{ID: "id-99", Name: "my_tool", Arguments: map[string]interface{}{}},
	}
	results := []tools.ToolCallResult{
		{CallID: "id-99", Name: "my_tool", Content: "the result", IsError: false},
	}

	got := m.appendToolContext(nil, toolCalls, results, "anthropic")

	// Verify the exact format: "[Tool result for {name} (call {callID})]: {content}"
	expected := fmt.Sprintf("[Tool result for my_tool (call id-99)]: the result")
	if got[1].Content != expected {
		t.Errorf("result message content = %q, want %q", got[1].Content, expected)
	}
}

// --- Empty Response Guard Tests (ISSUE-027) ---
// These test the logic from handleStream where empty final content gets a placeholder.
// Since handleStream has many dependencies, we test the logic pattern directly.

func TestEmptyResponseGuard_EmptyContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{"empty string", "", "*[No response generated]*"},
		{"only spaces", "   ", "*[No response generated]*"},
		{"only newlines", "\n\n", "*[No response generated]*"},
		{"only tabs", "\t\t", "*[No response generated]*"},
		{"mixed whitespace", " \n \t ", "*[No response generated]*"},
		{"has content", "Hello world", "Hello world"},
		{"has content with whitespace", "  Hello  ", "  Hello  "},
		{"single char", "x", "x"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Replicate the guard logic from handleStream (line 419-425)
			finalContent := tt.content
			if strings.TrimSpace(finalContent) == "" {
				finalContent = "*[No response generated]*"
			}

			if finalContent != tt.want {
				t.Errorf("empty guard: got %q, want %q", finalContent, tt.want)
			}
		})
	}
}

func TestEmptyResponseGuard_PlaceholderIsNonEmpty(t *testing.T) {
	placeholder := "*[No response generated]*"
	if strings.TrimSpace(placeholder) == "" {
		t.Fatal("placeholder itself should not be considered empty")
	}
}

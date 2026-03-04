package config

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestGetBotSuccess(t *testing.T) {
	expected := BotConfig{
		ID:          "bot-1",
		Name:        "TestBot",
		LLMProvider: "openai",
		LLMModel:    "gpt-4",
		APIEndpoint: "https://api.openai.com",
		APIKey:      "sk-decrypted-key",
		Temperature: 0.7,
		MaxTokens:   4096,
		TriggerMode: "ALWAYS",
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/bots/bot-1" {
			t.Errorf("path = %q, want /api/internal/bots/bot-1", r.URL.Path)
		}
		if r.Header.Get("x-internal-secret") != "test-secret" {
			t.Errorf("x-internal-secret = %q, want %q", r.Header.Get("x-internal-secret"), "test-secret")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expected)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "test-secret")
	bot, err := loader.GetBot("bot-1")

	if err != nil {
		t.Fatalf("GetBot() error = %v", err)
	}
	if bot.ID != expected.ID {
		t.Errorf("ID = %q, want %q", bot.ID, expected.ID)
	}
	if bot.Name != expected.Name {
		t.Errorf("Name = %q, want %q", bot.Name, expected.Name)
	}
	if bot.APIKey != expected.APIKey {
		t.Errorf("APIKey = %q, want %q", bot.APIKey, expected.APIKey)
	}
}

func TestGetBotUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"Unauthorized"}`))
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "wrong-secret")
	_, err := loader.GetBot("bot-1")

	if err == nil {
		t.Fatal("expected error for 401 response")
	}
}

func TestGetBotNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"Bot not found"}`))
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	_, err := loader.GetBot("nonexistent")

	if err == nil {
		t.Fatal("expected error for 404 response")
	}
}

func TestGetBotInvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`not valid json`))
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	_, err := loader.GetBot("bot-1")

	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestGetBotWithContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second) // slow response
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	_, err := loader.GetBotWithContext(ctx, "bot-1")
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestFinalizeMessageSuccess(t *testing.T) {
	var capturedBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PUT" {
			t.Errorf("method = %q, want PUT", r.Method)
		}
		if r.URL.Path != "/api/internal/messages/msg-1" {
			t.Errorf("path = %q, want /api/internal/messages/msg-1", r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&capturedBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	err := loader.FinalizeMessage("msg-1", "final content", "COMPLETE")

	if err != nil {
		t.Fatalf("FinalizeMessage() error = %v", err)
	}
	if capturedBody["content"] != "final content" {
		t.Errorf("content = %q, want %q", capturedBody["content"], "final content")
	}
	if capturedBody["streamingStatus"] != "COMPLETE" {
		t.Errorf("streamingStatus = %q, want %q", capturedBody["streamingStatus"], "COMPLETE")
	}
}

func TestFinalizeMessageServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"Internal error"}`))
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	err := loader.FinalizeMessage("msg-1", "content", "COMPLETE")

	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestFinalizeMessageWithRetrySucceedsOnSecondAttempt(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := attempts.Add(1)
		if attempt <= 1 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`error`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")

	// Use a short-circuited version: we need the retry to be fast for tests.
	// The real function uses 1s/2s/4s backoffs — we test the logic, not the wait.
	err := loader.FinalizeMessageWithRetryCtx(
		context.Background(),
		"msg-1", "content", "COMPLETE", nil,
	)

	if err != nil {
		t.Fatalf("FinalizeMessageWithRetry() error = %v", err)
	}
	if attempts.Load() != 2 {
		t.Errorf("attempts = %d, want 2", attempts.Load())
	}
}

func TestFinalizeMessageWithRetryContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	ctx, cancel := context.WithCancel(context.Background())

	// Cancel after a short delay — should abort retry loop
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	err := loader.FinalizeMessageWithRetryCtx(ctx, "msg-1", "content", "ERROR", nil)
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

// --- TASK-0011: Thinking Timeline Tests ---

func TestGetThinkingPhaseDefaults(t *testing.T) {
	bot := &BotConfig{}
	// No ThinkingSteps configured — should use defaults
	if got := bot.GetThinkingPhase(0); got != "Thinking" {
		t.Errorf("GetThinkingPhase(0) = %q, want %q", got, "Thinking")
	}
	if got := bot.GetThinkingPhase(1); got != "Writing" {
		t.Errorf("GetThinkingPhase(1) = %q, want %q", got, "Writing")
	}
	// Out of range → returns last
	if got := bot.GetThinkingPhase(5); got != "Writing" {
		t.Errorf("GetThinkingPhase(5) = %q, want %q (last)", got, "Writing")
	}
}

func TestGetThinkingPhaseCustom(t *testing.T) {
	bot := &BotConfig{
		ThinkingSteps: []string{"Planning", "Researching", "Drafting", "Reviewing"},
	}
	if got := bot.GetThinkingPhase(0); got != "Planning" {
		t.Errorf("GetThinkingPhase(0) = %q, want %q", got, "Planning")
	}
	if got := bot.GetThinkingPhase(2); got != "Drafting" {
		t.Errorf("GetThinkingPhase(2) = %q, want %q", got, "Drafting")
	}
	if got := bot.GetThinkingPhase(3); got != "Reviewing" {
		t.Errorf("GetThinkingPhase(3) = %q, want %q", got, "Reviewing")
	}
	// Out of range → returns last
	if got := bot.GetThinkingPhase(10); got != "Reviewing" {
		t.Errorf("GetThinkingPhase(10) = %q, want %q (last)", got, "Reviewing")
	}
}

func TestGetThinkingPhaseNegativeIndex(t *testing.T) {
	bot := &BotConfig{ThinkingSteps: []string{"Alpha", "Beta"}}
	if got := bot.GetThinkingPhase(-1); got != "Beta" {
		t.Errorf("GetThinkingPhase(-1) = %q, want %q (last)", got, "Beta")
	}
}

func TestGetBotWithThinkingSteps(t *testing.T) {
	expected := BotConfig{
		ID:            "bot-ts",
		Name:          "TimelineBot",
		LLMProvider:   "openai",
		LLMModel:      "gpt-4",
		APIEndpoint:   "https://api.openai.com",
		APIKey:        "sk-key",
		ThinkingSteps: []string{"Planning", "Coding", "Reviewing"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expected)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	bot, err := loader.GetBot("bot-ts")

	if err != nil {
		t.Fatalf("GetBot() error = %v", err)
	}
	if len(bot.ThinkingSteps) != 3 {
		t.Fatalf("ThinkingSteps len = %d, want 3", len(bot.ThinkingSteps))
	}
	if bot.ThinkingSteps[0] != "Planning" {
		t.Errorf("ThinkingSteps[0] = %q, want %q", bot.ThinkingSteps[0], "Planning")
	}
}

func TestFinalizeMessageWithTimelineSuccess(t *testing.T) {
	var capturedBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PUT" {
			t.Errorf("method = %q, want PUT", r.Method)
		}
		json.NewDecoder(r.Body).Decode(&capturedBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	timeline := `[{"phase":"Thinking","timestamp":"2026-03-01T12:00:00Z"},{"phase":"Writing","timestamp":"2026-03-01T12:00:01Z"}]`
	err := loader.FinalizeMessageWithTimeline("msg-tl", "final content", "COMPLETE", timeline, nil)

	if err != nil {
		t.Fatalf("FinalizeMessageWithTimeline() error = %v", err)
	}
	if capturedBody["thinkingTimeline"] != timeline {
		t.Errorf("thinkingTimeline = %q, want %q", capturedBody["thinkingTimeline"], timeline)
	}
	if capturedBody["content"] != "final content" {
		t.Errorf("content = %q, want %q", capturedBody["content"], "final content")
	}
}

func TestFinalizeMessageWithTimelineRetry(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := attempts.Add(1)
		if attempt <= 1 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`error`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "secret")
	err := loader.FinalizeMessageWithTimelineCtx(
		context.Background(), "msg-tl", "content", "COMPLETE", "[]", nil,
	)

	if err != nil {
		t.Fatalf("FinalizeMessageWithTimeline retry error = %v", err)
	}
	if attempts.Load() != 2 {
		t.Errorf("attempts = %d, want 2", attempts.Load())
	}
}

func TestFinalizeMessageSetsHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("x-internal-secret") != "my-secret" {
			t.Errorf("x-internal-secret = %q, want my-secret", r.Header.Get("x-internal-secret"))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	loader := NewLoader(srv.URL, "my-secret")
	err := loader.FinalizeMessage("msg-1", "content", "COMPLETE")
	if err != nil {
		t.Fatalf("error = %v", err)
	}
}

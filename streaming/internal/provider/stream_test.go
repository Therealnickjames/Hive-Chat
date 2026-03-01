package provider

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- OpenAI Stream Tests ---

func TestOpenAIStreamSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	p := &OpenAI{client: srv.Client()}
	tokens := make(chan Token, 100)

	result, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint: srv.URL + "/v1/chat/completions",
		APIKey:      "test-key",
		Model:       "gpt-4",
	}, tokens)

	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	if result.FinalContent != "Hello world" {
		t.Errorf("FinalContent = %q, want %q", result.FinalContent, "Hello world")
	}
	if result.TokenCount != 2 {
		t.Errorf("TokenCount = %d, want 2", result.TokenCount)
	}
}

func TestOpenAIStreamAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":{"message":"Invalid model"}}`))
	}))
	defer srv.Close()

	p := &OpenAI{client: srv.Client()}
	tokens := make(chan Token, 100)

	_, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint: srv.URL + "/v1/chat/completions",
		Model:       "invalid",
	}, tokens)

	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("error = %v, should contain 400", err)
	}
}

func TestOpenAIStreamRateLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":{"message":"Rate limit exceeded"}}`))
	}))
	defer srv.Close()

	p := &OpenAI{client: srv.Client()}
	tokens := make(chan Token, 100)

	_, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint: srv.URL + "/v1/chat/completions",
		Model:       "gpt-4",
		APIKey:      "key",
	}, tokens)

	if err == nil {
		t.Fatal("expected error for 429 response")
	}
	if !strings.Contains(err.Error(), "429") {
		t.Errorf("error = %v, should contain 429", err)
	}
}

func TestOpenAIStreamMalformedJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		// Valid token followed by malformed JSON — should not crash
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
		fmt.Fprint(w, "data: {not valid json}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	p := &OpenAI{client: srv.Client()}
	tokens := make(chan Token, 100)

	result, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint: srv.URL + "/v1/chat/completions",
		Model:       "gpt-4",
	}, tokens)

	// Should succeed (malformed chunks are skipped with a warning)
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	if result.FinalContent != "ok" {
		t.Errorf("FinalContent = %q, want %q", result.FinalContent, "ok")
	}
}

func TestOpenAIStreamEmptyResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	p := &OpenAI{client: srv.Client()}
	tokens := make(chan Token, 100)

	result, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint: srv.URL + "/v1/chat/completions",
		Model:       "gpt-4",
	}, tokens)

	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	if result.TokenCount != 0 {
		t.Errorf("TokenCount = %d, want 0", result.TokenCount)
	}
	if result.FinalContent != "" {
		t.Errorf("FinalContent = %q, want empty", result.FinalContent)
	}
}

func TestOpenAIStreamEndpointAutoSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %q, want /v1/chat/completions", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	p := &OpenAI{client: srv.Client()}
	tokens := make(chan Token, 100)

	// Don't include /v1/chat/completions — should be auto-appended
	p.Stream(context.Background(), StreamRequest{
		APIEndpoint: srv.URL,
		Model:       "gpt-4",
	}, tokens)
}

func TestOpenAIStreamContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for i := 0; i < 100; i++ {
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"tok%d \"}}]}\n\n", i)
			flusher.Flush()
			time.Sleep(10 * time.Millisecond)
		}
	}))
	defer srv.Close()

	p := &OpenAI{client: srv.Client()}
	tokens := make(chan Token, 100)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	p.Stream(ctx, StreamRequest{
		APIEndpoint: srv.URL + "/v1/chat/completions",
		Model:       "gpt-4",
	}, tokens)

	// Stream should have been cut short by context cancellation
	// We just verify it doesn't hang
}

// --- Anthropic Stream Tests ---

func TestAnthropicStreamSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "sk-ant-key" {
			t.Errorf("x-api-key = %q", r.Header.Get("x-api-key"))
		}
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("anthropic-version = %q", r.Header.Get("anthropic-version"))
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\"}\n\n")
		fmt.Fprint(w, "event: content_block_start\ndata: {\"type\":\"content_block_start\"}\n\n")
		fmt.Fprint(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n")
		fmt.Fprint(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\" there\"}}\n\n")
		fmt.Fprint(w, "event: content_block_stop\ndata: {\"type\":\"content_block_stop\"}\n\n")
		fmt.Fprint(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n")
		fmt.Fprint(w, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	}))
	defer srv.Close()

	p := &Anthropic{client: srv.Client()}
	tokens := make(chan Token, 100)

	result, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint:     srv.URL + "/v1/messages",
		APIKey:          "sk-ant-key",
		Model:           "claude-3-haiku-20240307",
		MaxTokens:       1024,
		ContextMessages: []StreamMessage{{Role: "user", Content: "hi"}},
	}, tokens)

	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	if result.FinalContent != "Hello there" {
		t.Errorf("FinalContent = %q, want %q", result.FinalContent, "Hello there")
	}
	if result.TokenCount != 2 {
		t.Errorf("TokenCount = %d, want 2", result.TokenCount)
	}
}

func TestAnthropicStreamAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"Bad request"}}`))
	}))
	defer srv.Close()

	p := &Anthropic{client: srv.Client()}
	tokens := make(chan Token, 100)

	_, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint:     srv.URL + "/v1/messages",
		APIKey:          "key",
		Model:           "claude-3-haiku-20240307",
		MaxTokens:       1024,
		ContextMessages: []StreamMessage{{Role: "user", Content: "hi"}},
	}, tokens)

	if err == nil {
		t.Fatal("expected error for 400 response")
	}
}

func TestAnthropicStreamErrorEvent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\"}\n\n")
		fmt.Fprint(w, "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n")
	}))
	defer srv.Close()

	p := &Anthropic{client: srv.Client()}
	tokens := make(chan Token, 100)

	_, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint:     srv.URL + "/v1/messages",
		APIKey:          "key",
		Model:           "claude-3-haiku-20240307",
		MaxTokens:       1024,
		ContextMessages: []StreamMessage{{Role: "user", Content: "hi"}},
	}, tokens)

	if err == nil {
		t.Fatal("expected error from error SSE event")
	}
	if !strings.Contains(err.Error(), "anthropic error event") {
		t.Errorf("error = %v, should mention error event", err)
	}
}

func TestAnthropicStreamDefaultMaxTokens(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	}))
	defer srv.Close()

	p := &Anthropic{client: srv.Client()}
	tokens := make(chan Token, 100)

	// MaxTokens=0 should default to 4096
	result, err := p.Stream(context.Background(), StreamRequest{
		APIEndpoint:     srv.URL + "/v1/messages",
		APIKey:          "key",
		Model:           "claude-3-haiku-20240307",
		MaxTokens:       0,
		ContextMessages: []StreamMessage{{Role: "user", Content: "hi"}},
	}, tokens)

	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	// Should not crash — verifies default maxTokens path
	_ = result
}

func TestAnthropicStreamEndpointAutoSuffix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path = %q, want /v1/messages", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
	}))
	defer srv.Close()

	p := &Anthropic{client: srv.Client()}
	tokens := make(chan Token, 100)

	p.Stream(context.Background(), StreamRequest{
		APIEndpoint:     srv.URL, // No /v1/messages — should auto-append
		APIKey:          "key",
		Model:           "claude-3-haiku-20240307",
		MaxTokens:       1024,
		ContextMessages: []StreamMessage{{Role: "user", Content: "hi"}},
	}, tokens)
}

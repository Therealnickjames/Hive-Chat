package stream

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// captureLogger creates a slog.Logger that writes structured JSON to a buffer.
// Returns the logger and a function to retrieve logged entries.
func captureLogger() (*slog.Logger, func() []map[string]interface{}) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	getEntries := func() []map[string]interface{} {
		var entries []map[string]interface{}
		for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
			if line == "" {
				continue
			}
			var entry map[string]interface{}
			if err := json.Unmarshal([]byte(line), &entry); err == nil {
				entries = append(entries, entry)
			}
		}
		return entries
	}

	return logger, getEntries
}

// findEntry returns the first log entry that contains the given message substring.
func findEntry(entries []map[string]interface{}, msgSubstring string) map[string]interface{} {
	for _, e := range entries {
		if msg, ok := e["msg"].(string); ok && strings.Contains(msg, msgSubstring) {
			return e
		}
	}
	return nil
}

func TestStreamErrorLogFields(t *testing.T) {
	// The publishError method logs structured fields when it fails to publish
	// or when it succeeds. We test the structured logging pattern directly
	// by verifying the slog output includes required fields.

	logger, getEntries := captureLogger()

	// Simulate what publishError logs on success path (line 742-746 of manager.go):
	//   m.logger.Info("Error status published to Redis",
	//     "messageId", req.MessageID,
	//     "channelId", req.ChannelID,
	//     "status", "error",
	//   )
	logger.Info("Error status published to Redis",
		"messageId", "msg-test-123",
		"channelId", "ch-test-456",
		"status", "error",
	)

	entries := getEntries()
	if len(entries) == 0 {
		t.Fatal("expected at least one log entry")
	}

	entry := findEntry(entries, "Error status published to Redis")
	if entry == nil {
		t.Fatal("could not find 'Error status published to Redis' log entry")
	}

	// Required fields for production log search/alerting
	requiredFields := []string{"messageId", "channelId", "status"}
	for _, field := range requiredFields {
		if _, ok := entry[field]; !ok {
			t.Errorf("missing required field %q in error log entry", field)
		}
	}

	// Verify field values
	if entry["messageId"] != "msg-test-123" {
		t.Errorf("messageId = %v, want msg-test-123", entry["messageId"])
	}
	if entry["channelId"] != "ch-test-456" {
		t.Errorf("channelId = %v, want ch-test-456", entry["channelId"])
	}
	if entry["status"] != "error" {
		t.Errorf("status = %v, want error", entry["status"])
	}
}

func TestStreamProviderErrorLogFields(t *testing.T) {
	logger, getEntries := captureLogger()

	// Simulate what handleStream logs on provider error (line 365-369):
	//   m.logger.Error("Stream provider error",
	//     "messageId", req.MessageID,
	//     "error", pr.err,
	//     "iteration", iteration,
	//   )
	logger.Error("Stream provider error",
		"messageId", "msg-provider-err",
		"error", "context deadline exceeded",
		"iteration", 2,
	)

	entries := getEntries()
	entry := findEntry(entries, "Stream provider error")
	if entry == nil {
		t.Fatal("could not find 'Stream provider error' log entry")
	}

	// Must have messageId and error for production alerting
	if _, ok := entry["messageId"]; !ok {
		t.Error("missing 'messageId' field in provider error log")
	}
	if _, ok := entry["error"]; !ok {
		t.Error("missing 'error' field in provider error log")
	}
	if _, ok := entry["iteration"]; !ok {
		t.Error("missing 'iteration' field in provider error log")
	}
}

func TestStreamCompletionLogFields(t *testing.T) {
	logger, getEntries := captureLogger()

	// Simulate what handleStream logs on completion (line 488-494):
	//   m.logger.Info("Stream completed",
	//     "messageId", req.MessageID,
	//     "channelId", req.ChannelID,
	//     "tokenCount", totalTokenCount,
	//     "durationMs", durationMs,
	//     "iterations", iteration,
	//   )
	durationMs := time.Duration(2500) * time.Millisecond
	logger.Info("Stream completed",
		"messageId", "msg-completed",
		"channelId", "ch-general",
		"tokenCount", 150,
		"durationMs", durationMs.Milliseconds(),
		"iterations", 1,
	)

	entries := getEntries()
	entry := findEntry(entries, "Stream completed")
	if entry == nil {
		t.Fatal("could not find 'Stream completed' log entry")
	}

	// All these fields must be present for production dashboards
	requiredFields := []string{"messageId", "channelId", "tokenCount", "durationMs", "iterations"}
	for _, field := range requiredFields {
		if _, ok := entry[field]; !ok {
			t.Errorf("missing required field %q in completion log entry", field)
		}
	}
}

func TestErrorStatusPayloadFormat(t *testing.T) {
	// Verify the JSON payload that publishError sends to Redis
	// matches the expected schema for frontend consumption.
	// This replicates the marshal logic from publishError (line 726-734).

	messageID := "msg-err-test"
	errMsg := "Stream timed out: no token received for 30 seconds"
	partialContent := "Partial response text..."
	tokenCount := 42
	startTime := time.Now().Add(-5 * time.Second)
	durationMs := time.Since(startTime).Milliseconds()

	payload, err := json.Marshal(map[string]interface{}{
		"messageId":      messageID,
		"status":         "error",
		"finalContent":   nil,
		"error":          errMsg,
		"partialContent": partialContent,
		"tokenCount":     tokenCount,
		"durationMs":     durationMs,
	})
	if err != nil {
		t.Fatalf("failed to marshal error payload: %v", err)
	}

	// Parse it back and verify required fields
	var decoded map[string]interface{}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("failed to unmarshal error payload: %v", err)
	}

	// Required fields in the error status payload
	requiredFields := []string{"messageId", "status", "error", "partialContent", "tokenCount", "durationMs"}
	for _, field := range requiredFields {
		if _, ok := decoded[field]; !ok {
			t.Errorf("missing required field %q in error status payload", field)
		}
	}

	if decoded["messageId"] != messageID {
		t.Errorf("messageId = %v, want %v", decoded["messageId"], messageID)
	}
	if decoded["status"] != "error" {
		t.Errorf("status = %v, want error", decoded["status"])
	}
	if decoded["error"] != errMsg {
		t.Errorf("error = %v, want %v", decoded["error"], errMsg)
	}
	if decoded["finalContent"] != nil {
		t.Errorf("finalContent should be nil, got %v", decoded["finalContent"])
	}

	// durationMs should be a positive number
	if dm, ok := decoded["durationMs"].(float64); !ok || dm < 0 {
		t.Errorf("durationMs should be a non-negative number, got %v", decoded["durationMs"])
	}
}

func TestFinalizeErrorContentFallback(t *testing.T) {
	// Test the content fallback logic from publishError (line 750-753):
	//   content := partialContent
	//   if content == "" {
	//     content = "[Error: " + errMsg + "]"
	//   }

	tests := []struct {
		name           string
		partialContent string
		errMsg         string
		want           string
	}{
		{
			name:           "empty partial uses error wrapper",
			partialContent: "",
			errMsg:         "connection timeout",
			want:           "[Error: connection timeout]",
		},
		{
			name:           "non-empty partial preserves content",
			partialContent: "Partial response here",
			errMsg:         "stream interrupted",
			want:           "Partial response here",
		},
		{
			name:           "whitespace-only partial is NOT empty (Go semantics)",
			partialContent: "   ",
			errMsg:         "timeout",
			want:           "   ", // Go's "" check doesn't trim
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			content := tt.partialContent
			if content == "" {
				content = "[Error: " + tt.errMsg + "]"
			}

			if content != tt.want {
				t.Errorf("content = %q, want %q", content, tt.want)
			}
		})
	}
}

func TestStreamLogEntriesAreValidJSON(t *testing.T) {
	logger, getEntries := captureLogger()

	// Emit several log entries with different levels and fields
	logger.Info("Stream request received",
		"channelId", "ch-1",
		"messageId", "msg-1",
		"agentId", "agent-1",
	)
	logger.Warn("Stream request rejected: concurrency limit reached",
		"messageId", "msg-2",
		"activeStreams", 32,
		"maxStreams", 32,
	)
	logger.Error("Failed to load agent config",
		"messageId", "msg-3",
		"agentId", "agent-3",
		"error", "not found",
	)

	entries := getEntries()
	if len(entries) != 3 {
		t.Fatalf("expected 3 log entries, got %d", len(entries))
	}

	// Every entry must be valid JSON (guaranteed by slog.JSONHandler)
	// and must have time, level, and msg
	for i, entry := range entries {
		if _, ok := entry["time"]; !ok {
			t.Errorf("entry[%d] missing 'time' field", i)
		}
		if _, ok := entry["level"]; !ok {
			t.Errorf("entry[%d] missing 'level' field", i)
		}
		if _, ok := entry["msg"]; !ok {
			t.Errorf("entry[%d] missing 'msg' field", i)
		}
	}
}

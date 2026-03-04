package sse

import (
	"strings"
	"testing"
)

func TestParseSingleDataEvent(t *testing.T) {
	input := "data: {\"text\":\"hello\"}\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Data != `{"text":"hello"}` {
		t.Errorf("Data = %q, want %q", events[0].Data, `{"text":"hello"}`)
	}
}

func TestParseMultipleEvents(t *testing.T) {
	input := "data: first\n\ndata: second\n\ndata: third\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("got %d events, want 3", len(events))
	}
	if events[0].Data != "first" {
		t.Errorf("events[0].Data = %q, want %q", events[0].Data, "first")
	}
	if events[1].Data != "second" {
		t.Errorf("events[1].Data = %q, want %q", events[1].Data, "second")
	}
	if events[2].Data != "third" {
		t.Errorf("events[2].Data = %q, want %q", events[2].Data, "third")
	}
}

func TestParseMultiLineData(t *testing.T) {
	input := "data: line1\ndata: line2\ndata: line3\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	// Multi-line data is joined with newlines
	expected := "line1\nline2\nline3"
	if events[0].Data != expected {
		t.Errorf("Data = %q, want %q", events[0].Data, expected)
	}
}

func TestParseEventType(t *testing.T) {
	input := "event: content_block_delta\ndata: {\"delta\":{\"text\":\"hi\"}}\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].EventType != "content_block_delta" {
		t.Errorf("EventType = %q, want %q", events[0].EventType, "content_block_delta")
	}
}

func TestParseEventID(t *testing.T) {
	input := "id: 42\ndata: payload\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].ID != "42" {
		t.Errorf("ID = %q, want %q", events[0].ID, "42")
	}
}

func TestParseDataNoSpace(t *testing.T) {
	// data:value (no space after colon — valid per SSE spec)
	input := "data:nospace\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Data != "nospace" {
		t.Errorf("Data = %q, want %q", events[0].Data, "nospace")
	}
}

func TestParseDoneSentinel(t *testing.T) {
	// OpenAI uses "data: [DONE]" as sentinel — should be passed through
	input := "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2", len(events))
	}
	if events[1].Data != "[DONE]" {
		t.Errorf("events[1].Data = %q, want %q", events[1].Data, "[DONE]")
	}
}

func TestParseCommentLinesIgnored(t *testing.T) {
	input := ": this is a comment\ndata: actual\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Data != "actual" {
		t.Errorf("Data = %q, want %q", events[0].Data, "actual")
	}
}

func TestParseEmptyStream(t *testing.T) {
	var events []Event

	err := Parse(strings.NewReader(""), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("got %d events, want 0", len(events))
	}
}

func TestParseTrailingEventWithoutBlankLine(t *testing.T) {
	// Event at end without trailing blank line should still be emitted
	input := "data: trailing"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Data != "trailing" {
		t.Errorf("Data = %q, want %q", events[0].Data, "trailing")
	}
}

func TestParseEventOnlyType(t *testing.T) {
	// Event with only event type, no data — should still emit
	input := "event: ping\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].EventType != "ping" {
		t.Errorf("EventType = %q, want %q", events[0].EventType, "ping")
	}
	if events[0].Data != "" {
		t.Errorf("Data = %q, want empty", events[0].Data)
	}
}

func TestParseUTF8Content(t *testing.T) {
	input := "data: 日本語テスト 🔑\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].Data != "日本語テスト 🔑" {
		t.Errorf("Data = %q, want %q", events[0].Data, "日本語テスト 🔑")
	}
}

func TestParseConsecutiveBlankLinesIgnored(t *testing.T) {
	input := "data: first\n\n\n\ndata: second\n\n"
	var events []Event

	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2", len(events))
	}
}

func TestParseFullAnthropicSequence(t *testing.T) {
	// Simulates a realistic Anthropic SSE stream
	input := "event: message_start\ndata: {\"type\":\"message_start\"}\n\n" +
		"event: content_block_start\ndata: {\"type\":\"content_block_start\"}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n" +
		"event: content_block_stop\ndata: {\"type\":\"content_block_stop\"}\n\n" +
		"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n" +
		"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"

	var events []Event
	err := Parse(strings.NewReader(input), func(e Event) {
		events = append(events, e)
	})

	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(events) != 7 {
		t.Fatalf("got %d events, want 7", len(events))
	}

	expectedTypes := []string{
		"message_start", "content_block_start",
		"content_block_delta", "content_block_delta",
		"content_block_stop", "message_delta", "message_stop",
	}
	for i, et := range expectedTypes {
		if events[i].EventType != et {
			t.Errorf("events[%d].EventType = %q, want %q", i, events[i].EventType, et)
		}
	}
}

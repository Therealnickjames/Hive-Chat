package provider

import (
	"testing"
)

func TestConsolidateMessagesNoOp(t *testing.T) {
	// Alternating roles — no consolidation needed
	msgs := []anthropicMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
		{Role: "user", Content: "bye"},
	}

	result := consolidateMessages(msgs)
	if len(result) != 3 {
		t.Fatalf("got %d messages, want 3", len(result))
	}
	if result[0].Content != "hello" {
		t.Errorf("result[0].Content = %q, want %q", result[0].Content, "hello")
	}
}

func TestConsolidateMessagesTwoConsecutiveUser(t *testing.T) {
	msgs := []anthropicMessage{
		{Role: "user", Content: "first"},
		{Role: "user", Content: "second"},
		{Role: "assistant", Content: "response"},
	}

	result := consolidateMessages(msgs)
	if len(result) != 2 {
		t.Fatalf("got %d messages, want 2", len(result))
	}
	expected := "first\n\nsecond"
	if result[0].Content != expected {
		t.Errorf("result[0].Content = %q, want %q", result[0].Content, expected)
	}
	if result[0].Role != "user" {
		t.Errorf("result[0].Role = %q, want %q", result[0].Role, "user")
	}
}

func TestConsolidateMessagesThreeConsecutiveUser(t *testing.T) {
	msgs := []anthropicMessage{
		{Role: "user", Content: "a"},
		{Role: "user", Content: "b"},
		{Role: "user", Content: "c"},
		{Role: "assistant", Content: "response"},
	}

	result := consolidateMessages(msgs)
	if len(result) != 2 {
		t.Fatalf("got %d messages, want 2", len(result))
	}
	expected := "a\n\nb\n\nc"
	if result[0].Content != expected {
		t.Errorf("result[0].Content = %q, want %q", result[0].Content, expected)
	}
}

func TestConsolidateMessagesSingleMessage(t *testing.T) {
	msgs := []anthropicMessage{
		{Role: "user", Content: "only one"},
	}

	result := consolidateMessages(msgs)
	if len(result) != 1 {
		t.Fatalf("got %d messages, want 1", len(result))
	}
	if result[0].Content != "only one" {
		t.Errorf("result[0].Content = %q, want %q", result[0].Content, "only one")
	}
}

func TestConsolidateMessagesEmpty(t *testing.T) {
	result := consolidateMessages([]anthropicMessage{})
	if len(result) != 0 {
		t.Fatalf("got %d messages, want 0", len(result))
	}
}

func TestConsolidateMessagesAssistantFirst(t *testing.T) {
	// First message is assistant — should prepend a synthetic user message
	msgs := []anthropicMessage{
		{Role: "assistant", Content: "I was responding"},
		{Role: "user", Content: "follow up"},
	}

	result := consolidateMessages(msgs)
	if len(result) != 3 {
		t.Fatalf("got %d messages, want 3", len(result))
	}
	if result[0].Role != "user" {
		t.Errorf("result[0].Role = %q, want %q", result[0].Role, "user")
	}
	if result[0].Content != "[Previous conversation context follows]" {
		t.Errorf("result[0].Content = %q, want synthetic user message", result[0].Content)
	}
	if result[1].Role != "assistant" {
		t.Errorf("result[1].Role = %q, want %q", result[1].Role, "assistant")
	}
}

func TestConsolidateMessagesConsecutiveAssistant(t *testing.T) {
	msgs := []anthropicMessage{
		{Role: "user", Content: "question"},
		{Role: "assistant", Content: "answer1"},
		{Role: "assistant", Content: "answer2"},
	}

	result := consolidateMessages(msgs)
	if len(result) != 2 {
		t.Fatalf("got %d messages, want 2", len(result))
	}
	expected := "answer1\n\nanswer2"
	if result[1].Content != expected {
		t.Errorf("result[1].Content = %q, want %q", result[1].Content, expected)
	}
}

func TestConsolidateMessagesDoesNotMutateOriginal(t *testing.T) {
	msgs := []anthropicMessage{
		{Role: "user", Content: "first"},
		{Role: "user", Content: "second"},
	}

	original0 := msgs[0].Content
	original1 := msgs[1].Content

	consolidateMessages(msgs)

	if msgs[0].Content != original0 {
		t.Errorf("original msgs[0] mutated: %q, want %q", msgs[0].Content, original0)
	}
	if msgs[1].Content != original1 {
		t.Errorf("original msgs[1] mutated: %q, want %q", msgs[1].Content, original1)
	}
}

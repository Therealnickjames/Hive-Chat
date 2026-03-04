package tools

import (
	"context"
	"strings"
	"testing"
)

// ---- Registry tests ----

func TestRegistryRegisterAndList(t *testing.T) {
	r := NewRegistry()
	r.Register(NewCurrentTime())

	defs := r.List(nil)
	if len(defs) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(defs))
	}
	if defs[0].Name != "current_time" {
		t.Fatalf("expected tool name 'current_time', got %q", defs[0].Name)
	}
}

func TestRegistryListWithFilter(t *testing.T) {
	r := NewRegistry()
	r.Register(NewCurrentTime())
	r.Register(NewWebSearch(WebSearchConfig{}))

	// Filter to only current_time
	defs := r.List([]string{"current_time"})
	if len(defs) != 1 {
		t.Fatalf("expected 1 filtered tool, got %d", len(defs))
	}
	if defs[0].Name != "current_time" {
		t.Fatalf("expected 'current_time', got %q", defs[0].Name)
	}

	// Filter to non-existent tool
	defs = r.List([]string{"nonexistent"})
	if len(defs) != 0 {
		t.Fatalf("expected 0 tools for nonexistent filter, got %d", len(defs))
	}
}

func TestRegistryCallUnknownTool(t *testing.T) {
	r := NewRegistry()

	result := r.Call(context.Background(), ToolCallRequest{
		ID:   "call_1",
		Name: "nonexistent",
	})

	if !result.IsError {
		t.Fatal("expected error for unknown tool")
	}
	if result.CallID != "call_1" {
		t.Fatalf("expected callId 'call_1', got %q", result.CallID)
	}
	if !strings.Contains(result.Content, "not found") {
		t.Fatalf("expected 'not found' in error, got %q", result.Content)
	}
}

func TestRegistryDuplicateRegistrationPanics(t *testing.T) {
	r := NewRegistry()
	r.Register(NewCurrentTime())

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate registration")
		}
	}()

	r.Register(NewCurrentTime()) // should panic
}

func TestRegistryHasToolsAndCount(t *testing.T) {
	r := NewRegistry()
	if r.HasTools() {
		t.Fatal("empty registry should not have tools")
	}
	if r.Count() != 0 {
		t.Fatalf("expected count 0, got %d", r.Count())
	}

	r.Register(NewCurrentTime())
	if !r.HasTools() {
		t.Fatal("registry should have tools after registration")
	}
	if r.Count() != 1 {
		t.Fatalf("expected count 1, got %d", r.Count())
	}
}

// ---- CurrentTime tests ----

func TestCurrentTimeExecute(t *testing.T) {
	tool := NewCurrentTime()

	result, err := tool.Execute(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(result, "Current time:") {
		t.Fatalf("expected 'Current time:' in result, got %q", result)
	}
	if !strings.Contains(result, "Date:") {
		t.Fatalf("expected 'Date:' in result, got %q", result)
	}
	if !strings.Contains(result, "Day:") {
		t.Fatalf("expected 'Day:' in result, got %q", result)
	}
	if !strings.Contains(result, "Unix timestamp:") {
		t.Fatalf("expected 'Unix timestamp:' in result, got %q", result)
	}
}

func TestCurrentTimeDefinition(t *testing.T) {
	tool := NewCurrentTime()
	def := tool.Definition()

	if def.Name != "current_time" {
		t.Fatalf("expected name 'current_time', got %q", def.Name)
	}
	if def.Description == "" {
		t.Fatal("expected non-empty description")
	}
	if def.InputSchema == nil {
		t.Fatal("expected non-nil input schema")
	}
}

// ---- WebSearch tests ----

func TestWebSearchDisabled(t *testing.T) {
	tool := NewWebSearch(WebSearchConfig{}) // No API configured

	result, err := tool.Execute(context.Background(), map[string]interface{}{
		"query": "test query",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(result, "not configured") {
		t.Fatalf("expected 'not configured' message, got %q", result)
	}
	if !strings.Contains(result, "test query") {
		t.Fatalf("expected query in result, got %q", result)
	}
}

func TestWebSearchMissingQuery(t *testing.T) {
	tool := NewWebSearch(WebSearchConfig{})

	_, err := tool.Execute(context.Background(), map[string]interface{}{})
	if err == nil {
		t.Fatal("expected error for missing query")
	}
	if !strings.Contains(err.Error(), "query") {
		t.Fatalf("expected 'query' in error, got %q", err.Error())
	}
}

func TestWebSearchDefinition(t *testing.T) {
	tool := NewWebSearch(WebSearchConfig{})
	def := tool.Definition()

	if def.Name != "web_search" {
		t.Fatalf("expected name 'web_search', got %q", def.Name)
	}
	if def.Description == "" {
		t.Fatal("expected non-empty description")
	}

	// Verify schema has required properties
	props, ok := def.InputSchema["properties"].(map[string]interface{})
	if !ok {
		t.Fatal("expected properties in schema")
	}
	if _, ok := props["query"]; !ok {
		t.Fatal("expected 'query' in properties")
	}

	required, ok := def.InputSchema["required"].([]string)
	if !ok {
		t.Fatal("expected required array in schema")
	}
	found := false
	for _, r := range required {
		if r == "query" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected 'query' in required")
	}
}

// ---- Format converter tests ----

func TestToAnthropicToolsEmpty(t *testing.T) {
	result := ToAnthropicTools(nil)
	if result != nil {
		t.Fatalf("expected nil for empty input, got %v", result)
	}
}

func TestToAnthropicTools(t *testing.T) {
	defs := []ToolDefinition{{
		Name:        "test_tool",
		Description: "A test tool",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	}}

	result := ToAnthropicTools(defs)
	if len(result) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(result))
	}
	if result[0]["name"] != "test_tool" {
		t.Fatalf("expected name 'test_tool', got %v", result[0]["name"])
	}
	if result[0]["description"] != "A test tool" {
		t.Fatalf("expected description 'A test tool', got %v", result[0]["description"])
	}
	if result[0]["input_schema"] == nil {
		t.Fatal("expected non-nil input_schema")
	}
}

func TestToOpenAIToolsEmpty(t *testing.T) {
	result := ToOpenAITools(nil)
	if result != nil {
		t.Fatalf("expected nil for empty input, got %v", result)
	}
}

func TestToOpenAITools(t *testing.T) {
	defs := []ToolDefinition{{
		Name:        "test_tool",
		Description: "A test tool",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	}}

	result := ToOpenAITools(defs)
	if len(result) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(result))
	}
	if result[0]["type"] != "function" {
		t.Fatalf("expected type 'function', got %v", result[0]["type"])
	}

	fn, ok := result[0]["function"].(map[string]interface{})
	if !ok {
		t.Fatal("expected function object")
	}
	if fn["name"] != "test_tool" {
		t.Fatalf("expected name 'test_tool', got %v", fn["name"])
	}
	if fn["parameters"] == nil {
		t.Fatal("expected non-nil parameters")
	}
}

// ---- Integration: Registry + Call ----

func TestRegistryCallCurrentTime(t *testing.T) {
	r := NewRegistry()
	r.Register(NewCurrentTime())

	result := r.Call(context.Background(), ToolCallRequest{
		ID:        "call_123",
		Name:      "current_time",
		Arguments: nil,
	})

	if result.IsError {
		t.Fatalf("unexpected error: %s", result.Content)
	}
	if result.CallID != "call_123" {
		t.Fatalf("expected callId 'call_123', got %q", result.CallID)
	}
	if result.Name != "current_time" {
		t.Fatalf("expected name 'current_time', got %q", result.Name)
	}
	if !strings.Contains(result.Content, "Current time:") {
		t.Fatalf("expected time in content, got %q", result.Content)
	}
}

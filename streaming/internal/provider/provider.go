// Package provider defines the interface for LLM API providers.
//
// All providers normalize their responses into a common token stream.
// The Gateway and client never need to know which provider generated the tokens.
// See docs/STREAMING.md "Provider Normalization" section.
package provider

import (
	"context"
)

// StreamMessage represents a single message in the conversation context.
type StreamMessage struct {
	Role    string `json:"role"`    // "user", "assistant", or "system"
	Content string `json:"content"`
}

// StreamRequest contains everything needed to start an LLM stream.
type StreamRequest struct {
	BotID           string            `json:"botId"`
	Model           string            `json:"model"`
	APIEndpoint     string            `json:"apiEndpoint"`
	APIKey          string            `json:"apiKey"`
	SystemPrompt    string            `json:"systemPrompt"`
	Temperature     float64           `json:"temperature"`
	MaxTokens       int               `json:"maxTokens"`
	ContextMessages []StreamMessage   `json:"contextMessages"`
	Headers         map[string]string `json:"headers,omitempty"` // TASK-0013: provider-specific headers (e.g., OpenRouter HTTP-Referer)
	Tools           []ToolDefinition  `json:"tools,omitempty"`   // TASK-0018: MCP-compatible tools available to the model
}

// ToolDefinition describes a tool's interface using JSON Schema.
// Duplicated from the tools package to avoid circular imports.
// The tools package owns the canonical type; this mirrors it for provider use.
type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// ToolCall represents an LLM's request to invoke a tool during streaming.
type ToolCall struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// Token represents a single token received from the LLM.
type Token struct {
	Text  string `json:"text"`
	Index int    `json:"index"`
}

// StreamResult indicates how a stream ended.
type StreamResult struct {
	FinalContent string     `json:"finalContent"`
	TokenCount   int        `json:"tokenCount"`
	DurationMs   int64      `json:"durationMs"`
	Error        error      `json:"error,omitempty"`
	ToolCalls    []ToolCall `json:"toolCalls,omitempty"` // TASK-0018: tool calls requested by the model
	StopReason   string     `json:"stopReason,omitempty"` // TASK-0018: "end_turn", "tool_use", "stop", "max_tokens", etc.
}

// ToolResultMessage is appended to context for tool result turns.
// Used by the manager to build tool_result messages for the next iteration.
type ToolResultMessage struct {
	Role       string       `json:"role"`        // "user" for Anthropic, "tool" for OpenAI
	Content    []ToolResult `json:"content"`      // Tool results
}

// ToolResult is a single tool execution result within a ToolResultMessage.
type ToolResult struct {
	Type      string `json:"type"`                // "tool_result"
	ToolUseID string `json:"tool_use_id"`         // Correlates with ToolCall.ID
	Content   string `json:"content"`             // Result text
	IsError   bool   `json:"is_error,omitempty"`  // Whether the tool returned an error
}

// Provider is the interface all LLM providers must implement.
// Each provider handles the specifics of its SSE format and normalizes
// the output into common Token values.
type Provider interface {
	// Name returns the provider identifier (e.g., "anthropic", "openai")
	Name() string

	// Stream opens an SSE connection to the LLM API and sends tokens
	// through the channel. The channel is closed when the stream ends.
	// The returned StreamResult contains final content and metadata.
	Stream(ctx context.Context, req StreamRequest, tokens chan<- Token) (*StreamResult, error)
}

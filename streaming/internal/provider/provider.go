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
	BotID           string          `json:"botId"`
	Model           string          `json:"model"`
	APIEndpoint     string          `json:"apiEndpoint"`
	APIKey          string          `json:"apiKey"`
	SystemPrompt    string          `json:"systemPrompt"`
	Temperature     float64         `json:"temperature"`
	MaxTokens       int             `json:"maxTokens"`
	ContextMessages []StreamMessage `json:"contextMessages"`
}

// Token represents a single token received from the LLM.
type Token struct {
	Text  string `json:"text"`
	Index int    `json:"index"`
}

// StreamResult indicates how a stream ended.
type StreamResult struct {
	FinalContent string `json:"finalContent"`
	TokenCount   int    `json:"tokenCount"`
	DurationMs   int64  `json:"durationMs"`
	Error        error  `json:"error,omitempty"`
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

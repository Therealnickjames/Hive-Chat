// Package provider — Anthropic (Claude) provider implementation.
//
// Handles SSE streaming from the Anthropic Messages API.
// Parses content_block_delta events to extract tokens.
//
// TODO: Implement in TASK-0004
package provider

import (
	"context"
	"fmt"
)

// Anthropic implements the Provider interface for the Anthropic Claude API.
type Anthropic struct{}

func NewAnthropic() *Anthropic {
	return &Anthropic{}
}

func (a *Anthropic) Name() string {
	return "anthropic"
}

func (a *Anthropic) Stream(ctx context.Context, req StreamRequest, tokens chan<- Token) (*StreamResult, error) {
	// TODO: Implement Anthropic SSE streaming
	// 1. Build request body with messages, system prompt, model
	// 2. POST to /v1/messages with stream=true
	// 3. Parse SSE events: content_block_delta contains the token text
	// 4. Send each token through the channel
	// 5. On message_stop, close and return result
	defer close(tokens)
	return nil, fmt.Errorf("anthropic provider not yet implemented")
}

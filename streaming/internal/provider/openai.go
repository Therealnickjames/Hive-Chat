// Package provider — OpenAI-compatible provider implementation.
//
// Handles SSE streaming from any OpenAI-compatible API:
// - OpenAI (GPT-4, etc.)
// - Ollama (local models)
// - OpenRouter (model aggregator)
// - LiteLLM, vLLM, or any endpoint speaking the OpenAI format
//
// Parses choices[0].delta.content from SSE data events.
//
// TODO: Implement in TASK-0004
package provider

import (
	"context"
	"fmt"
)

// OpenAI implements the Provider interface for OpenAI-compatible APIs.
type OpenAI struct{}

func NewOpenAI() *OpenAI {
	return &OpenAI{}
}

func (o *OpenAI) Name() string {
	return "openai"
}

func (o *OpenAI) Stream(ctx context.Context, req StreamRequest, tokens chan<- Token) (*StreamResult, error) {
	// TODO: Implement OpenAI SSE streaming
	// 1. Build request body with messages, model, stream=true
	// 2. POST to /v1/chat/completions
	// 3. Parse SSE events: data contains JSON with choices[0].delta.content
	// 4. Send each token through the channel
	// 5. On [DONE] event, close and return result
	defer close(tokens)
	return nil, fmt.Errorf("openai provider not yet implemented")
}

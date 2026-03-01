// Package provider — OpenAI-compatible provider implementation.
//
// Handles SSE streaming from any OpenAI-compatible API:
// - OpenAI (GPT-4, etc.)
// - Ollama (local models)
// - OpenRouter (model aggregator)
// - LiteLLM, vLLM, or any endpoint speaking the OpenAI format
//
// Parses choices[0].delta.content from SSE data events.
// Terminates on "data: [DONE]" sentinel.
package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/hivechat/streaming/internal/sse"
)

// OpenAI implements the Provider interface for OpenAI-compatible APIs.
type OpenAI struct {
	client *http.Client // reused across all Stream() calls (ISSUE-005)
}

func NewOpenAI() *OpenAI {
	return &OpenAI{
		client: &http.Client{Timeout: 5 * time.Minute},
	}
}

func (o *OpenAI) Name() string {
	return "openai"
}

// openaiRequest is the POST body for /v1/chat/completions
type openaiRequest struct {
	Model       string          `json:"model"`
	Messages    []openaiMessage `json:"messages"`
	Stream      bool            `json:"stream"`
	Temperature float64         `json:"temperature,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
}

type openaiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// openaiChunk is the SSE data shape for streaming responses
type openaiChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

func (o *OpenAI) Stream(ctx context.Context, req StreamRequest, tokens chan<- Token) (*StreamResult, error) {
	defer close(tokens)

	startTime := time.Now()

	// Build messages list: system prompt + context messages
	messages := make([]openaiMessage, 0, len(req.ContextMessages)+1)
	if req.SystemPrompt != "" {
		messages = append(messages, openaiMessage{Role: "system", Content: req.SystemPrompt})
	}
	for _, m := range req.ContextMessages {
		messages = append(messages, openaiMessage{Role: m.Role, Content: m.Content})
	}

	// Build request body
	body := openaiRequest{
		Model:       req.Model,
		Messages:    messages,
		Stream:      true,
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// Build endpoint URL — append /v1/chat/completions if not already present
	endpoint := strings.TrimRight(req.APIEndpoint, "/")
	if !strings.HasSuffix(endpoint, "/v1/chat/completions") {
		endpoint += "/v1/chat/completions"
	}

	// Create HTTP request
	httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if req.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	}

	// Send request (reuse shared HTTP client — ISSUE-005)
	resp, err := o.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("provider returned %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse SSE stream
	var finalContent strings.Builder
	tokenIndex := 0

	err = sse.Parse(resp.Body, func(event sse.Event) {
		// OpenAI uses "data: [DONE]" to signal end
		if strings.TrimSpace(event.Data) == "[DONE]" {
			return
		}

		// Parse the JSON chunk
		var chunk openaiChunk
		if err := json.Unmarshal([]byte(event.Data), &chunk); err != nil {
			slog.Warn("Failed to parse OpenAI chunk", "error", err, "data", event.Data)
			return
		}

		// Extract token text from choices[0].delta.content
		if len(chunk.Choices) > 0 {
			content := chunk.Choices[0].Delta.Content
			if content != "" {
				finalContent.WriteString(content)
				// Context-aware channel send — prevents goroutine leak if manager
				// stops reading (timeout, cancel). (ISSUE-005)
				select {
				case tokens <- Token{
					Text:  content,
					Index: tokenIndex,
				}:
					tokenIndex++
				case <-ctx.Done():
					return
				}
			}
		}
	})

	if err != nil {
		return &StreamResult{
			FinalContent: finalContent.String(),
			TokenCount:   tokenIndex,
			DurationMs:   time.Since(startTime).Milliseconds(),
			Error:        fmt.Errorf("sse parse error: %w", err),
		}, err
	}

	return &StreamResult{
		FinalContent: finalContent.String(),
		TokenCount:   tokenIndex,
		DurationMs:   time.Since(startTime).Milliseconds(),
	}, nil
}

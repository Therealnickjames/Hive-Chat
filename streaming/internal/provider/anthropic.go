// Package provider — Anthropic (Claude) provider implementation.
//
// Handles SSE streaming from the Anthropic Messages API.
// Parses content_block_delta events to extract tokens.
// Uses x-api-key header (not Bearer token) and anthropic-version header.
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

// Anthropic implements the Provider interface for the Anthropic Claude API.
type Anthropic struct{}

func NewAnthropic() *Anthropic {
	return &Anthropic{}
}

func (a *Anthropic) Name() string {
	return "anthropic"
}

// anthropicRequest is the POST body for /v1/messages
type anthropicRequest struct {
	Model       string             `json:"model"`
	MaxTokens   int                `json:"max_tokens"`
	System      string             `json:"system,omitempty"`
	Messages    []anthropicMessage `json:"messages"`
	Stream      bool               `json:"stream"`
	Temperature float64            `json:"temperature,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// anthropicDelta is the content_block_delta event payload
type anthropicDelta struct {
	Type  string `json:"type"`
	Delta struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"delta"`
}

func (a *Anthropic) Stream(ctx context.Context, req StreamRequest, tokens chan<- Token) (*StreamResult, error) {
	defer close(tokens)

	startTime := time.Now()

	// Build messages (Anthropic doesn't put system in messages, it's a separate field)
	messages := make([]anthropicMessage, 0, len(req.ContextMessages))
	for _, m := range req.ContextMessages {
		messages = append(messages, anthropicMessage{Role: m.Role, Content: m.Content})
	}

	// Default max tokens
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}

	// Build request body
	body := anthropicRequest{
		Model:       req.Model,
		MaxTokens:   maxTokens,
		System:      req.SystemPrompt,
		Messages:    messages,
		Stream:      true,
		Temperature: req.Temperature,
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// Build endpoint URL — append /v1/messages if not already present
	endpoint := strings.TrimRight(req.APIEndpoint, "/")
	if !strings.HasSuffix(endpoint, "/v1/messages") {
		endpoint += "/v1/messages"
	}

	// Create HTTP request
	httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("x-api-key", req.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	// Send request
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(httpReq)
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
		switch event.EventType {
		case "content_block_delta":
			var delta anthropicDelta
			if err := json.Unmarshal([]byte(event.Data), &delta); err != nil {
				slog.Warn("Failed to parse Anthropic delta", "error", err, "data", event.Data)
				return
			}

			text := delta.Delta.Text
			if text != "" {
				finalContent.WriteString(text)
				tokens <- Token{
					Text:  text,
					Index: tokenIndex,
				}
				tokenIndex++
			}

		case "message_stop":
			// Stream is done
			return

		case "message_start", "content_block_start", "content_block_stop", "ping":
			// Expected events, no action needed
			return

		case "error":
			slog.Error("Anthropic stream error event", "data", event.Data)
			return

		default:
			// Unknown event type — log but don't crash
			slog.Debug("Unknown Anthropic SSE event", "event", event.EventType)
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

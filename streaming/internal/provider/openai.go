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
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/TavokAI/Tavok/streaming/internal/sse"
)

// OpenAI implements the Provider interface for OpenAI-compatible APIs.
type OpenAI struct {
	transport Transport // TASK-0013: pluggable transport layer
}

func NewOpenAI() *OpenAI {
	return &OpenAI{
		transport: NewHTTPSSETransport(), // Default: HTTP SSE (DEC-0034)
	}
}

// NewOpenAIWithTransport creates an OpenAI provider with a custom transport.
// Useful for testing or future transport strategies (WebSocket, gRPC).
func NewOpenAIWithTransport(t Transport) *OpenAI {
	return &OpenAI{transport: t}
}

func (o *OpenAI) Name() string {
	return "openai"
}

// openaiRequest is the POST body for /v1/chat/completions
type openaiRequest struct {
	Model       string                   `json:"model"`
	Messages    []openaiMessage          `json:"messages"`
	Stream      bool                     `json:"stream"`
	Temperature float64                  `json:"temperature,omitempty"`
	MaxTokens   int                      `json:"max_tokens,omitempty"`
	Tools       []map[string]interface{} `json:"tools,omitempty"` // TASK-0018: tool definitions
}

type openaiMessage struct {
	Role       string                `json:"role"`
	Content    string                `json:"content,omitempty"`
	ToolCalls  []openaiToolCallMsg   `json:"tool_calls,omitempty"`  // for assistant messages with tool calls
	ToolCallID string                `json:"tool_call_id,omitempty"` // for tool result messages
}

// openaiToolCallMsg is an assistant's tool call in messages (for context replay)
type openaiToolCallMsg struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// openaiChunk is the SSE data shape for streaming responses
type openaiChunk struct {
	Choices []struct {
		Delta struct {
			Content   string              `json:"content"`
			ToolCalls []openaiToolCallDelta `json:"tool_calls,omitempty"` // TASK-0018
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// openaiToolCallDelta is the incremental tool call data in streaming
type openaiToolCallDelta struct {
	Index    int `json:"index"`
	ID       string `json:"id,omitempty"` // Only set on first delta for this call
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"` // Incremental JSON string
	} `json:"function"`
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

	// TASK-0018: Include tool definitions if provided
	if len(req.Tools) > 0 {
		openaiTools := make([]map[string]interface{}, len(req.Tools))
		for i, t := range req.Tools {
			openaiTools[i] = map[string]interface{}{
				"type": "function",
				"function": map[string]interface{}{
					"name":        t.Name,
					"description": t.Description,
					"parameters":  t.InputSchema,
				},
			}
		}
		body.Tools = openaiTools
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

	// TASK-0013: Apply provider-specific custom headers (e.g., OpenRouter HTTP-Referer, X-Title)
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	// Open SSE stream via transport layer (TASK-0013)
	sseBody, err := o.transport.OpenStream(ctx, httpReq)
	if err != nil {
		return nil, err
	}
	defer sseBody.Close()

	// Parse SSE stream
	var finalContent strings.Builder
	tokenIndex := 0
	var finishReason string

	// TASK-0018: Tool call tracking
	// OpenAI streams tool calls incrementally via choices[0].delta.tool_calls
	type activeToolCall struct {
		ID       string
		Name     string
		ArgsJSON strings.Builder
	}
	activeToolCalls := make(map[int]*activeToolCall) // delta index → tool data
	var completedToolCalls []ToolCall

	err = sse.Parse(sseBody, func(event sse.Event) {
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

		if len(chunk.Choices) == 0 {
			return
		}

		choice := chunk.Choices[0]

		// Capture finish_reason
		if choice.FinishReason != nil {
			finishReason = *choice.FinishReason
		}

		// Extract token text from choices[0].delta.content
		content := choice.Delta.Content
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

		// TASK-0018: Handle tool call deltas
		for _, tc := range choice.Delta.ToolCalls {
			if _, ok := activeToolCalls[tc.Index]; !ok {
				activeToolCalls[tc.Index] = &activeToolCall{
					ID:   tc.ID,
					Name: tc.Function.Name,
				}
			}
			active := activeToolCalls[tc.Index]
			if tc.ID != "" {
				active.ID = tc.ID
			}
			if tc.Function.Name != "" {
				active.Name = tc.Function.Name
			}
			active.ArgsJSON.WriteString(tc.Function.Arguments)
		}
	})

	// Finalize any accumulated tool calls
	for _, tc := range activeToolCalls {
		var args map[string]interface{}
		argsStr := tc.ArgsJSON.String()
		if argsStr != "" {
			if err := json.Unmarshal([]byte(argsStr), &args); err != nil {
				slog.Warn("Failed to parse OpenAI tool arguments",
					"toolId", tc.ID,
					"toolName", tc.Name,
					"argsJSON", argsStr,
					"error", err,
				)
				args = map[string]interface{}{"_raw": argsStr}
			}
		} else {
			args = make(map[string]interface{})
		}

		completedToolCalls = append(completedToolCalls, ToolCall{
			ID:        tc.ID,
			Name:      tc.Name,
			Arguments: args,
		})
	}

	// Map OpenAI finish_reason to normalized stop reason
	stopReason := finishReason
	if finishReason == "tool_calls" {
		stopReason = "tool_use" // Normalize to match our internal convention
	}

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
		ToolCalls:    completedToolCalls,
		StopReason:   stopReason,
	}, nil
}

// BuildOpenAIToolResultMessages creates OpenAI-format messages for tool results.
// Returns an assistant message (with tool_calls) and individual tool result messages.
func BuildOpenAIToolResultMessages(toolCalls []ToolCall, results []ToolResult) []openaiMessage {
	// First: assistant message echoing the tool calls
	assistantToolCalls := make([]openaiToolCallMsg, len(toolCalls))
	for i, tc := range toolCalls {
		argsJSON, _ := json.Marshal(tc.Arguments)
		assistantToolCalls[i] = openaiToolCallMsg{
			ID:   tc.ID,
			Type: "function",
		}
		assistantToolCalls[i].Function.Name = tc.Name
		assistantToolCalls[i].Function.Arguments = string(argsJSON)
	}
	msgs := []openaiMessage{{
		Role:      "assistant",
		ToolCalls: assistantToolCalls,
	}}

	// Then: one "tool" message per result
	for _, r := range results {
		msgs = append(msgs, openaiMessage{
			Role:       "tool",
			ToolCallID: r.ToolUseID,
			Content:    r.Content,
		})
	}

	return msgs
}

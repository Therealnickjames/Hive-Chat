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
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/TavokAI/Tavok/streaming/internal/sse"
)

// Anthropic implements the Provider interface for the Anthropic Claude API.
type Anthropic struct {
	transport Transport // TASK-0013: pluggable transport layer
}

func NewAnthropic() *Anthropic {
	return &Anthropic{
		transport: NewHTTPSSETransport(), // Default: HTTP SSE (DEC-0034)
	}
}

// NewAnthropicWithTransport creates an Anthropic provider with a custom transport.
// Useful for testing or future transport strategies (WebSocket, gRPC).
func NewAnthropicWithTransport(t Transport) *Anthropic {
	return &Anthropic{transport: t}
}

func (a *Anthropic) Name() string {
	return "anthropic"
}

// anthropicRequest is the POST body for /v1/messages
type anthropicRequest struct {
	Model       string                   `json:"model"`
	MaxTokens   int                      `json:"max_tokens"`
	System      string                   `json:"system,omitempty"`
	Messages    []anthropicMessage       `json:"messages"`
	Stream      bool                     `json:"stream"`
	Temperature float64                  `json:"temperature,omitempty"`
	Tools       []map[string]interface{} `json:"tools,omitempty"` // TASK-0018: tool definitions
}

type anthropicMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"` // string or []anthropicContentBlock (for tool_result)
}

// anthropicContentBlock is used for structured content (tool_use, tool_result).
type anthropicContentBlock struct {
	Type      string `json:"type"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Input     interface{} `json:"input,omitempty"`
	Text      string `json:"text,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"` // for tool_result
	Content   string `json:"content,omitempty"`     // for tool_result
	IsError   bool   `json:"is_error,omitempty"`    // for tool_result
}

// anthropicDelta is the content_block_delta event payload
type anthropicDelta struct {
	Type  string `json:"type"`
	Index int    `json:"index"`
	Delta struct {
		Type         string `json:"type"`
		Text         string `json:"text"`
		PartialJSON  string `json:"partial_json,omitempty"` // TASK-0018: input_json_delta
	} `json:"delta"`
}

// anthropicBlockStart is the content_block_start event payload
type anthropicBlockStart struct {
	Type         string `json:"type"`
	Index        int    `json:"index"`
	ContentBlock struct {
		Type  string `json:"type"` // "text" or "tool_use"
		ID    string `json:"id,omitempty"`
		Name  string `json:"name,omitempty"`
		Input interface{} `json:"input,omitempty"`
	} `json:"content_block"`
}

func (a *Anthropic) Stream(ctx context.Context, req StreamRequest, tokens chan<- Token) (*StreamResult, error) {
	defer close(tokens)

	startTime := time.Now()

	// Build messages (Anthropic doesn't put system in messages, it's a separate field)
	// Consolidate consecutive same-role messages — Anthropic requires strictly
	// alternating user/assistant turns. In chat history, consecutive user messages
	// can appear when a previous bot response was empty or multiple users posted
	// in sequence. Sending non-alternating roles causes the model to intermittently
	// return empty responses (stopReason: "end_turn", zero content blocks). (ISSUE-027)
	rawMessages := make([]anthropicMessage, 0, len(req.ContextMessages))
	for _, m := range req.ContextMessages {
		rawMessages = append(rawMessages, anthropicMessage{Role: m.Role, Content: m.Content})
	}

	messages := consolidateMessages(rawMessages)

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

	// TASK-0018: Include tool definitions if provided
	if len(req.Tools) > 0 {
		anthropicTools := make([]map[string]interface{}, len(req.Tools))
		for i, t := range req.Tools {
			anthropicTools[i] = map[string]interface{}{
				"name":         t.Name,
				"description":  t.Description,
				"input_schema": t.InputSchema,
			}
		}
		body.Tools = anthropicTools
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

	// TASK-0013: Apply provider-specific custom headers
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}

	// Open SSE stream via transport layer (TASK-0013)
	respBody, err := a.transport.OpenStream(ctx, httpReq)
	if err != nil {
		return nil, err
	}
	defer respBody.Close()

	// Parse SSE stream
	var finalContent strings.Builder
	tokenIndex := 0
	var streamErr error // capture error events from SSE stream (ISSUE-002)

	// Counters for empty response detection (ISSUE-027)
	eventCounts := make(map[string]int)
	emptyTextDeltas := 0
	var stopReason string

	// TASK-0018: Tool call tracking
	// Track active tool_use blocks by content block index
	type activeToolUse struct {
		ID        string
		Name      string
		ArgsJSON  strings.Builder // accumulates input_json_delta partial_json chunks
	}
	activeTools := make(map[int]*activeToolUse)     // blockIndex → tool data
	var completedToolCalls []ToolCall                 // finalized tool calls

	err = sse.Parse(respBody, func(event sse.Event) {
		eventCounts[event.EventType]++

		switch event.EventType {
		case "content_block_start":
			// TASK-0018: Detect tool_use content blocks
			var blockStart anthropicBlockStart
			if err := json.Unmarshal([]byte(event.Data), &blockStart); err != nil {
				slog.Warn("Failed to parse content_block_start", "error", err, "data", event.Data)
				return
			}

			if blockStart.ContentBlock.Type == "tool_use" {
				activeTools[blockStart.Index] = &activeToolUse{
					ID:   blockStart.ContentBlock.ID,
					Name: blockStart.ContentBlock.Name,
				}
				slog.Info("Anthropic tool_use block started",
					"blockIndex", blockStart.Index,
					"toolId", blockStart.ContentBlock.ID,
					"toolName", blockStart.ContentBlock.Name,
				)
			}
			// text blocks: no action needed on start

		case "content_block_delta":
			var delta anthropicDelta
			if err := json.Unmarshal([]byte(event.Data), &delta); err != nil {
				slog.Warn("Failed to parse Anthropic delta", "error", err, "data", event.Data)
				return
			}

			// TASK-0018: Handle input_json_delta for tool argument streaming
			if delta.Delta.Type == "input_json_delta" {
				if tool, ok := activeTools[delta.Index]; ok {
					tool.ArgsJSON.WriteString(delta.Delta.PartialJSON)
				}
				return
			}

			// Regular text_delta handling
			text := delta.Delta.Text
			if text == "" {
				emptyTextDeltas++
				if emptyTextDeltas == 1 {
					slog.Warn("Anthropic content_block_delta with empty text",
						"deltaType", delta.Delta.Type,
						"outerType", delta.Type,
						"rawData", event.Data,
					)
				}
				return
			}

			finalContent.WriteString(text)
			// Context-aware channel send — prevents goroutine leak if manager
			// stops reading (timeout, cancel). (ISSUE-005)
			select {
			case tokens <- Token{
				Text:  text,
				Index: tokenIndex,
			}:
				tokenIndex++
			case <-ctx.Done():
				return
			}

		case "content_block_stop":
			// TASK-0018: Finalize tool_use blocks when their content_block_stop fires
			var blockStop struct {
				Type  string `json:"type"`
				Index int    `json:"index"`
			}
			if err := json.Unmarshal([]byte(event.Data), &blockStop); err != nil {
				return
			}

			if tool, ok := activeTools[blockStop.Index]; ok {
				// Parse accumulated JSON arguments
				var args map[string]interface{}
				argsStr := tool.ArgsJSON.String()
				if argsStr != "" {
					if err := json.Unmarshal([]byte(argsStr), &args); err != nil {
						slog.Warn("Failed to parse tool arguments",
							"toolId", tool.ID,
							"toolName", tool.Name,
							"argsJSON", argsStr,
							"error", err,
						)
						args = map[string]interface{}{"_raw": argsStr}
					}
				} else {
					args = make(map[string]interface{})
				}

				completedToolCalls = append(completedToolCalls, ToolCall{
					ID:        tool.ID,
					Name:      tool.Name,
					Arguments: args,
				})

				slog.Info("Anthropic tool_use block completed",
					"toolId", tool.ID,
					"toolName", tool.Name,
				)
				delete(activeTools, blockStop.Index)
			}

		case "message_stop":
			// Stream is done
			return

		case "message_delta":
			// Capture stop_reason for diagnostics and tool detection
			var md struct {
				Delta struct {
					StopReason string `json:"stop_reason"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(event.Data), &md); err == nil {
				stopReason = md.Delta.StopReason
			}
			return

		case "message_start", "ping":
			// Expected events, no action needed
			return

		case "error":
			// Anthropic sends error events for rate limits, auth failures, and
			// overloaded errors. Capture as a real error so the manager publishes
			// stream_error instead of stream_complete. (ISSUE-002)
			slog.Error("Anthropic stream error event", "data", event.Data)
			streamErr = fmt.Errorf("anthropic error event: %s", event.Data)
			return

		default:
			// Unknown event type — log but don't crash
			slog.Debug("Unknown Anthropic SSE event", "event", event.EventType)
		}
	})

	// Debug-level stream summary (promoted to Warn for empty responses below)
	slog.Debug("Anthropic SSE stream summary",
		"tokenIndex", tokenIndex,
		"emptyTextDeltas", emptyTextDeltas,
		"eventCounts", eventCounts,
		"finalContentLen", finalContent.Len(),
		"stopReason", stopReason,
		"toolCalls", len(completedToolCalls),
	)

	if err != nil {
		return &StreamResult{
			FinalContent: finalContent.String(),
			TokenCount:   tokenIndex,
			DurationMs:   time.Since(startTime).Milliseconds(),
			Error:        fmt.Errorf("sse parse error: %w", err),
		}, err
	}

	// Check for error events captured during parsing (ISSUE-002)
	if streamErr != nil {
		return &StreamResult{
			FinalContent: finalContent.String(),
			TokenCount:   tokenIndex,
			DurationMs:   time.Since(startTime).Milliseconds(),
			Error:        streamErr,
		}, streamErr
	}

	// Detect empty responses — model returned valid SSE stream but no content blocks.
	// This happens intermittently and can cascade if empty content is persisted and
	// included in future context. Log a warning for monitoring. (ISSUE-027)
	// Skip this warning when the model stopped for tool_use (no text is expected). (TASK-0018)
	if tokenIndex == 0 && finalContent.Len() == 0 && stopReason != "tool_use" {
		slog.Warn("Anthropic returned empty response (no content blocks)",
			"stopReason", stopReason,
			"eventCounts", eventCounts,
			"durationMs", time.Since(startTime).Milliseconds(),
		)
	}

	return &StreamResult{
		FinalContent: finalContent.String(),
		TokenCount:   tokenIndex,
		DurationMs:   time.Since(startTime).Milliseconds(),
		ToolCalls:    completedToolCalls,
		StopReason:   stopReason,
	}, nil
}

// consolidateMessages merges consecutive same-role messages into single messages.
// Anthropic's Messages API requires strictly alternating user/assistant turns.
// Consecutive same-role messages can appear in chat history when:
//   - A previous bot response was empty (now persisted as placeholder)
//   - Multiple users posted without bot responses between them
//   - Messages were deleted leaving gaps
//
// Only merges messages with string content — structured content blocks (tool_result)
// are left as-is. (ISSUE-027, TASK-0018)
func consolidateMessages(messages []anthropicMessage) []anthropicMessage {
	if len(messages) == 0 {
		return messages
	}

	consolidated := make([]anthropicMessage, 0, len(messages))
	consolidated = append(consolidated, messages[0])

	for i := 1; i < len(messages); i++ {
		last := &consolidated[len(consolidated)-1]
		// Only merge if both have string content (not structured content blocks)
		lastStr, lastIsStr := last.Content.(string)
		curStr, curIsStr := messages[i].Content.(string)
		if messages[i].Role == last.Role && lastIsStr && curIsStr {
			// Merge: append content with newline separator
			last.Content = lastStr + "\n\n" + curStr
		} else {
			consolidated = append(consolidated, messages[i])
		}
	}

	// Anthropic requires the first message to be from "user" role.
	// If the first message is "assistant", prepend a synthetic user message.
	if len(consolidated) > 0 && consolidated[0].Role == "assistant" {
		consolidated = append([]anthropicMessage{{
			Role:    "user",
			Content: "[Previous conversation context follows]",
		}}, consolidated...)
	}

	if len(consolidated) != len(messages) {
		slog.Info("Consolidated context messages for Anthropic API",
			"original", len(messages),
			"consolidated", len(consolidated),
		)
	}

	return consolidated
}

// BuildAnthropicToolResultMessages creates the Anthropic-format messages
// needed to continue a conversation after tool execution.
// Returns an assistant message (with the tool_use blocks) and a user message
// (with the tool_result blocks).
func BuildAnthropicToolResultMessages(toolCalls []ToolCall, results []ToolResult) (anthropicMessage, anthropicMessage) {
	// Assistant message: reconstruct the tool_use content blocks
	assistantBlocks := make([]anthropicContentBlock, len(toolCalls))
	for i, tc := range toolCalls {
		assistantBlocks[i] = anthropicContentBlock{
			Type:  "tool_use",
			ID:    tc.ID,
			Name:  tc.Name,
			Input: tc.Arguments,
		}
	}

	// User message: tool_result content blocks
	resultBlocks := make([]anthropicContentBlock, len(results))
	for i, r := range results {
		resultBlocks[i] = anthropicContentBlock{
			Type:      "tool_result",
			ToolUseID: r.ToolUseID,
			Content:   r.Content,
			IsError:   r.IsError,
		}
	}

	return anthropicMessage{
			Role:    "assistant",
			Content: assistantBlocks,
		}, anthropicMessage{
			Role:    "user",
			Content: resultBlocks,
		}
}

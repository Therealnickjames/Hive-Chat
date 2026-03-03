// Package stream manages active LLM streaming sessions.
//
// The manager:
// - Listens for stream requests on Redis pub/sub (hive:stream:request)
// - Spawns a goroutine per stream
// - Pushes tokens to Redis (hive:stream:tokens:{channelId}:{messageId})
// - Publishes completion/error to Redis (hive:stream:status:{channelId}:{messageId})
// - Executes tool calls when the LLM requests them (TASK-0018)
//
// See docs/PROTOCOL.md §2 for Redis event contracts.
// See docs/PROTOCOL.md §4 for streaming lifecycle invariants.
package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/TavokAI/Tavok/streaming/internal/config"
	"github.com/TavokAI/Tavok/streaming/internal/gateway"
	"github.com/TavokAI/Tavok/streaming/internal/provider"
	"github.com/TavokAI/Tavok/streaming/internal/tools"
)

// maxToolIterations caps the number of tool call → result → continue cycles
// to prevent infinite loops. (TASK-0018)
const maxToolIterations = 10

// timelineEntry is a thinking timeline phase with timestamp.
type timelineEntry struct {
	Phase     string `json:"phase"`
	Timestamp string `json:"timestamp"`
}

// tokenHistoryEntry records a token batch boundary for stream rewind. (TASK-0021)
// O = content offset (end position in final content), T = relative ms from stream start.
type tokenHistoryEntry struct {
	O int   `json:"o"`
	T int64 `json:"t"`
}

// checkpointEntry records a stream checkpoint for resume. (TASK-0021)
type checkpointEntry struct {
	Index         int    `json:"index"`
	Label         string `json:"label"`
	ContentOffset int    `json:"contentOffset"`
	Timestamp     string `json:"timestamp"`
}

// streamRequest is the JSON payload from Redis hive:stream:request
type streamRequest struct {
	ChannelID       string                   `json:"channelId"`
	MessageID       string                   `json:"messageId"`
	BotID           string                   `json:"botId"`
	TriggerMsgID    string                   `json:"triggerMessageId"`
	ContextMessages []provider.StreamMessage `json:"contextMessages"`
}

// Manager tracks all active streams and coordinates lifecycle.
type Manager struct {
	mu       sync.RWMutex
	active   map[string]struct{} // messageId → active stream
	logger   *slog.Logger
	gwClient *gateway.Client
	loader   *config.Loader
	registry *provider.Registry
	toolRegistry *tools.Registry // TASK-0018: MCP-compatible tool registry
	// maxConcurrentStreams caps active stream workers.
	maxConcurrentStreams int
	semaphore           chan struct{}
}

// NewManager creates a new stream manager.
func NewManager(logger *slog.Logger, gwClient *gateway.Client, loader *config.Loader, registry *provider.Registry, toolRegistry *tools.Registry, maxConcurrentStreams int) *Manager {
	if maxConcurrentStreams <= 0 {
		maxConcurrentStreams = 32
	}

	return &Manager{
		active:               make(map[string]struct{}),
		logger:               logger,
		gwClient:             gwClient,
		loader:               loader,
		registry:             registry,
		toolRegistry:         toolRegistry,
		maxConcurrentStreams: maxConcurrentStreams,
		semaphore:           make(chan struct{}, maxConcurrentStreams),
	}
}

// ActiveCount returns the number of currently active streams.
func (m *Manager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.active)
}

// Start begins listening for stream requests on Redis.
// Blocks until context is cancelled.
func (m *Manager) Start(ctx context.Context) error {
	requests, err := m.gwClient.SubscribeStreamRequests(ctx)
	if err != nil {
		return fmt.Errorf("subscribe to stream requests: %w", err)
	}

	m.logger.Info("Stream manager started — listening for requests")

	for {
		select {
		case <-ctx.Done():
			m.logger.Info("Stream manager stopping", "activeStreams", m.ActiveCount())
			return ctx.Err()

		case rawMsg, ok := <-requests:
			if !ok {
				m.logger.Info("Stream request channel closed")
				return nil
			}

			var req streamRequest
			if err := json.Unmarshal([]byte(rawMsg), &req); err != nil {
				m.logger.Error("Failed to decode stream request", "error", err, "raw", rawMsg)
				continue
			}

			m.logger.Info("Stream request received",
				"channelId", req.ChannelID,
				"messageId", req.MessageID,
				"botId", req.BotID,
			)

			if m.tryAcquireSlot() {
				// Spawn a goroutine for this stream within the concurrency cap.
				go func(req streamRequest) {
					defer m.releaseSlot()
					m.handleStream(ctx, req)
				}(req)
			} else {
				m.logger.Warn("Stream request rejected: concurrency limit reached",
					"channelId", req.ChannelID,
					"messageId", req.MessageID,
					"botId", req.BotID,
					"activeStreams", m.ActiveCount(),
					"maxStreams", m.maxConcurrentStreams,
				)
				m.publishError(ctx, req, "", "Stream concurrency limit reached", 0, time.Now())
			}
		}
	}
}

func (m *Manager) tryAcquireSlot() bool {
	select {
	case m.semaphore <- struct{}{}:
		return true
	default:
		return false
	}
}

func (m *Manager) releaseSlot() {
	select {
	case <-m.semaphore:
	default:
	}
}

// handleStream processes a single stream request.
// Supports tool execution loops: if the LLM returns stop_reason "tool_use",
// the manager executes the tools, feeds results back, and continues streaming.
// Capped at maxToolIterations to prevent infinite loops. (TASK-0018)
func (m *Manager) handleStream(ctx context.Context, req streamRequest) {
	// Register active stream
	m.mu.Lock()
	m.active[req.MessageID] = struct{}{}
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		delete(m.active, req.MessageID)
		m.mu.Unlock()
	}()

	startTime := time.Now()

	// 1. Fetch bot config
	botConfig, err := m.loader.GetBot(req.BotID)
	if err != nil {
		m.logger.Error("Failed to load bot config",
			"botId", req.BotID,
			"error", err,
		)
		m.publishError(ctx, req, "", "Failed to load bot configuration", 0, startTime)
		return
	}

	// Fail fast on missing/demo placeholder API keys to avoid opaque provider 401s.
	apiKey := strings.TrimSpace(botConfig.APIKey)
	if apiKey == "" || strings.Contains(apiKey, "placeholder-key-not-real") {
		m.logger.Warn("Bot API key is missing or placeholder",
			"botId", req.BotID,
			"provider", botConfig.LLMProvider,
		)
		m.publishError(ctx, req, "", "Bot API key is not configured. Update the bot API key in settings.", 0, startTime)
		return
	}

	// 1b. Fetch channel charter config (TASK-0020)
	var charter *config.CharterConfig
	charter, err = m.loader.GetChannelCharter(ctx, req.ChannelID)
	if err != nil {
		m.logger.Warn("Failed to load charter config — proceeding without charter",
			"channelId", req.ChannelID,
			"error", err,
		)
		charter = nil // Non-fatal: charter enforcement is optional
	}

	// 1c. Charter enforcement checks (TASK-0020)
	if charter != nil && charter.IsEnforced() {
		// Check if max turns reached
		if charter.HasReachedMaxTurns() {
			m.logger.Info("Charter max turns reached — rejecting stream",
				"channelId", req.ChannelID,
				"messageId", req.MessageID,
				"currentTurn", charter.CurrentTurn,
				"maxTurns", charter.MaxTurns,
			)
			m.publishError(ctx, req, "", "Charter complete: maximum turns reached", 0, startTime)
			m.publishCharterStatusEvent(ctx, req.ChannelID, charter.CurrentTurn, charter.MaxTurns, "COMPLETED")
			return
		}

		// Check turn order for ordered modes
		if charter.SwarmMode == "ROUND_ROBIN" || charter.SwarmMode == "CODE_REVIEW_SPRINT" {
			if !charter.IsAgentTurn(req.BotID) {
				expected := charter.ExpectedAgent()
				m.logger.Info("Not this agent's turn — rejecting stream",
					"channelId", req.ChannelID,
					"botId", req.BotID,
					"expectedBot", expected,
					"currentTurn", charter.CurrentTurn,
				)
				m.publishError(ctx, req, "",
					fmt.Sprintf("Not your turn: waiting for agent %s (turn %d)", expected, charter.CurrentTurn+1),
					0, startTime,
				)
				return
			}
		}
	}

	// 1d. Inject charter into system prompt (TASK-0020)
	if charter != nil {
		charterInjection := charter.SystemPromptInjection()
		if charterInjection != "" {
			botConfig.SystemPrompt += charterInjection
			m.logger.Info("Charter injected into system prompt",
				"channelId", req.ChannelID,
				"swarmMode", charter.SwarmMode,
				"currentTurn", charter.CurrentTurn,
			)
		}
	}

	// 2. Get the right provider
	p := m.registry.Get(botConfig.LLMProvider)
	m.logger.Info("Starting stream",
		"messageId", req.MessageID,
		"provider", p.Name(),
		"model", botConfig.LLMModel,
	)

	// Emit configurable thinking phase — bot config loaded, about to call LLM (TASK-0011)
	thinkingPhase0 := botConfig.GetThinkingPhase(0)
	m.publishThinking(ctx, req, thinkingPhase0)

	// Accumulate thinking timeline for post-completion replay (TASK-0011)
	thinkingTimeline := []timelineEntry{
		{Phase: thinkingPhase0, Timestamp: time.Now().UTC().Format(time.RFC3339Nano)},
	}

	// 3. Resolve available tools for this bot (TASK-0018)
	var toolDefs []provider.ToolDefinition
	if m.toolRegistry != nil && m.toolRegistry.HasTools() {
		rawDefs := m.toolRegistry.List(botConfig.EnabledTools)
		for _, d := range rawDefs {
			toolDefs = append(toolDefs, provider.ToolDefinition{
				Name:        d.Name,
				Description: d.Description,
				InputSchema: d.InputSchema,
			})
		}
		m.logger.Info("Tools available for stream",
			"messageId", req.MessageID,
			"toolCount", len(toolDefs),
		)
	}

	// 4. Build initial provider request
	streamReq := provider.StreamRequest{
		BotID:           req.BotID,
		Model:           botConfig.LLMModel,
		APIEndpoint:     botConfig.APIEndpoint,
		APIKey:          botConfig.APIKey,
		SystemPrompt:    botConfig.SystemPrompt,
		Temperature:     botConfig.Temperature,
		MaxTokens:       botConfig.MaxTokens,
		ContextMessages: req.ContextMessages,
		Tools:           toolDefs,
	}

	// Create a context with cancel for the entire stream
	streamCtx, streamCancel := context.WithCancel(ctx)
	defer streamCancel()

	// Accumulated content and token count across all iterations
	var allContent strings.Builder
	totalTokenCount := 0
	firstTokenEverSeen := false

	// Token history + checkpoints for stream rewind (TASK-0021)
	var tokenHistory []tokenHistoryEntry
	var checkpoints []checkpointEntry
	checkpointIndex := 0

	// 5. Tool execution loop (TASK-0018)
	// The loop runs once for simple streams (no tool calls).
	// When the LLM returns stop_reason "tool_use", we execute the tools,
	// append results to context, and call the provider again.
	for iteration := 0; iteration <= maxToolIterations; iteration++ {
		if iteration > 0 {
			m.logger.Info("Tool iteration",
				"messageId", req.MessageID,
				"iteration", iteration,
			)
			// Emit "Using tools" thinking phase for tool iterations
			toolPhase := "Using tools"
			m.publishThinking(ctx, req, toolPhase)
			thinkingTimeline = append(thinkingTimeline, timelineEntry{
				Phase:     toolPhase,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			})

			// Emit checkpoint at tool iteration start (TASK-0021)
			cp := checkpointEntry{
				Index:         checkpointIndex,
				Label:         fmt.Sprintf("Tool iteration %d", iteration),
				ContentOffset: allContent.Len(),
				Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
			}
			checkpoints = append(checkpoints, cp)
			m.publishCheckpoint(ctx, req, cp)
			checkpointIndex++
		}

		// Run one provider iteration
		iterContent, iterTokens, pr, timedOut := m.runProviderIteration(
			streamCtx, ctx, req, streamReq, botConfig,
			&firstTokenEverSeen, &thinkingTimeline, &tokenHistory, startTime,
		)

		if timedOut {
			// Already published error in runProviderIteration
			return
		}

		allContent.WriteString(iterContent)
		totalTokenCount += iterTokens

		if pr.err != nil {
			m.logger.Error("Stream provider error",
				"messageId", req.MessageID,
				"error", pr.err,
				"iteration", iteration,
			)
			m.publishError(ctx, req, allContent.String(), pr.err.Error(), totalTokenCount, startTime)
			return
		}

		// Check if the model wants to use tools
		if pr.result != nil && pr.result.StopReason == "tool_use" && len(pr.result.ToolCalls) > 0 {
			m.logger.Info("LLM requested tool calls",
				"messageId", req.MessageID,
				"toolCount", len(pr.result.ToolCalls),
				"iteration", iteration,
			)

			// Execute tools and get results
			toolResults := m.executeTools(streamCtx, ctx, req, pr.result.ToolCalls)

			// Emit checkpoint after tool execution (TASK-0021)
			cp := checkpointEntry{
				Index:         checkpointIndex,
				Label:         fmt.Sprintf("After tool: %s", pr.result.ToolCalls[0].Name),
				ContentOffset: allContent.Len(),
				Timestamp:     time.Now().UTC().Format(time.RFC3339Nano),
			}
			checkpoints = append(checkpoints, cp)
			m.publishCheckpoint(ctx, req, cp)
			checkpointIndex++

			// Append tool call context for the next iteration.
			// Build assistant tool_use message + user tool_result message
			// as serialized JSON strings in the context.
			streamReq.ContextMessages = m.appendToolContext(
				streamReq.ContextMessages,
				pr.result.ToolCalls,
				toolResults,
				p.Name(),
			)

			// Continue the loop — provider will be called again with tool results
			continue
		}

		// No tool calls — stream is complete
		break
	}

	// 6. Publish completion status
	durationMs := time.Since(startTime).Milliseconds()
	finalContent := allContent.String()

	// Guard against empty responses (ISSUE-027)
	if strings.TrimSpace(finalContent) == "" {
		m.logger.Warn("Stream completed with empty content — using placeholder",
			"messageId", req.MessageID,
			"durationMs", durationMs,
		)
		finalContent = "*[No response generated]*"
	}

	// Serialize thinking timeline, token history, and checkpoints for persistence (TASK-0011, TASK-0021)
	timelineJSON, _ := json.Marshal(thinkingTimeline)
	tokenHistoryJSON, _ := json.Marshal(tokenHistory)
	checkpointsJSON, _ := json.Marshal(checkpoints)

	statusPayload, _ := json.Marshal(map[string]interface{}{
		"messageId":        req.MessageID,
		"status":           "complete",
		"finalContent":     finalContent,
		"error":            nil,
		"tokenCount":       totalTokenCount,
		"durationMs":       durationMs,
		"thinkingTimeline": thinkingTimeline,
		"tokenHistory":     tokenHistory,
		"checkpoints":      checkpoints,
	})

	if err := m.gwClient.PublishStatus(ctx, req.ChannelID, req.MessageID, string(statusPayload)); err != nil {
		m.logger.Error("Failed to publish completion status",
			"messageId", req.MessageID,
			"error", err,
		)
	} else {
		m.logger.Info("Completion status published to Redis",
			"messageId", req.MessageID,
			"channelId", req.ChannelID,
			"status", "complete",
		)
	}

	// 7. Persist final message content with thinking timeline, token history, and checkpoints (with retry — DEC-0018, TASK-0011, TASK-0021)
	if err := m.loader.FinalizeMessageFull(req.MessageID, finalContent, "COMPLETE", string(timelineJSON), string(tokenHistoryJSON), string(checkpointsJSON), m.logger); err != nil {
		m.logger.Error("FinalizeMessage exhausted retries — DB may be ACTIVE, watchdog will recover",
			"messageId", req.MessageID,
			"error", err,
		)
	}

	// 8. Increment charter turn counter and publish status (TASK-0020)
	if charter != nil && charter.IsEnforced() {
		newTurn, completed, turnErr := m.loader.IncrementCharterTurn(ctx, req.ChannelID)
		if turnErr != nil {
			m.logger.Error("Failed to increment charter turn",
				"channelId", req.ChannelID,
				"error", turnErr,
			)
		} else {
			status := "ACTIVE"
			if completed {
				status = "COMPLETED"
			}
			m.publishCharterStatusEvent(ctx, req.ChannelID, newTurn, charter.MaxTurns, status)
			m.logger.Info("Charter turn incremented",
				"channelId", req.ChannelID,
				"newTurn", newTurn,
				"maxTurns", charter.MaxTurns,
				"completed", completed,
			)
		}
	}

	m.logger.Info("Stream completed",
		"messageId", req.MessageID,
		"tokenCount", totalTokenCount,
		"durationMs", durationMs,
	)
}

// runProviderIteration runs a single provider stream iteration,
// consuming tokens and returning the provider result.
// Returns accumulated content, token count, provider result, and whether a timeout occurred.
func (m *Manager) runProviderIteration(
	streamCtx, parentCtx context.Context,
	req streamRequest,
	streamReq provider.StreamRequest,
	botConfig *config.BotConfig,
	firstTokenEverSeen *bool,
	thinkingTimeline *[]timelineEntry,
	tokenHistory *[]tokenHistoryEntry,
	startTime time.Time,
) (string, int, providerResult, bool) {
	tokens := make(chan provider.Token, 100)

	resultCh := make(chan providerResult, 1)
	go func() {
		result, err := m.registry.Get(botConfig.LLMProvider).Stream(streamCtx, streamReq, tokens)
		resultCh <- providerResult{result: result, err: err}
	}()

	// Token batching (DEC-0031)
	var lastContent string
	tokenCount := 0
	tokenTimeout := 30 * time.Second

	const batchMaxTokens = 10
	const batchFlushInterval = 50 * time.Millisecond

	timer := time.NewTimer(tokenTimeout)
	defer timer.Stop()

	var batchBuf strings.Builder
	batchCount := 0
	batchTimer := time.NewTimer(batchFlushInterval)
	defer batchTimer.Stop()

	flushBatch := func() {
		if batchBuf.Len() == 0 {
			return
		}
		tokenPayload, _ := json.Marshal(map[string]interface{}{
			"messageId": req.MessageID,
			"token":     batchBuf.String(),
			"index":     tokenCount - 1,
		})
		if err := m.gwClient.PublishToken(parentCtx, req.ChannelID, req.MessageID, string(tokenPayload)); err != nil {
			m.logger.Error("Failed to publish token batch",
				"messageId", req.MessageID,
				"error", err,
			)
		}
		// Record token boundary for stream rewind (TASK-0021)
		*tokenHistory = append(*tokenHistory, tokenHistoryEntry{
			O: len(lastContent),
			T: time.Since(startTime).Milliseconds(),
		})
		batchBuf.Reset()
		batchCount = 0
	}

	streamDone := false
	for !streamDone {
		select {
		case token, ok := <-tokens:
			if !ok {
				flushBatch()
				streamDone = true
				break
			}

			// Emit "Writing" phase on first token ever (TASK-0011)
			if !*firstTokenEverSeen {
				*firstTokenEverSeen = true
				writingPhase := botConfig.GetThinkingPhase(1)
				m.publishThinking(parentCtx, req, writingPhase)
				*thinkingTimeline = append(*thinkingTimeline, timelineEntry{
					Phase:     writingPhase,
					Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				})
			}

			// Reset per-token timeout
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(tokenTimeout)

			lastContent += token.Text
			tokenCount = token.Index + 1
			batchBuf.WriteString(token.Text)
			batchCount++

			if batchCount >= batchMaxTokens {
				flushBatch()
				if !batchTimer.Stop() {
					select {
					case <-batchTimer.C:
					default:
					}
				}
				batchTimer.Reset(batchFlushInterval)
			}

		case <-batchTimer.C:
			flushBatch()
			batchTimer.Reset(batchFlushInterval)

		case <-timer.C:
			flushBatch()
			m.logger.Warn("Stream timed out — no token received for 30s",
				"messageId", req.MessageID,
			)
			m.publishError(parentCtx, req, lastContent, "Stream timed out: no token received for 30 seconds", tokenCount, startTime)
			return lastContent, tokenCount, providerResult{}, true

		case <-parentCtx.Done():
			flushBatch()
			m.publishError(parentCtx, req, lastContent, "Service shutting down", tokenCount, startTime)
			return lastContent, tokenCount, providerResult{}, true
		}
	}

	pr := <-resultCh
	return lastContent, tokenCount, pr, false
}

// executeTools runs all requested tool calls and publishes events. (TASK-0018)
func (m *Manager) executeTools(
	streamCtx, parentCtx context.Context,
	req streamRequest,
	toolCalls []provider.ToolCall,
) []tools.ToolCallResult {
	results := make([]tools.ToolCallResult, 0, len(toolCalls))

	for _, tc := range toolCalls {
		// Publish tool_call event to frontend
		callPayload, _ := json.Marshal(map[string]interface{}{
			"messageId": req.MessageID,
			"callId":    tc.ID,
			"toolName":  tc.Name,
			"arguments": tc.Arguments,
			"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		})
		if err := m.gwClient.PublishToolCall(parentCtx, req.ChannelID, req.MessageID, string(callPayload)); err != nil {
			m.logger.Error("Failed to publish tool_call event",
				"messageId", req.MessageID,
				"toolName", tc.Name,
				"error", err,
			)
		}

		// Execute the tool
		toolReq := tools.ToolCallRequest{
			ID:        tc.ID,
			Name:      tc.Name,
			Arguments: tc.Arguments,
		}
		result := m.toolRegistry.Call(streamCtx, toolReq)
		results = append(results, result)

		m.logger.Info("Tool executed",
			"messageId", req.MessageID,
			"toolName", tc.Name,
			"callId", tc.ID,
			"isError", result.IsError,
		)

		// Publish tool_result event to frontend
		resultPayload, _ := json.Marshal(map[string]interface{}{
			"messageId": req.MessageID,
			"callId":    tc.ID,
			"toolName":  tc.Name,
			"content":   result.Content,
			"isError":   result.IsError,
			"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		})
		if err := m.gwClient.PublishToolResult(parentCtx, req.ChannelID, req.MessageID, string(resultPayload)); err != nil {
			m.logger.Error("Failed to publish tool_result event",
				"messageId", req.MessageID,
				"toolName", tc.Name,
				"error", err,
			)
		}
	}

	return results
}

// appendToolContext adds tool call and result messages to the conversation context.
// The format depends on the provider:
//   - Anthropic: structured content blocks (tool_use + tool_result)
//   - OpenAI: function call messages + tool result messages
//
// For simplicity, we serialize as JSON strings in StreamMessage format.
// The provider will receive these as part of ContextMessages.
func (m *Manager) appendToolContext(
	messages []provider.StreamMessage,
	toolCalls []provider.ToolCall,
	results []tools.ToolCallResult,
	providerName string,
) []provider.StreamMessage {
	// Build assistant message with tool calls (as JSON)
	toolCallsJSON, _ := json.Marshal(toolCalls)
	messages = append(messages, provider.StreamMessage{
		Role:    "assistant",
		Content: fmt.Sprintf("[Tool calls: %s]", string(toolCallsJSON)),
	})

	// Build tool result messages
	for _, result := range results {
		resultContent := result.Content
		if result.IsError {
			resultContent = fmt.Sprintf("[Tool error: %s]", result.Content)
		}
		messages = append(messages, provider.StreamMessage{
			Role:    "user",
			Content: fmt.Sprintf("[Tool result for %s (call %s)]: %s", result.Name, result.CallID, resultContent),
		})
	}

	return messages
}

// publishError sends an error status and persists the error state.
func (m *Manager) publishError(ctx context.Context, req streamRequest, partialContent, errMsg string, tokenCount int, startTime time.Time) {
	durationMs := time.Since(startTime).Milliseconds()

	statusPayload, _ := json.Marshal(map[string]interface{}{
		"messageId":      req.MessageID,
		"status":         "error",
		"finalContent":   nil,
		"error":          errMsg,
		"partialContent": partialContent,
		"tokenCount":     tokenCount,
		"durationMs":     durationMs,
	})

	if err := m.gwClient.PublishStatus(ctx, req.ChannelID, req.MessageID, string(statusPayload)); err != nil {
		m.logger.Error("Failed to publish error status",
			"messageId", req.MessageID,
			"error", err,
		)
	} else {
		m.logger.Info("Error status published to Redis",
			"messageId", req.MessageID,
			"channelId", req.ChannelID,
			"status", "error",
		)
	}

	// Persist the error state — use partial content if available
	content := partialContent
	if content == "" {
		content = "[Error: " + errMsg + "]"
	}

	if err := m.loader.FinalizeMessageWithRetry(req.MessageID, content, "ERROR", m.logger); err != nil {
		m.logger.Error("FinalizeMessage (error path) exhausted retries — DB may be ACTIVE, watchdog will recover",
			"messageId", req.MessageID,
			"error", err,
		)
	}
}

// publishThinking emits a thinking phase change to Redis.
// Phase labels are configurable via bot's ThinkingSteps (default: ["Thinking","Writing"]).
// The frontend clears the phase on stream_complete/stream_error. (TASK-0011, DEC-0037)
func (m *Manager) publishThinking(ctx context.Context, req streamRequest, phase string) {
	payload, _ := json.Marshal(map[string]interface{}{
		"messageId": req.MessageID,
		"phase":     phase,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err := m.gwClient.PublishThinking(ctx, req.ChannelID, req.MessageID, string(payload)); err != nil {
		m.logger.Error("Failed to publish thinking phase",
			"messageId", req.MessageID,
			"phase", phase,
			"error", err,
		)
	}
}

// publishCheckpoint emits a checkpoint event to Redis for rewind UI. (TASK-0021)
func (m *Manager) publishCheckpoint(ctx context.Context, req streamRequest, cp checkpointEntry) {
	payload, _ := json.Marshal(map[string]interface{}{
		"messageId":     req.MessageID,
		"index":         cp.Index,
		"label":         cp.Label,
		"contentOffset": cp.ContentOffset,
		"timestamp":     cp.Timestamp,
	})
	if err := m.gwClient.PublishCheckpoint(ctx, req.ChannelID, req.MessageID, string(payload)); err != nil {
		m.logger.Error("Failed to publish checkpoint",
			"messageId", req.MessageID,
			"checkpointIndex", cp.Index,
			"error", err,
		)
	}
}

// publishCharterStatusEvent publishes a charter status event to Redis for live UI updates. (TASK-0020)
func (m *Manager) publishCharterStatusEvent(ctx context.Context, channelID string, currentTurn, maxTurns int, status string) {
	payload, _ := json.Marshal(map[string]interface{}{
		"channelId":   channelID,
		"currentTurn": currentTurn,
		"maxTurns":    maxTurns,
		"status":      status,
		"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err := m.gwClient.PublishCharterStatus(ctx, channelID, string(payload)); err != nil {
		m.logger.Error("Failed to publish charter status",
			"channelId", channelID,
			"error", err,
		)
	}
}

// providerResult holds the result from a provider goroutine
type providerResult struct {
	result *provider.StreamResult
	err    error
}

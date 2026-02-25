// Package stream manages active LLM streaming sessions.
//
// The manager:
// - Listens for stream requests on Redis pub/sub (hive:stream:request)
// - Spawns a goroutine per stream
// - Pushes tokens to Redis (hive:stream:tokens:{channelId}:{messageId})
// - Publishes completion/error to Redis (hive:stream:status:{channelId}:{messageId})
//
// See docs/PROTOCOL.md §2 for Redis event contracts.
// See docs/PROTOCOL.md §4 for streaming lifecycle invariants.
package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/hivechat/streaming/internal/config"
	"github.com/hivechat/streaming/internal/gateway"
	"github.com/hivechat/streaming/internal/provider"
)

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
	// maxConcurrentStreams caps active stream workers.
	maxConcurrentStreams int
	semaphore           chan struct{}
}

// NewManager creates a new stream manager.
func NewManager(logger *slog.Logger, gwClient *gateway.Client, loader *config.Loader, registry *provider.Registry, maxConcurrentStreams int) *Manager {
	if maxConcurrentStreams <= 0 {
		maxConcurrentStreams = 32
	}

	return &Manager{
		active:               make(map[string]struct{}),
		logger:               logger,
		gwClient:             gwClient,
		loader:               loader,
		registry:             registry,
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

	// 2. Get the right provider
	p := m.registry.Get(botConfig.LLMProvider)
	m.logger.Info("Starting stream",
		"messageId", req.MessageID,
		"provider", p.Name(),
		"model", botConfig.LLMModel,
	)

	// 3. Build provider request
	streamReq := provider.StreamRequest{
		BotID:           req.BotID,
		Model:           botConfig.LLMModel,
		APIEndpoint:     botConfig.APIEndpoint,
		APIKey:          botConfig.APIKey,
		SystemPrompt:    botConfig.SystemPrompt,
		Temperature:     botConfig.Temperature,
		MaxTokens:       botConfig.MaxTokens,
		ContextMessages: req.ContextMessages,
	}

	// 4. Create token channel and start streaming
	tokens := make(chan provider.Token, 100)

	// Create a context with timeout for the entire stream
	streamCtx, streamCancel := context.WithCancel(ctx)
	defer streamCancel()

	// Start provider in goroutine, collect result
	resultCh := make(chan providerResult, 1)
	go func() {
		result, err := p.Stream(streamCtx, streamReq, tokens)
		resultCh <- providerResult{result: result, err: err}
	}()

	// 5. Read tokens and publish to Redis with per-token timeout
	var lastContent string
	tokenCount := 0
	tokenTimeout := 30 * time.Second

	for {
		select {
		case token, ok := <-tokens:
			if !ok {
				// Token channel closed — stream ended
				goto streamDone
			}

			// Publish token to Redis
			tokenPayload, _ := json.Marshal(map[string]interface{}{
				"messageId": req.MessageID,
				"token":     token.Text,
				"index":     token.Index,
			})

			if err := m.gwClient.PublishToken(ctx, req.ChannelID, req.MessageID, string(tokenPayload)); err != nil {
				m.logger.Error("Failed to publish token",
					"messageId", req.MessageID,
					"error", err,
				)
			}

			lastContent += token.Text
			tokenCount = token.Index + 1

		case <-time.After(tokenTimeout):
			// No token received for 30 seconds — timeout
			m.logger.Warn("Stream timed out — no token received for 30s",
				"messageId", req.MessageID,
			)
			streamCancel()
			m.publishError(ctx, req, lastContent, "Stream timed out: no token received for 30 seconds", tokenCount, startTime)
			return

		case <-ctx.Done():
			m.publishError(ctx, req, lastContent, "Service shutting down", tokenCount, startTime)
			return
		}
	}

streamDone:
	// 6. Wait for provider result
	pr := <-resultCh

	if pr.err != nil {
		m.logger.Error("Stream provider error",
			"messageId", req.MessageID,
			"error", pr.err,
		)
		m.publishError(ctx, req, lastContent, pr.err.Error(), tokenCount, startTime)
		return
	}

	// 7. Publish completion status
	durationMs := time.Since(startTime).Milliseconds()

	// Use provider's final content if available, otherwise our accumulated content
	finalContent := lastContent
	if pr.result != nil && pr.result.FinalContent != "" {
		finalContent = pr.result.FinalContent
	}
	if pr.result != nil && pr.result.TokenCount > 0 {
		tokenCount = pr.result.TokenCount
	}

	statusPayload, _ := json.Marshal(map[string]interface{}{
		"messageId":    req.MessageID,
		"status":       "complete",
		"finalContent": finalContent,
		"error":        nil,
		"tokenCount":   tokenCount,
		"durationMs":   durationMs,
	})

	if err := m.gwClient.PublishStatus(ctx, req.ChannelID, req.MessageID, string(statusPayload)); err != nil {
		m.logger.Error("Failed to publish completion status",
			"messageId", req.MessageID,
			"error", err,
		)
	}

	// 8. Persist final message content
	if err := m.loader.FinalizeMessage(req.MessageID, finalContent, "COMPLETE"); err != nil {
		m.logger.Error("Failed to finalize message",
			"messageId", req.MessageID,
			"error", err,
		)
	}

	m.logger.Info("Stream completed",
		"messageId", req.MessageID,
		"tokenCount", tokenCount,
		"durationMs", durationMs,
	)
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
	}

	// Persist the error state — use partial content if available
	content := partialContent
	if content == "" {
		content = "[Error: " + errMsg + "]"
	}

	if err := m.loader.FinalizeMessage(req.MessageID, content, "ERROR"); err != nil {
		m.logger.Error("Failed to finalize error message",
			"messageId", req.MessageID,
			"error", err,
		)
	}
}

// providerResult holds the result from a provider goroutine
type providerResult struct {
	result *provider.StreamResult
	err    error
}

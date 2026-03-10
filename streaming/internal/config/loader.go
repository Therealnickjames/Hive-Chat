// Package config — Agent configuration loader.
//
// Fetches agent configuration from the Next.js internal API
// and updates message content on stream completion.
package config

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Loader fetches agent configs and updates messages via the Web service internal API.
type Loader struct {
	webURL         string
	internalSecret string
	client         *http.Client
}

// NewLoader creates a new config loader.
func NewLoader(webURL, internalSecret string) *Loader {
	return &Loader{
		webURL:         webURL,
		internalSecret: internalSecret,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// GetAgent fetches full agent configuration including decrypted API key.
// GET /api/internal/agents/{agentId}
// Now accepts context for cancellation support. (ISSUE-014)
func (l *Loader) GetAgent(agentID string) (*AgentConfig, error) {
	return l.GetAgentWithContext(context.Background(), agentID)
}

// GetAgentWithContext fetches agent configuration with context for cancellation.
func (l *Loader) GetAgentWithContext(ctx context.Context, agentID string) (*AgentConfig, error) {
	url := fmt.Sprintf("%s/api/internal/agents/%s", l.webURL, agentID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("x-internal-secret", l.internalSecret)

	resp, err := l.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("web API returned %d: %s", resp.StatusCode, string(body))
	}

	var agent AgentConfig
	if err := json.NewDecoder(resp.Body).Decode(&agent); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &agent, nil
}

// FinalizeMessage updates a streaming message's content and status.
// PUT /api/internal/messages/{messageId}
// Now accepts context for cancellation support. (ISSUE-014)
func (l *Loader) FinalizeMessage(messageID, content, streamingStatus string) error {
	return l.FinalizeMessageWithContext(context.Background(), messageID, content, streamingStatus)
}

// FinalizeMessageWithContext updates a streaming message with context for cancellation.
func (l *Loader) FinalizeMessageWithContext(ctx context.Context, messageID, content, streamingStatus string) error {
	url := fmt.Sprintf("%s/api/internal/messages/%s", l.webURL, messageID)

	body := map[string]string{
		"content":         content,
		"streamingStatus": streamingStatus,
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(bodyJSON))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-secret", l.internalSecret)

	resp, err := l.client.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("web API returned %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// FinalizeMessageWithTimeline updates a streaming message and includes thinking timeline. (TASK-0011)
// PUT /api/internal/messages/{messageId}
func (l *Loader) FinalizeMessageWithTimeline(messageID, content, streamingStatus, thinkingTimeline string, logger *slog.Logger) error {
	return l.FinalizeMessageWithTimelineCtx(context.Background(), messageID, content, streamingStatus, thinkingTimeline, logger)
}

// FinalizeMessageWithTimelineCtx updates a streaming message with thinking timeline and context support.
func (l *Loader) FinalizeMessageWithTimelineCtx(ctx context.Context, messageID, content, streamingStatus, thinkingTimeline string, logger *slog.Logger) error {
	const maxRetries = 3
	backoffs := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}

	if logger == nil {
		logger = slog.Default()
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			wait := backoffs[attempt-1]
			logger.Warn("Retrying FinalizeMessage (with timeline)",
				"messageId", messageID,
				"attempt", attempt,
				"backoff", wait.String(),
				"lastError", lastErr.Error(),
			)
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		lastErr = l.finalizeWithTimeline(ctx, messageID, content, streamingStatus, thinkingTimeline)
		if lastErr == nil {
			if attempt > 0 {
				logger.Info("FinalizeMessage (with timeline) succeeded on retry",
					"messageId", messageID,
					"attempt", attempt,
				)
			}
			return nil
		}
	}

	logger.Error("FinalizeMessage (with timeline) failed after all retries",
		"messageId", messageID,
		"status", streamingStatus,
		"attempts", maxRetries+1,
		"lastError", lastErr.Error(),
	)
	return lastErr
}

func (l *Loader) finalizeWithTimeline(ctx context.Context, messageID, content, streamingStatus, thinkingTimeline string) error {
	return l.finalizeWithFullData(ctx, messageID, content, streamingStatus, thinkingTimeline, "", "")
}

// FinalizeMessageFull updates a streaming message with all metadata including
// token history and checkpoints for stream rewind. (TASK-0021)
func (l *Loader) FinalizeMessageFull(messageID, content, streamingStatus, thinkingTimeline, tokenHistory, checkpoints string, logger *slog.Logger) error {
	return l.FinalizeMessageFullCtx(context.Background(), messageID, content, streamingStatus, thinkingTimeline, tokenHistory, checkpoints, logger)
}

// FinalizeMessageFullCtx is the context-aware version of FinalizeMessageFull with retry logic.
func (l *Loader) FinalizeMessageFullCtx(ctx context.Context, messageID, content, streamingStatus, thinkingTimeline, tokenHistory, checkpoints string, logger *slog.Logger) error {
	const maxRetries = 3
	backoffs := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}

	if logger == nil {
		logger = slog.Default()
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			wait := backoffs[attempt-1]
			logger.Warn("Retrying FinalizeMessage (full)",
				"messageId", messageID,
				"attempt", attempt,
				"backoff", wait.String(),
				"lastError", lastErr.Error(),
			)
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		lastErr = l.finalizeWithFullData(ctx, messageID, content, streamingStatus, thinkingTimeline, tokenHistory, checkpoints)
		if lastErr == nil {
			if attempt > 0 {
				logger.Info("FinalizeMessage (full) succeeded on retry",
					"messageId", messageID,
					"attempt", attempt,
				)
			}
			return nil
		}
	}

	logger.Error("FinalizeMessage (full) failed after all retries",
		"messageId", messageID,
		"status", streamingStatus,
		"attempts", maxRetries+1,
		"lastError", lastErr.Error(),
	)
	return lastErr
}

// finalizeWithFullData sends the finalize PUT with all optional fields. (TASK-0021)
func (l *Loader) finalizeWithFullData(ctx context.Context, messageID, content, streamingStatus, thinkingTimeline, tokenHistory, checkpoints string) error {
	url := fmt.Sprintf("%s/api/internal/messages/%s", l.webURL, messageID)

	body := map[string]string{
		"content":          content,
		"streamingStatus":  streamingStatus,
		"thinkingTimeline": thinkingTimeline,
	}
	if tokenHistory != "" && tokenHistory != "null" {
		body["tokenHistory"] = tokenHistory
	}
	if checkpoints != "" && checkpoints != "null" {
		body["checkpoints"] = checkpoints
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(bodyJSON))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-secret", l.internalSecret)

	resp, err := l.client.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("web API returned %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// FinalizeMessageWithRetry attempts FinalizeMessage up to maxRetries times
// with exponential backoff (1s, 2s, 4s). Uses context-aware sleep to avoid
// blocking during shutdown. (ISSUE-014)
//
// See docs/DECISIONS.md DEC-0018.
func (l *Loader) FinalizeMessageWithRetry(messageID, content, streamingStatus string, logger *slog.Logger) error {
	return l.FinalizeMessageWithRetryCtx(context.Background(), messageID, content, streamingStatus, logger)
}

// FinalizeMessageWithRetryCtx attempts FinalizeMessage with context support.
func (l *Loader) FinalizeMessageWithRetryCtx(ctx context.Context, messageID, content, streamingStatus string, logger *slog.Logger) error {
	const maxRetries = 3
	backoffs := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}

	if logger == nil {
		logger = slog.Default()
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			wait := backoffs[attempt-1]
			logger.Warn("Retrying FinalizeMessage",
				"messageId", messageID,
				"attempt", attempt,
				"backoff", wait.String(),
				"lastError", lastErr.Error(),
			)
			// Context-aware sleep — don't block during shutdown (ISSUE-014)
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		lastErr = l.FinalizeMessageWithContext(ctx, messageID, content, streamingStatus)
		if lastErr == nil {
			if attempt > 0 {
				logger.Info("FinalizeMessage succeeded on retry",
					"messageId", messageID,
					"attempt", attempt,
				)
			}
			return nil
		}
	}

	logger.Error("FinalizeMessage failed after all retries",
		"messageId", messageID,
		"status", streamingStatus,
		"attempts", maxRetries+1,
		"lastError", lastErr.Error(),
	)
	return lastErr
}

// GetChannelCharter fetches channel charter config from the internal API.
// GET /api/internal/channels/{channelId}
// Parses the charter fields from the response. (TASK-0020)
func (l *Loader) GetChannelCharter(ctx context.Context, channelID string) (*CharterConfig, error) {
	url := fmt.Sprintf("%s/api/internal/channels/%s", l.webURL, channelID)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("x-internal-secret", l.internalSecret)

	resp, err := l.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("web API returned %d: %s", resp.StatusCode, string(body))
	}

	var charter CharterConfig
	if err := json.NewDecoder(resp.Body).Decode(&charter); err != nil {
		return nil, fmt.Errorf("decode charter response: %w", err)
	}

	return &charter, nil
}

// ClaimCharterTurn atomically claims a charter turn via PUT.
// PUT /api/internal/channels/{channelId}/charter-turn
// Body: { "agentId": "..." }
// The server verifies turn order, max turns, and charter status inside a
// serializable transaction, then increments the turn counter atomically.
// Returns a non-error result for all application-level responses (200, 409, 404).
// Only returns an error for transport/server failures (5xx, network). (P1-Fix 4)
func (l *Loader) ClaimCharterTurn(ctx context.Context, channelID, agentID string) (*ClaimCharterTurnResult, error) {
	url := fmt.Sprintf("%s/api/internal/channels/%s/charter-turn", l.webURL, channelID)

	body := map[string]string{"agentId": agentID}
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-secret", l.internalSecret)

	resp, err := l.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	// 200 (granted), 409 (rejected), 404 (not found) are all valid application responses
	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusNotFound {
		var result ClaimCharterTurnResult
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}
		return &result, nil
	}

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return nil, fmt.Errorf("web API returned %d: %s", resp.StatusCode, string(respBody))
}

// IncrementCharterTurn increments the charter turn counter via the internal API.
// POST /api/internal/channels/{channelId}/charter-turn
// Returns the new turn count and whether the charter is completed. (TASK-0020)
// Deprecated: Use ClaimCharterTurn for atomic turn claiming at stream start.
func (l *Loader) IncrementCharterTurn(ctx context.Context, channelID string) (currentTurn int, completed bool, err error) {
	url := fmt.Sprintf("%s/api/internal/channels/%s/charter-turn", l.webURL, channelID)

	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return 0, false, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("x-internal-secret", l.internalSecret)

	resp, err := l.client.Do(req)
	if err != nil {
		return 0, false, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return 0, false, fmt.Errorf("web API returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		CurrentTurn int  `json:"currentTurn"`
		MaxTurns    int  `json:"maxTurns"`
		Completed   bool `json:"completed"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, false, fmt.Errorf("decode response: %w", err)
	}

	return result.CurrentTurn, result.Completed, nil
}

// Package config — Bot configuration loader.
//
// Fetches bot configuration from the Next.js internal API
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

// Loader fetches bot configs and updates messages via the Web service internal API.
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

// GetBot fetches full bot configuration including decrypted API key.
// GET /api/internal/bots/{botId}
// Now accepts context for cancellation support. (ISSUE-014)
func (l *Loader) GetBot(botID string) (*BotConfig, error) {
	return l.GetBotWithContext(context.Background(), botID)
}

// GetBotWithContext fetches bot configuration with context for cancellation.
func (l *Loader) GetBotWithContext(ctx context.Context, botID string) (*BotConfig, error) {
	url := fmt.Sprintf("%s/api/internal/bots/%s", l.webURL, botID)

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

	var bot BotConfig
	if err := json.NewDecoder(resp.Body).Decode(&bot); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &bot, nil
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

// Package config — Bot configuration loader.
//
// Fetches bot configuration from the Next.js internal API
// and updates message content on stream completion.
package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
func (l *Loader) GetBot(botID string) (*BotConfig, error) {
	url := fmt.Sprintf("%s/api/internal/bots/%s", l.webURL, botID)

	req, err := http.NewRequest("GET", url, nil)
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
func (l *Loader) FinalizeMessage(messageID, content, streamingStatus string) error {
	url := fmt.Sprintf("%s/api/internal/messages/%s", l.webURL, messageID)

	body := map[string]string{
		"content":         content,
		"streamingStatus": streamingStatus,
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequest("PUT", url, bytes.NewReader(bodyJSON))
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

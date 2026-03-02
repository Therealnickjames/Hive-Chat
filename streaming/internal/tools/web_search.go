package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// WebSearch is a built-in tool that performs web searches.
// Uses a configurable search API endpoint. If no endpoint is configured,
// returns a helpful message explaining the tool is not available.
//
// The tool accepts a query string and optional maxResults parameter.
// This is intentionally simple — a placeholder that demonstrates the
// tool interface pattern. Production deployments should configure a
// real search API (e.g., SerpAPI, Brave Search, Tavily).
type WebSearch struct {
	apiEndpoint string // External search API URL (empty = disabled)
	apiKey      string // Search API key
	client      *http.Client
}

// WebSearchConfig holds configuration for the web search tool.
type WebSearchConfig struct {
	APIEndpoint string // e.g., "https://api.tavily.com/search"
	APIKey      string // API key for the search service
}

func NewWebSearch(cfg WebSearchConfig) *WebSearch {
	return &WebSearch{
		apiEndpoint: cfg.APIEndpoint,
		apiKey:      cfg.APIKey,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (w *WebSearch) Definition() ToolDefinition {
	return ToolDefinition{
		Name:        "web_search",
		Description: "Search the web for current information. Returns relevant search results with titles, URLs, and snippets. Use this when the user asks about current events, recent information, or anything that may have changed since your training data.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"query": map[string]interface{}{
					"type":        "string",
					"description": "The search query",
				},
				"max_results": map[string]interface{}{
					"type":        "integer",
					"description": "Maximum number of results to return (default: 5, max: 10)",
					"default":     5,
				},
			},
			"required": []string{"query"},
		},
	}
}

func (w *WebSearch) Execute(ctx context.Context, args map[string]interface{}) (string, error) {
	query, ok := args["query"].(string)
	if !ok || query == "" {
		return "", fmt.Errorf("missing required argument: query")
	}

	maxResults := 5
	if mr, ok := args["max_results"].(float64); ok && mr > 0 {
		maxResults = int(mr)
		if maxResults > 10 {
			maxResults = 10
		}
	}

	// If no search API is configured, return a helpful message
	if w.apiEndpoint == "" {
		return fmt.Sprintf(
			"Web search is not configured. To enable web search, set STREAMING_SEARCH_API_URL and STREAMING_SEARCH_API_KEY environment variables.\n\nQuery was: %q (max_results: %d)",
			query, maxResults,
		), nil
	}

	// Build search request
	searchURL := fmt.Sprintf("%s?q=%s&max_results=%d",
		w.apiEndpoint,
		url.QueryEscape(query),
		maxResults,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return "", fmt.Errorf("create search request: %w", err)
	}

	if w.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+w.apiKey)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := w.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024)) // 64KB limit
	if err != nil {
		return "", fmt.Errorf("read search response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("search API returned %d: %s", resp.StatusCode, string(body))
	}

	// Try to pretty-format the JSON response
	var prettyJSON interface{}
	if err := json.Unmarshal(body, &prettyJSON); err == nil {
		formatted, err := json.MarshalIndent(prettyJSON, "", "  ")
		if err == nil {
			return string(formatted), nil
		}
	}

	// Fall back to raw response
	return string(body), nil
}

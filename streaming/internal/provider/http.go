// Package provider — shared HTTP client for LLM streaming.
//
// All providers use the same tuned HTTP transport settings (DEC-0034).
// Centralizes configuration to avoid duplication across providers.
package provider

import (
	"net/http"
	"time"
)

// NewStreamingHTTPClient creates an HTTP client tuned for high-concurrency
// LLM streaming. Go's default MaxIdleConnsPerHost=2 causes TCP churn at
// scale — this transport keeps warm connections ready for reuse.
//
// See docs/DECISIONS.md DEC-0034.
func NewStreamingHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 5 * time.Minute,
		Transport: &http.Transport{
			MaxConnsPerHost:     200,
			MaxIdleConns:        200,
			MaxIdleConnsPerHost: 20,
			IdleConnTimeout:     120 * time.Second,
		},
	}
}

// Package provider — Transport abstraction for LLM API connections.
//
// Transport decouples the HTTP connection from the response format parsing.
// Both OpenAI and Anthropic use HTTP POST → SSE response, but this interface
// allows future extension to WebSocket, gRPC, or other transports (TASK-0013).
package provider

import (
	"context"
	"fmt"
	"io"
	"net/http"
)

// Transport is the interface for opening a streaming connection to an LLM API.
// Implementations handle the HTTP mechanics; callers handle format parsing.
type Transport interface {
	// OpenStream sends the HTTP request and returns the response body for SSE parsing.
	// The caller is responsible for closing the returned ReadCloser.
	// Returns an error if the response status is not 200 OK.
	OpenStream(ctx context.Context, req *http.Request) (io.ReadCloser, error)
}

// HTTPSSETransport implements Transport using standard HTTP POST → SSE response.
// This is the default transport used by all providers today.
type HTTPSSETransport struct {
	Client *http.Client
}

// NewHTTPSSETransport creates a transport using the shared streaming HTTP client.
func NewHTTPSSETransport() *HTTPSSETransport {
	return &HTTPSSETransport{
		Client: NewStreamingHTTPClient(),
	}
}

// OpenStream sends the HTTP request and returns the SSE response body.
// Returns an error if the status code is not 200 OK.
func (t *HTTPSSETransport) OpenStream(ctx context.Context, req *http.Request) (io.ReadCloser, error) {
	resp, err := t.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("provider returned %d: %s", resp.StatusCode, string(body))
	}

	return resp.Body, nil
}

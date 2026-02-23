// Package stream — SSE response parser.
//
// Parses Server-Sent Events (SSE) from LLM API responses.
// Extracts token text from provider-specific JSON formats.
//
// TODO: Implement in TASK-0004
package stream

// SSEEvent represents a single Server-Sent Event.
type SSEEvent struct {
	Event string // event type (e.g., "content_block_delta", "message_stop")
	Data  string // JSON payload
	ID    string // optional event ID
}

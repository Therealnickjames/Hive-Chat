// Package sse provides a generic Server-Sent Events parser.
//
// Parses SSE streams from LLM API responses.
// Uses bufio scanner for line-by-line parsing.
// See https://html.spec.whatwg.org/multipage/server-sent-events.html
package sse

import (
	"bufio"
	"io"
	"strings"
)

// Event represents a single Server-Sent Event.
type Event struct {
	EventType string // event type (e.g., "content_block_delta", "message_stop")
	Data      string // JSON payload
	ID        string // optional event ID
}

// Parse reads SSE events from a reader and calls the callback for each complete event.
// An event is complete when a blank line is encountered.
// Returns when the reader is exhausted or an error occurs.
func Parse(reader io.Reader, callback func(Event)) error {
	scanner := bufio.NewScanner(reader)

	// Allow large lines (some models return large JSON chunks)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var current Event

	for scanner.Scan() {
		line := scanner.Text()

		// Blank line = end of event
		if line == "" {
			if current.Data != "" || current.EventType != "" {
				callback(current)
				current = Event{}
			}
			continue
		}

		// Parse SSE fields
		if strings.HasPrefix(line, "data: ") {
			// If we already have data, append with newline (multi-line data)
			if current.Data != "" {
				current.Data += "\n" + line[6:]
			} else {
				current.Data = line[6:]
			}
		} else if strings.HasPrefix(line, "data:") {
			// data: with no space after colon
			value := line[5:]
			if current.Data != "" {
				current.Data += "\n" + value
			} else {
				current.Data = value
			}
		} else if strings.HasPrefix(line, "event: ") {
			current.EventType = line[7:]
		} else if strings.HasPrefix(line, "event:") {
			current.EventType = line[6:]
		} else if strings.HasPrefix(line, "id: ") {
			current.ID = line[4:]
		} else if strings.HasPrefix(line, "id:") {
			current.ID = line[3:]
		}
		// Lines starting with ":" are comments, ignore them
		// Other lines without known prefixes are also ignored per spec
	}

	// Handle any trailing event without a final blank line
	if current.Data != "" || current.EventType != "" {
		callback(current)
	}

	return scanner.Err()
}

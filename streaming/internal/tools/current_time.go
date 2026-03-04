package tools

import (
	"context"
	"fmt"
	"time"
)

// CurrentTime is a built-in tool that returns the current UTC time.
// Useful for agents that need temporal awareness (e.g., scheduling,
// "what time is it?", time-based decisions).
type CurrentTime struct{}

func NewCurrentTime() *CurrentTime {
	return &CurrentTime{}
}

func (t *CurrentTime) Definition() ToolDefinition {
	return ToolDefinition{
		Name:        "current_time",
		Description: "Returns the current date and time in UTC. Use this when you need to know the current time, date, or day of the week.",
		InputSchema: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
		},
	}
}

func (t *CurrentTime) Execute(ctx context.Context, args map[string]interface{}) (string, error) {
	now := time.Now().UTC()
	return fmt.Sprintf(
		"Current time: %s\nDate: %s\nDay: %s\nUnix timestamp: %d",
		now.Format(time.RFC3339),
		now.Format("2006-01-02"),
		now.Weekday().String(),
		now.Unix(),
	), nil
}

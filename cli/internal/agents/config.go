package agents

import (
	"fmt"
	"os"
	"strings"
)

// ParseConfigFile reads a tavok-agents.yml file and returns agent entries.
//
// Simple line-based parser — no YAML library needed. The format is:
//
//	agents:
//	  - name: Jack
//	  - name: Axis
//	    url: http://my-agent:3000
//
// Only `name` and `url` fields are supported. Unknown fields are ignored.
func ParseConfigFile(path string) ([]AgentEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	var entries []AgentEntry
	var current *AgentEntry

	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)

		// Skip empty lines and comments
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Skip the top-level "agents:" key
		if trimmed == "agents:" {
			continue
		}

		// New entry: "- name: value"
		if strings.HasPrefix(trimmed, "- name:") {
			if current != nil {
				entries = append(entries, *current)
			}
			name := strings.TrimSpace(strings.TrimPrefix(trimmed, "- name:"))
			current = &AgentEntry{Name: name}
			continue
		}

		// Continuation field: "url: value"
		if current != nil && strings.HasPrefix(trimmed, "url:") {
			current.URL = strings.TrimSpace(strings.TrimPrefix(trimmed, "url:"))
			continue
		}

		// Ignore unknown fields
	}

	// Don't forget the last entry
	if current != nil {
		entries = append(entries, *current)
	}

	// Validate: all entries need a name
	for i, entry := range entries {
		if entry.Name == "" {
			return nil, fmt.Errorf("agent at index %d has no name", i)
		}
	}

	return entries, nil
}

// Package config provides agent configuration types and loading.
//
// Agent configurations are loaded from the Next.js internal API:
// GET /api/internal/agents/{agentId}
//
// See docs/PROTOCOL.md §3 for the API contract.
//
// TODO: Implement API loading in TASK-0004
package config

// AgentConfig holds the configuration for an AI agent.
// Loaded from the Next.js web service via internal API.
type AgentConfig struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	LLMProvider   string   `json:"llmProvider"` // "anthropic" | "openai" | "ollama" | "openrouter" | "custom"
	LLMModel      string   `json:"llmModel"`
	APIEndpoint   string   `json:"apiEndpoint"`
	APIKey        string   `json:"apiKey"` // decrypted by the web service
	SystemPrompt  string   `json:"systemPrompt"`
	Temperature   float64  `json:"temperature"`
	MaxTokens     int      `json:"maxTokens"`
	TriggerMode   string   `json:"triggerMode"`   // "ALWAYS" | "MENTION" | "KEYWORD"
	ThinkingSteps []string `json:"thinkingSteps"` // configurable phase labels (TASK-0011)
	EnabledTools  []string `json:"enabledTools"`  // tool names to make available (TASK-0018), empty = all tools
}

// GetThinkingPhase returns the thinking step at the given index,
// falling back to defaults ["Thinking", "Writing"] if not configured.
func (a *AgentConfig) GetThinkingPhase(index int) string {
	defaults := []string{"Thinking", "Writing"}
	steps := a.ThinkingSteps
	if len(steps) == 0 {
		steps = defaults
	}
	if index < 0 || index >= len(steps) {
		// Return last phase for out-of-range indices
		return steps[len(steps)-1]
	}
	return steps[index]
}

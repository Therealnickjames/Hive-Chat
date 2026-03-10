// Package config — Charter configuration types (TASK-0020).
//
// CharterConfig represents the swarm/charter settings for a channel,
// fetched from the Next.js internal API: GET /api/internal/channels/{channelId}
//
// The Go proxy uses this to:
// - Enforce turn order (ROUND_ROBIN, CODE_REVIEW_SPRINT)
// - Inject charter context into the system prompt
// - Auto-complete sessions when max turns reached
// - Publish charter status to Redis for real-time UI updates
package config

// CharterConfig holds the channel charter / swarm mode configuration.
// Loaded from the Next.js internal API via Loader.GetChannelCharter().
type CharterConfig struct {
	SwarmMode   string   `json:"swarmMode"`
	Goal        string   `json:"charterGoal"`
	Rules       string   `json:"charterRules"`
	AgentOrder  []string `json:"charterAgentOrder"`
	MaxTurns    int      `json:"charterMaxTurns"`
	CurrentTurn int      `json:"charterCurrentTurn"`
	Status      string   `json:"charterStatus"`
}

// IsActive returns true if the charter session is currently running.
func (c *CharterConfig) IsActive() bool {
	return c.Status == "ACTIVE"
}

// IsEnforced returns true if charter enforcement should apply.
// Enforcement applies when the charter is active and the mode is not HUMAN_IN_THE_LOOP.
func (c *CharterConfig) IsEnforced() bool {
	return c.IsActive() && c.SwarmMode != "HUMAN_IN_THE_LOOP"
}

// HasReachedMaxTurns returns true if the turn limit has been reached.
// Returns false if MaxTurns is 0 (unlimited).
func (c *CharterConfig) HasReachedMaxTurns() bool {
	return c.MaxTurns > 0 && c.CurrentTurn >= c.MaxTurns
}

// IsAgentTurn checks if a given agentID is the expected agent for the current turn
// in ordered modes (ROUND_ROBIN, CODE_REVIEW_SPRINT).
func (c *CharterConfig) IsAgentTurn(agentID string) bool {
	if len(c.AgentOrder) == 0 {
		return true // No ordering defined — any agent can go
	}

	expectedIndex := c.CurrentTurn % len(c.AgentOrder)
	return c.AgentOrder[expectedIndex] == agentID
}

// ExpectedAgent returns the agent ID of the agent expected for the current turn.
// Returns empty string if no ordering is defined.
func (c *CharterConfig) ExpectedAgent() string {
	if len(c.AgentOrder) == 0 {
		return ""
	}
	return c.AgentOrder[c.CurrentTurn%len(c.AgentOrder)]
}

// SystemPromptInjection generates the charter context block to append to an agent's system prompt.
// Returns empty string if the charter is not active.
func (c *CharterConfig) SystemPromptInjection() string {
	if !c.IsActive() {
		return ""
	}

	injection := "\n\n## Channel Charter\n"
	injection += "Mode: " + c.SwarmMode + "\n"

	if c.Goal != "" {
		injection += "Goal: " + c.Goal + "\n"
	}
	if c.Rules != "" {
		injection += "Rules: " + c.Rules + "\n"
	}

	if c.MaxTurns > 0 {
		injection += "Turn: " + itoa(c.CurrentTurn+1) + " of " + itoa(c.MaxTurns) + "\n"
	}

	return injection
}

// ClaimCharterTurnResult holds the response from the atomic turn claim endpoint.
// PUT /api/internal/channels/{channelId}/charter-turn
type ClaimCharterTurnResult struct {
	Granted     bool   `json:"granted"`
	Reason      string `json:"reason,omitempty"`
	CurrentTurn int    `json:"currentTurn,omitempty"`
	MaxTurns    int    `json:"maxTurns,omitempty"`
	Completed   bool   `json:"completed,omitempty"`
}

// itoa is a simple int to string conversion without importing strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	if n < 0 {
		return "-" + itoa(-n)
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

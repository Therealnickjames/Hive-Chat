package config

import (
	"encoding/json"
	"strings"
	"testing"
)

// --- IsActive ---

func TestIsActive_ActiveStatus(t *testing.T) {
	c := &CharterConfig{Status: "ACTIVE"}
	if !c.IsActive() {
		t.Error("expected IsActive()=true when Status is ACTIVE")
	}
}

func TestIsActive_CompletedStatus(t *testing.T) {
	c := &CharterConfig{Status: "COMPLETED"}
	if c.IsActive() {
		t.Error("expected IsActive()=false when Status is COMPLETED")
	}
}

func TestIsActive_EmptyStatus(t *testing.T) {
	c := &CharterConfig{Status: ""}
	if c.IsActive() {
		t.Error("expected IsActive()=false when Status is empty")
	}
}

func TestIsActive_ArbitraryStatus(t *testing.T) {
	c := &CharterConfig{Status: "PAUSED"}
	if c.IsActive() {
		t.Error("expected IsActive()=false when Status is PAUSED")
	}
}

// --- IsEnforced ---

func TestIsEnforced_ActiveRoundRobin(t *testing.T) {
	c := &CharterConfig{Status: "ACTIVE", SwarmMode: "ROUND_ROBIN"}
	if !c.IsEnforced() {
		t.Error("expected IsEnforced()=true for ACTIVE + ROUND_ROBIN")
	}
}

func TestIsEnforced_ActiveCodeReviewSprint(t *testing.T) {
	c := &CharterConfig{Status: "ACTIVE", SwarmMode: "CODE_REVIEW_SPRINT"}
	if !c.IsEnforced() {
		t.Error("expected IsEnforced()=true for ACTIVE + CODE_REVIEW_SPRINT")
	}
}

func TestIsEnforced_ActiveHumanInTheLoop(t *testing.T) {
	c := &CharterConfig{Status: "ACTIVE", SwarmMode: "HUMAN_IN_THE_LOOP"}
	if c.IsEnforced() {
		t.Error("expected IsEnforced()=false for ACTIVE + HUMAN_IN_THE_LOOP")
	}
}

func TestIsEnforced_InactiveRoundRobin(t *testing.T) {
	c := &CharterConfig{Status: "COMPLETED", SwarmMode: "ROUND_ROBIN"}
	if c.IsEnforced() {
		t.Error("expected IsEnforced()=false when Status is not ACTIVE")
	}
}

func TestIsEnforced_EmptyFields(t *testing.T) {
	c := &CharterConfig{}
	if c.IsEnforced() {
		t.Error("expected IsEnforced()=false for zero-value CharterConfig")
	}
}

// --- HasReachedMaxTurns ---

func TestHasReachedMaxTurns_Table(t *testing.T) {
	tests := []struct {
		name        string
		maxTurns    int
		currentTurn int
		want        bool
	}{
		{"unlimited (0 max)", 0, 5, false},
		{"not reached", 10, 3, false},
		{"exactly at max", 10, 10, true},
		{"past max", 10, 15, true},
		{"one before max", 10, 9, false},
		{"first turn of limited", 5, 0, false},
		{"single turn limit reached", 1, 1, true},
		{"single turn limit not reached", 1, 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &CharterConfig{MaxTurns: tt.maxTurns, CurrentTurn: tt.currentTurn}
			if got := c.HasReachedMaxTurns(); got != tt.want {
				t.Errorf("HasReachedMaxTurns() = %v, want %v (maxTurns=%d, currentTurn=%d)",
					got, tt.want, tt.maxTurns, tt.currentTurn)
			}
		})
	}
}

// --- IsAgentTurn ---

func TestIsAgentTurn_EmptyOrder(t *testing.T) {
	c := &CharterConfig{AgentOrder: nil, CurrentTurn: 0}
	if !c.IsAgentTurn("any-agent") {
		t.Error("expected IsAgentTurn()=true when AgentOrder is empty")
	}
}

func TestIsAgentTurn_EmptySliceOrder(t *testing.T) {
	c := &CharterConfig{AgentOrder: []string{}, CurrentTurn: 0}
	if !c.IsAgentTurn("any-agent") {
		t.Error("expected IsAgentTurn()=true when AgentOrder is an empty slice")
	}
}

func TestIsAgentTurn_Table(t *testing.T) {
	agents := []string{"agent-A", "agent-B", "agent-C"}

	tests := []struct {
		name        string
		currentTurn int
		agentID     string
		want        bool
	}{
		{"turn 0 correct agent", 0, "agent-A", true},
		{"turn 0 wrong agent", 0, "agent-B", false},
		{"turn 1 correct agent", 1, "agent-B", true},
		{"turn 1 wrong agent", 1, "agent-C", false},
		{"turn 2 correct agent", 2, "agent-C", true},
		{"turn 3 wraps to agent-A", 3, "agent-A", true},
		{"turn 3 wrong agent", 3, "agent-B", false},
		{"turn 6 wraps to agent-A", 6, "agent-A", true},
		{"turn 7 wraps to agent-B", 7, "agent-B", true},
		{"turn 8 wraps to agent-C", 8, "agent-C", true},
		{"unknown agent never matches", 5, "agent-X", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &CharterConfig{AgentOrder: agents, CurrentTurn: tt.currentTurn}
			if got := c.IsAgentTurn(tt.agentID); got != tt.want {
				t.Errorf("IsAgentTurn(%q) = %v, want %v (currentTurn=%d, order=%v)",
					tt.agentID, got, tt.want, tt.currentTurn, agents)
			}
		})
	}
}

func TestIsAgentTurn_SingleAgent(t *testing.T) {
	c := &CharterConfig{AgentOrder: []string{"only-agent"}, CurrentTurn: 99}
	if !c.IsAgentTurn("only-agent") {
		t.Error("expected IsAgentTurn()=true for single agent at any turn")
	}
	if c.IsAgentTurn("other-agent") {
		t.Error("expected IsAgentTurn()=false for wrong agent with single agent order")
	}
}

// --- ExpectedAgent ---

func TestExpectedAgent_EmptyOrder(t *testing.T) {
	c := &CharterConfig{AgentOrder: nil, CurrentTurn: 0}
	if got := c.ExpectedAgent(); got != "" {
		t.Errorf("ExpectedAgent() = %q, want empty string for nil AgentOrder", got)
	}
}

func TestExpectedAgent_EmptySliceOrder(t *testing.T) {
	c := &CharterConfig{AgentOrder: []string{}, CurrentTurn: 5}
	if got := c.ExpectedAgent(); got != "" {
		t.Errorf("ExpectedAgent() = %q, want empty string for empty slice AgentOrder", got)
	}
}

func TestExpectedAgent_Table(t *testing.T) {
	agents := []string{"alpha", "beta", "gamma"}

	tests := []struct {
		name        string
		currentTurn int
		want        string
	}{
		{"turn 0", 0, "alpha"},
		{"turn 1", 1, "beta"},
		{"turn 2", 2, "gamma"},
		{"turn 3 wraps", 3, "alpha"},
		{"turn 4 wraps", 4, "beta"},
		{"turn 5 wraps", 5, "gamma"},
		{"turn 100 wraps", 100, "beta"}, // 100 % 3 = 1
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &CharterConfig{AgentOrder: agents, CurrentTurn: tt.currentTurn}
			if got := c.ExpectedAgent(); got != tt.want {
				t.Errorf("ExpectedAgent() = %q, want %q (currentTurn=%d)", got, tt.want, tt.currentTurn)
			}
		})
	}
}

func TestExpectedAgent_ConsistentWithIsAgentTurn(t *testing.T) {
	agents := []string{"a", "b", "c", "d"}
	for turn := 0; turn < 20; turn++ {
		c := &CharterConfig{AgentOrder: agents, CurrentTurn: turn}
		expected := c.ExpectedAgent()
		if !c.IsAgentTurn(expected) {
			t.Errorf("turn %d: ExpectedAgent()=%q but IsAgentTurn(%q)=false", turn, expected, expected)
		}
	}
}

// --- SystemPromptInjection ---

func TestSystemPromptInjection_InactiveReturnsEmpty(t *testing.T) {
	c := &CharterConfig{
		Status:    "COMPLETED",
		SwarmMode: "ROUND_ROBIN",
		Goal:      "Build something",
		Rules:     "Be nice",
	}
	if got := c.SystemPromptInjection(); got != "" {
		t.Errorf("SystemPromptInjection() = %q, want empty for inactive charter", got)
	}
}

func TestSystemPromptInjection_ActiveContainsMode(t *testing.T) {
	c := &CharterConfig{
		Status:    "ACTIVE",
		SwarmMode: "CODE_REVIEW_SPRINT",
	}
	got := c.SystemPromptInjection()
	if !strings.Contains(got, "Mode: CODE_REVIEW_SPRINT") {
		t.Errorf("SystemPromptInjection() missing mode, got: %q", got)
	}
}

func TestSystemPromptInjection_ActiveContainsGoal(t *testing.T) {
	c := &CharterConfig{
		Status:    "ACTIVE",
		SwarmMode: "ROUND_ROBIN",
		Goal:      "Fix all the bugs",
	}
	got := c.SystemPromptInjection()
	if !strings.Contains(got, "Goal: Fix all the bugs") {
		t.Errorf("SystemPromptInjection() missing goal, got: %q", got)
	}
}

func TestSystemPromptInjection_ActiveContainsRules(t *testing.T) {
	c := &CharterConfig{
		Status:    "ACTIVE",
		SwarmMode: "ROUND_ROBIN",
		Rules:     "No profanity",
	}
	got := c.SystemPromptInjection()
	if !strings.Contains(got, "Rules: No profanity") {
		t.Errorf("SystemPromptInjection() missing rules, got: %q", got)
	}
}

func TestSystemPromptInjection_ActiveOmitsEmptyGoalAndRules(t *testing.T) {
	c := &CharterConfig{
		Status:    "ACTIVE",
		SwarmMode: "ROUND_ROBIN",
		Goal:      "",
		Rules:     "",
	}
	got := c.SystemPromptInjection()
	if strings.Contains(got, "Goal:") {
		t.Errorf("SystemPromptInjection() should not contain Goal when empty, got: %q", got)
	}
	if strings.Contains(got, "Rules:") {
		t.Errorf("SystemPromptInjection() should not contain Rules when empty, got: %q", got)
	}
}

func TestSystemPromptInjection_ActiveContainsTurnInfo(t *testing.T) {
	c := &CharterConfig{
		Status:      "ACTIVE",
		SwarmMode:   "ROUND_ROBIN",
		MaxTurns:    10,
		CurrentTurn: 3,
	}
	got := c.SystemPromptInjection()
	// CurrentTurn is 0-indexed internally, display is +1, so "Turn: 4 of 10"
	if !strings.Contains(got, "Turn: 4 of 10") {
		t.Errorf("SystemPromptInjection() missing turn info, got: %q", got)
	}
}

func TestSystemPromptInjection_ActiveOmitsTurnInfoWhenUnlimited(t *testing.T) {
	c := &CharterConfig{
		Status:      "ACTIVE",
		SwarmMode:   "ROUND_ROBIN",
		MaxTurns:    0,
		CurrentTurn: 5,
	}
	got := c.SystemPromptInjection()
	if strings.Contains(got, "Turn:") {
		t.Errorf("SystemPromptInjection() should not contain Turn when MaxTurns=0, got: %q", got)
	}
}

func TestSystemPromptInjection_StartsWithHeader(t *testing.T) {
	c := &CharterConfig{
		Status:    "ACTIVE",
		SwarmMode: "ROUND_ROBIN",
	}
	got := c.SystemPromptInjection()
	if !strings.Contains(got, "## Channel Charter") {
		t.Errorf("SystemPromptInjection() missing header, got: %q", got)
	}
}

func TestSystemPromptInjection_FullContent(t *testing.T) {
	c := &CharterConfig{
		Status:      "ACTIVE",
		SwarmMode:   "CODE_REVIEW_SPRINT",
		Goal:        "Review PR #42",
		Rules:       "Be constructive; cite line numbers",
		MaxTurns:    6,
		CurrentTurn: 2,
	}
	got := c.SystemPromptInjection()

	expectations := []string{
		"## Channel Charter",
		"Mode: CODE_REVIEW_SPRINT",
		"Goal: Review PR #42",
		"Rules: Be constructive; cite line numbers",
		"Turn: 3 of 6",
	}
	for _, exp := range expectations {
		if !strings.Contains(got, exp) {
			t.Errorf("SystemPromptInjection() missing %q, got: %q", exp, got)
		}
	}
}

// --- itoa (internal helper) ---

func TestItoa_Table(t *testing.T) {
	tests := []struct {
		input int
		want  string
	}{
		{0, "0"},
		{1, "1"},
		{9, "9"},
		{10, "10"},
		{42, "42"},
		{100, "100"},
		{999, "999"},
		{1234567, "1234567"},
		{-1, "-1"},
		{-42, "-42"},
		{-100, "-100"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := itoa(tt.input); got != tt.want {
				t.Errorf("itoa(%d) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// --- JSON deserialization ---

func TestCharterConfigJSONTags(t *testing.T) {
	// Verify that the JSON struct tags map correctly
	raw := `{
		"swarmMode": "ROUND_ROBIN",
		"charterGoal": "Ship v2",
		"charterRules": "No breaking changes",
		"charterAgentOrder": ["agent-1", "agent-2"],
		"charterMaxTurns": 20,
		"charterCurrentTurn": 7,
		"charterStatus": "ACTIVE"
	}`

	var c CharterConfig
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}
	if c.SwarmMode != "ROUND_ROBIN" {
		t.Errorf("SwarmMode = %q, want ROUND_ROBIN", c.SwarmMode)
	}
	if c.Goal != "Ship v2" {
		t.Errorf("Goal = %q, want 'Ship v2'", c.Goal)
	}
	if c.Rules != "No breaking changes" {
		t.Errorf("Rules = %q, want 'No breaking changes'", c.Rules)
	}
	if len(c.AgentOrder) != 2 || c.AgentOrder[0] != "agent-1" || c.AgentOrder[1] != "agent-2" {
		t.Errorf("AgentOrder = %v, want [agent-1, agent-2]", c.AgentOrder)
	}
	if c.MaxTurns != 20 {
		t.Errorf("MaxTurns = %d, want 20", c.MaxTurns)
	}
	if c.CurrentTurn != 7 {
		t.Errorf("CurrentTurn = %d, want 7", c.CurrentTurn)
	}
	if c.Status != "ACTIVE" {
		t.Errorf("Status = %q, want ACTIVE", c.Status)
	}
}

func TestCharterConfigZeroValue(t *testing.T) {
	c := &CharterConfig{}
	if c.IsActive() {
		t.Error("zero-value IsActive should be false")
	}
	if c.IsEnforced() {
		t.Error("zero-value IsEnforced should be false")
	}
	if c.HasReachedMaxTurns() {
		t.Error("zero-value HasReachedMaxTurns should be false")
	}
	if c.ExpectedAgent() != "" {
		t.Errorf("zero-value ExpectedAgent should be empty, got %q", c.ExpectedAgent())
	}
	if c.SystemPromptInjection() != "" {
		t.Errorf("zero-value SystemPromptInjection should be empty, got %q", c.SystemPromptInjection())
	}
	if !c.IsAgentTurn("anything") {
		t.Error("zero-value IsAgentTurn should return true (no order defined)")
	}
}

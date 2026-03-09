// Package agents implements the CLI agent setup wizard and API client.
//
// Two modes:
//   - Config file (tavok-agents.yml): declarative, for repeatable deploys
//   - Interactive prompts: 1-question wizard (just the name), for first-time setup
package agents

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// AgentEntry represents one agent in the config file or wizard output.
type AgentEntry struct {
	Name string `json:"name"`
	URL  string `json:"url,omitempty"` // optional — webhook URL
}

// CreatedAgent is the result of creating an agent via the bootstrap API.
type CreatedAgent struct {
	Name             string `json:"name"`
	ID               string `json:"id"`
	APIKey           string `json:"apiKey"`
	ConnectionMethod string `json:"connectionMethod"`
}

// AgentCredentials is the .tavok-agents.json file format.
type AgentCredentials struct {
	Agents []CreatedAgent `json:"agents"`
}

// createAgentRequest is the POST body for /api/v1/bootstrap/agents.
type createAgentRequest struct {
	Name             string `json:"name"`
	ServerID         string `json:"serverId"`
	ConnectionMethod string `json:"connectionMethod,omitempty"`
	WebhookURL       string `json:"webhookUrl,omitempty"`
}

// createAgentResponse is the parsed response from the bootstrap/agents endpoint.
type createAgentResponse struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	APIKey           string `json:"apiKey"`
	ServerID         string `json:"serverId"`
	ConnectionMethod string `json:"connectionMethod"`
	WebsocketURL     string `json:"websocketUrl,omitempty"`
}

// RunInteractive runs the 1-question agent wizard.
// Returns the list of created agents (may be empty if user skips).
func RunInteractive(baseURL, adminToken, serverID string, yesMode bool) ([]CreatedAgent, error) {
	if yesMode {
		// --yes with no config file: skip agent setup
		return nil, nil
	}

	reader := bufio.NewReader(os.Stdin)

	fmt.Println()
	fmt.Println("  ── Agent Setup ──")
	fmt.Println()

	// Ask if user wants to add an agent
	fmt.Print("  Would you like to add an AI agent? [Y/n]: ")
	answer, _ := reader.ReadString('\n')
	answer = strings.TrimSpace(strings.ToLower(answer))
	if answer == "n" || answer == "no" {
		return nil, nil
	}

	var created []CreatedAgent

	for {
		fmt.Println()
		fmt.Print("  Agent name: ")
		name, _ := reader.ReadString('\n')
		name = strings.TrimSpace(name)
		if name == "" {
			fmt.Println("    Name cannot be empty.")
			continue
		}

		// Create agent via API
		agent, err := CreateAgent(baseURL, adminToken, serverID, AgentEntry{Name: name})
		if err != nil {
			fmt.Fprintf(os.Stderr, "\n    ERROR: %v\n", err)
			fmt.Println("    Skipping this agent.")
		} else {
			created = append(created, agent)

			if len(created) == 1 {
				// First agent — show full message
				fmt.Printf("\n    ✓ Agent %q added!\n", agent.Name)
				fmt.Println("      Credentials saved to .tavok-agents.json")
				fmt.Println("      Your agent will connect automatically.")
			} else {
				fmt.Printf("\n    ✓ Agent %q added!\n", agent.Name)
			}
		}

		fmt.Println()
		fmt.Print("  Add another? [y/N]: ")
		another, _ := reader.ReadString('\n')
		another = strings.TrimSpace(strings.ToLower(another))
		if another != "y" && another != "yes" {
			break
		}
	}

	if len(created) > 0 {
		fmt.Printf("\n  %d agent(s) configured. Credentials in .tavok-agents.json\n", len(created))
	}

	return created, nil
}

// RunFromConfig reads tavok-agents.yml and creates all listed agents.
func RunFromConfig(baseURL, adminToken, serverID, configPath string) ([]CreatedAgent, error) {
	entries, err := ParseConfigFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if len(entries) == 0 {
		return nil, nil
	}

	var created []CreatedAgent

	for _, entry := range entries {
		fmt.Printf("  Creating agent %q...      ", entry.Name)

		agent, err := CreateAgent(baseURL, adminToken, serverID, entry)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
			continue
		}

		created = append(created, agent)
		fmt.Println("ok")
	}

	return created, nil
}

// CreateAgent calls POST /api/v1/bootstrap/agents to create one agent.
func CreateAgent(baseURL, adminToken, serverID string, entry AgentEntry) (CreatedAgent, error) {
	// Determine connection method: has URL → WEBHOOK, no URL → WEBSOCKET
	method := "WEBSOCKET"
	if entry.URL != "" {
		method = "WEBHOOK"
	}

	reqBody := createAgentRequest{
		Name:             entry.Name,
		ServerID:         serverID,
		ConnectionMethod: method,
		WebhookURL:       entry.URL,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return CreatedAgent{}, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", baseURL+"/api/v1/bootstrap/agents", bytes.NewReader(body))
	if err != nil {
		return CreatedAgent{}, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer admin-"+adminToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return CreatedAgent{}, fmt.Errorf("API request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return CreatedAgent{}, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != 201 {
		return CreatedAgent{}, fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(respBody))
	}

	var result createAgentResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return CreatedAgent{}, fmt.Errorf("parse response: %w", err)
	}

	return CreatedAgent{
		Name:             result.Name,
		ID:               result.ID,
		APIKey:           result.APIKey,
		ConnectionMethod: result.ConnectionMethod,
	}, nil
}

// WriteAgentCredentials writes .tavok-agents.json (mode 0600, gitignored).
func WriteAgentCredentials(dir string, agents []CreatedAgent) error {
	creds := AgentCredentials{Agents: agents}
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal credentials: %w", err)
	}
	data = append(data, '\n')
	return os.WriteFile(filepath.Join(dir, ".tavok-agents.json"), data, 0o600)
}

// ConfigFileExists checks if tavok-agents.yml exists in the given directory.
func ConfigFileExists(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "tavok-agents.yml"))
	return err == nil
}

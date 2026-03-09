package agents

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseConfigFile(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected []AgentEntry
		wantErr  bool
	}{
		{
			name: "basic agents",
			content: `agents:
  - name: Jack
  - name: Axis
`,
			expected: []AgentEntry{
				{Name: "Jack"},
				{Name: "Axis"},
			},
		},
		{
			name: "agent with URL",
			content: `agents:
  - name: Jack
    url: http://localhost:8000
  - name: Nexus
`,
			expected: []AgentEntry{
				{Name: "Jack", URL: "http://localhost:8000"},
				{Name: "Nexus"},
			},
		},
		{
			name: "comments and blank lines",
			content: `# My agents
agents:
  # The main agent
  - name: Jack
    url: http://localhost:8000

  # A helper agent
  - name: Helper
`,
			expected: []AgentEntry{
				{Name: "Jack", URL: "http://localhost:8000"},
				{Name: "Helper"},
			},
		},
		{
			name:     "empty file",
			content:  "",
			expected: nil,
		},
		{
			name: "agents header only",
			content: `agents:
`,
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "tavok-agents.yml")
			if err := os.WriteFile(path, []byte(tt.content), 0o644); err != nil {
				t.Fatal(err)
			}

			entries, err := ParseConfigFile(path)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ParseConfigFile() error = %v, wantErr %v", err, tt.wantErr)
			}

			if len(entries) != len(tt.expected) {
				t.Fatalf("got %d entries, want %d", len(entries), len(tt.expected))
			}

			for i, got := range entries {
				want := tt.expected[i]
				if got.Name != want.Name {
					t.Errorf("entry[%d].Name = %q, want %q", i, got.Name, want.Name)
				}
				if got.URL != want.URL {
					t.Errorf("entry[%d].URL = %q, want %q", i, got.URL, want.URL)
				}
			}
		})
	}
}

func TestConfigFileExists(t *testing.T) {
	dir := t.TempDir()

	// Should not exist yet
	if ConfigFileExists(dir) {
		t.Fatal("ConfigFileExists should return false for empty dir")
	}

	// Create the file
	path := filepath.Join(dir, "tavok-agents.yml")
	if err := os.WriteFile(path, []byte("agents:\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Should exist now
	if !ConfigFileExists(dir) {
		t.Fatal("ConfigFileExists should return true after file creation")
	}
}

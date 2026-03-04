package provider

import (
	"net/http"
	"testing"
	"time"
)

func TestRegistryGetKnownProviders(t *testing.T) {
	reg := NewRegistry()

	tests := []struct {
		name         string
		expectedName string
	}{
		{"anthropic", "anthropic"},
		{"openai", "openai"},
		{"ollama", "openai"},
		{"openrouter", "openai"},
		{"custom", "openai"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := reg.Get(tt.name)
			if p == nil {
				t.Fatalf("Get(%q) returned nil", tt.name)
			}
			if p.Name() != tt.expectedName {
				t.Errorf("Get(%q).Name() = %q, want %q", tt.name, p.Name(), tt.expectedName)
			}
		})
	}
}

func TestRegistryGetUnknownFallsBack(t *testing.T) {
	reg := NewRegistry()

	p := reg.Get("nonexistent-provider")
	if p == nil {
		t.Fatal("Get(unknown) returned nil")
	}
	if p.Name() != "openai" {
		t.Errorf("Get(unknown).Name() = %q, want %q", p.Name(), "openai")
	}
}

func TestNewStreamingHTTPClient(t *testing.T) {
	client := NewStreamingHTTPClient()

	if client == nil {
		t.Fatal("NewStreamingHTTPClient() returned nil")
	}

	if client.Timeout != 5*time.Minute {
		t.Errorf("Timeout = %v, want %v", client.Timeout, 5*time.Minute)
	}

	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatal("Transport is not *http.Transport")
	}

	if transport.MaxConnsPerHost != 200 {
		t.Errorf("MaxConnsPerHost = %d, want 200", transport.MaxConnsPerHost)
	}

	if transport.MaxIdleConns != 200 {
		t.Errorf("MaxIdleConns = %d, want 200", transport.MaxIdleConns)
	}

	if transport.MaxIdleConnsPerHost != 20 {
		t.Errorf("MaxIdleConnsPerHost = %d, want 20", transport.MaxIdleConnsPerHost)
	}

	if transport.IdleConnTimeout != 120*time.Second {
		t.Errorf("IdleConnTimeout = %v, want %v", transport.IdleConnTimeout, 120*time.Second)
	}
}

func TestAnthropicName(t *testing.T) {
	a := NewAnthropic()
	if a.Name() != "anthropic" {
		t.Errorf("Name() = %q, want %q", a.Name(), "anthropic")
	}
}

func TestOpenAIName(t *testing.T) {
	o := NewOpenAI()
	if o.Name() != "openai" {
		t.Errorf("Name() = %q, want %q", o.Name(), "openai")
	}
}

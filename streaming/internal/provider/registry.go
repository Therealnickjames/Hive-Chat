// Package provider — Provider registry.
//
// Maps provider names to Provider implementations.
// Known providers: "anthropic" → Anthropic, "openai"/"ollama"/"openrouter"/"custom" → OpenAI-compatible.
// Unknown providers fall back to OpenAI-compatible with a warning log.
package provider

import "log/slog"

// Registry holds provider instances keyed by name.
type Registry struct {
	providers map[string]Provider
	fallback  Provider
}

// NewRegistry creates a registry with default providers.
//
// Provider mapping:
//
//	"anthropic"  → Anthropic (x-api-key auth, content_block_delta events)
//	"openai"     → OpenAI (Bearer auth, choices[0].delta.content events)
//	"ollama"     → OpenAI-compatible (local, typically no auth)
//	"openrouter" → OpenAI-compatible (Bearer auth, model aggregator)
//	"custom"     → OpenAI-compatible (user-provided endpoint)
func NewRegistry() *Registry {
	openai := NewOpenAI()
	anthropic := NewAnthropic()

	return &Registry{
		providers: map[string]Provider{
			"openai":     openai,
			"anthropic":  anthropic,
			"ollama":     openai, // Ollama speaks OpenAI format
			"openrouter": openai, // OpenRouter speaks OpenAI format
			"custom":     openai, // Custom endpoints assumed to be OpenAI-compatible
		},
		fallback: openai, // Default to OpenAI-compatible for any unknown provider
	}
}

// Get returns the Provider for a given provider name.
// Falls back to OpenAI-compatible if the name is unrecognized.
func (r *Registry) Get(name string) Provider {
	if p, ok := r.providers[name]; ok {
		return p
	}
	slog.Warn("Unknown provider, falling back to OpenAI-compatible",
		"provider", name,
	)
	return r.fallback
}

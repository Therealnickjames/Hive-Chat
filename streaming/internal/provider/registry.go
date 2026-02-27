// Package provider — Provider registry.
//
// Maps provider names to Provider implementations.
// "anthropic" → Anthropic, everything else → OpenAI-compatible.
package provider

// Registry holds provider instances keyed by name.
type Registry struct {
	providers map[string]Provider
	fallback  Provider
}

// NewRegistry creates a registry with default providers.
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
	return r.fallback
}

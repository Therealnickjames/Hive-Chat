package tools

import (
	"context"
	"fmt"
	"log/slog"
)

// Registry holds registered tools and dispatches calls.
// Thread-safe for reads after initialization (tools are registered at startup).
type Registry struct {
	tools map[string]Tool
}

// NewRegistry creates an empty tool registry.
func NewRegistry() *Registry {
	return &Registry{
		tools: make(map[string]Tool),
	}
}

// Register adds a tool to the registry.
// Panics if a tool with the same name is already registered (startup-only).
func (r *Registry) Register(tool Tool) {
	name := tool.Definition().Name
	if _, exists := r.tools[name]; exists {
		panic(fmt.Sprintf("tool already registered: %s", name))
	}
	r.tools[name] = tool
	slog.Info("Tool registered", "name", name)
}

// List returns definitions for all registered tools.
// If enabledTools is non-empty, only tools in the list are returned.
func (r *Registry) List(enabledTools []string) []ToolDefinition {
	if len(enabledTools) == 0 {
		// Return all tools
		defs := make([]ToolDefinition, 0, len(r.tools))
		for _, t := range r.tools {
			defs = append(defs, t.Definition())
		}
		return defs
	}

	// Filter to enabled tools only
	enabled := make(map[string]bool, len(enabledTools))
	for _, name := range enabledTools {
		enabled[name] = true
	}

	defs := make([]ToolDefinition, 0, len(enabledTools))
	for _, t := range r.tools {
		if enabled[t.Definition().Name] {
			defs = append(defs, t.Definition())
		}
	}
	return defs
}

// Call executes a tool by name and returns the result.
// Returns a ToolCallResult with IsError=true if the tool is not found or execution fails.
func (r *Registry) Call(ctx context.Context, req ToolCallRequest) ToolCallResult {
	tool, ok := r.tools[req.Name]
	if !ok {
		slog.Warn("Tool not found", "name", req.Name, "callId", req.ID)
		return ToolCallResult{
			CallID:  req.ID,
			Name:    req.Name,
			Content: fmt.Sprintf("Tool not found: %s", req.Name),
			IsError: true,
		}
	}

	result, err := tool.Execute(ctx, req.Arguments)
	if err != nil {
		slog.Error("Tool execution failed",
			"name", req.Name,
			"callId", req.ID,
			"error", err,
		)
		return ToolCallResult{
			CallID:  req.ID,
			Name:    req.Name,
			Content: fmt.Sprintf("Tool error: %s", err.Error()),
			IsError: true,
		}
	}

	return ToolCallResult{
		CallID:  req.ID,
		Name:    req.Name,
		Content: result,
		IsError: false,
	}
}

// HasTools returns true if any tools are registered.
func (r *Registry) HasTools() bool {
	return len(r.tools) > 0
}

// Count returns the number of registered tools.
func (r *Registry) Count() int {
	return len(r.tools)
}

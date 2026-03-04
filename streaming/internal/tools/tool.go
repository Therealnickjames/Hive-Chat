package tools

import "context"

// ToolDefinition describes a tool's interface using JSON Schema.
// This maps directly to MCP's tools/list response format and is
// convertible to both Anthropic and OpenAI tool schemas.
type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"` // JSON Schema object
}

// ToolCallRequest represents an LLM's request to invoke a tool.
// Populated by the provider when it detects a tool_use stop reason.
type ToolCallRequest struct {
	ID        string                 `json:"id"`        // Provider-assigned call ID (for result correlation)
	Name      string                 `json:"name"`      // Tool name
	Arguments map[string]interface{} `json:"arguments"` // Parsed arguments
}

// ToolCallResult holds the output from a tool execution.
type ToolCallResult struct {
	CallID  string `json:"callId"`  // Echoes ToolCallRequest.ID
	Name    string `json:"name"`    // Tool name (for display)
	Content string `json:"content"` // Result content (text)
	IsError bool   `json:"isError"` // Whether the tool returned an error
}

// Tool is the interface all tools must implement.
// Tools are stateless — each call receives its full context.
type Tool interface {
	// Definition returns the tool's metadata and JSON Schema.
	Definition() ToolDefinition

	// Execute runs the tool with the given arguments.
	// Returns the result text or an error.
	Execute(ctx context.Context, args map[string]interface{}) (string, error)
}

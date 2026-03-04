// Package tools provides MCP-compatible tool definitions and execution.
//
// Tools follow the Model Context Protocol (MCP) patterns:
//   - tools/list: enumerate available tools with JSON Schema definitions
//   - tools/call: execute a tool by name with validated arguments
//
// The package provides:
//   - Tool interface for implementing custom tools
//   - Registry for tool discovery and dispatch
//   - Provider-specific format converters (Anthropic, OpenAI)
//   - Built-in tools: current_time, web_search
//
// Architecture (DEC-0048):
//
//	Go proxy owns tool execution. The manager detects stop_reason "tool_use"
//	from the LLM provider, executes tools via the Registry, and feeds results
//	back into the next provider iteration. The frontend receives tool_call and
//	tool_result events for display but has no execution responsibility.
//
// See docs/PROTOCOL.md for Redis event contracts.
// See docs/DECISIONS.md DEC-0048 for rationale.
package tools

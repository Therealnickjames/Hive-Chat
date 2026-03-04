package tools

// Format converters for provider-specific tool schemas.
//
// Each LLM provider has its own format for tool definitions in API requests.
// These converters transform our ToolDefinition into the provider-specific format.

// ToAnthropicTools converts tool definitions to Anthropic's format.
// Anthropic format:
//
//	[{
//	  "name": "tool_name",
//	  "description": "what it does",
//	  "input_schema": { "type": "object", "properties": {...}, "required": [...] }
//	}]
func ToAnthropicTools(defs []ToolDefinition) []map[string]interface{} {
	if len(defs) == 0 {
		return nil
	}

	tools := make([]map[string]interface{}, len(defs))
	for i, def := range defs {
		tools[i] = map[string]interface{}{
			"name":         def.Name,
			"description":  def.Description,
			"input_schema": def.InputSchema,
		}
	}
	return tools
}

// ToOpenAITools converts tool definitions to OpenAI's format.
// OpenAI format:
//
//	[{
//	  "type": "function",
//	  "function": {
//	    "name": "tool_name",
//	    "description": "what it does",
//	    "parameters": { "type": "object", "properties": {...}, "required": [...] }
//	  }
//	}]
func ToOpenAITools(defs []ToolDefinition) []map[string]interface{} {
	if len(defs) == 0 {
		return nil
	}

	tools := make([]map[string]interface{}, len(defs))
	for i, def := range defs {
		tools[i] = map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        def.Name,
				"description": def.Description,
				"parameters":  def.InputSchema,
			},
		}
	}
	return tools
}

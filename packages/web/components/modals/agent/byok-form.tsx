"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AgentListItem } from "./types";

const PROVIDER_DEFAULTS: Record<string, { endpoint: string; model: string }> = {
  openai: { endpoint: "https://api.openai.com", model: "gpt-4o" },
  anthropic: { endpoint: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  google: { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  xai: { endpoint: "https://api.x.ai", model: "grok-3" },
  groq: { endpoint: "https://api.groq.com/openai", model: "llama-3.3-70b-versatile" },
  mistral: { endpoint: "https://api.mistral.ai", model: "mistral-large-latest" },
  moonshot: { endpoint: "https://api.moonshot.ai", model: "kimi-k2" },
  ollama: { endpoint: "http://localhost:11434", model: "llama3" },
  openrouter: { endpoint: "https://openrouter.ai/api", model: "openai/gpt-4o" },
  custom: { endpoint: "", model: "" },
};

interface BYOKFormProps {
  serverId: string;
  editingBot: AgentListItem | null;
  onSave: () => void;
  onCancel: () => void;
}

export function BYOKForm({ serverId, editingBot, onSave, onCancel }: BYOKFormProps) {
  const [name, setName] = useState(editingBot?.name || "");
  const [provider, setProvider] = useState(editingBot?.llmProvider || "openai");
  const [model, setModel] = useState(editingBot?.llmModel || "gpt-4o");
  const [endpoint, setEndpoint] = useState(editingBot?.apiEndpoint || "https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(editingBot?.systemPrompt || "You are a helpful assistant.");
  const [temperature, setTemperature] = useState(String(editingBot?.temperature ?? 0.7));
  const [maxTokens, setMaxTokens] = useState(String(editingBot?.maxTokens ?? 4096));
  const [triggerMode, setTriggerMode] = useState(editingBot?.triggerMode || "ALWAYS");
  const [thinkingSteps, setThinkingSteps] = useState(
    editingBot?.thinkingSteps
      ? (() => {
          try {
            const parsed = JSON.parse(editingBot.thinkingSteps);
            return Array.isArray(parsed) ? parsed.join(", ") : "";
          } catch {
            return "";
          }
        })()
      : ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    const defaults = PROVIDER_DEFAULTS[newProvider];
    if (defaults) {
      setEndpoint(defaults.endpoint);
      setModel(defaults.model);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError("");

    const body: Record<string, unknown> = {
      name: name.trim(),
      llmProvider: provider,
      llmModel: model.trim(),
      apiEndpoint: endpoint.trim(),
      systemPrompt: systemPrompt.trim(),
      temperature: parseFloat(temperature),
      maxTokens: parseInt(maxTokens),
      triggerMode,
      thinkingSteps: thinkingSteps.trim()
        ? thinkingSteps.split(",").map((s: string) => s.trim()).filter(Boolean)
        : undefined,
    };

    if (apiKey.trim()) {
      body.apiKey = apiKey.trim();
    }

    try {
      const url = editingBot
        ? `/api/servers/${serverId}/bots/${editingBot.id}`
        : `/api/servers/${serverId}/bots`;

      const res = await fetch(url, {
        method: editingBot ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save bot");
        return;
      }

      onSave();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        label="Agent Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Claude Assistant"
        autoFocus
      />

      <div>
        <label className="mb-1 block text-sm font-medium text-text-primary">
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full rounded bg-background-primary px-3 py-2 text-sm text-text-primary border border-background-tertiary focus:border-brand focus:outline-none"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google Gemini</option>
          <option value="xai">xAI (Grok)</option>
          <option value="groq">Groq</option>
          <option value="mistral">Mistral</option>
          <option value="moonshot">Moonshot (Kimi)</option>
          <option value="ollama">Ollama (Local)</option>
          <option value="openrouter">OpenRouter (400+ models)</option>
          <option value="custom">Custom (OpenAI-compatible)</option>
        </select>
      </div>

      <Input
        label="Model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="gpt-4o"
      />

      <Input
        label="API Endpoint"
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        placeholder="https://api.openai.com"
      />

      <Input
        label={editingBot ? "API Key (leave blank to keep existing)" : "API Key"}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-..."
        type="password"
      />

      <div>
        <label className="mb-1 block text-sm font-medium text-text-primary">
          System Prompt
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a helpful assistant."
          rows={3}
          className="w-full rounded bg-background-primary px-3 py-2 text-sm text-text-primary border border-background-tertiary focus:border-brand focus:outline-none resize-none"
        />
      </div>

      <div className="flex gap-3">
        <Input
          label="Temperature"
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
          placeholder="0.7"
          type="number"
        />
        <Input
          label="Max Tokens"
          value={maxTokens}
          onChange={(e) => setMaxTokens(e.target.value)}
          placeholder="4096"
          type="number"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-text-primary">
          Trigger Mode
        </label>
        <select
          value={triggerMode}
          onChange={(e) => setTriggerMode(e.target.value)}
          className="w-full rounded bg-background-primary px-3 py-2 text-sm text-text-primary border border-background-tertiary focus:border-brand focus:outline-none"
        >
          <option value="ALWAYS">Always respond</option>
          <option value="MENTION">Only when @mentioned</option>
        </select>
      </div>

      <Input
        label="Thinking Steps (comma-separated, optional)"
        value={thinkingSteps}
        onChange={(e) => setThinkingSteps(e.target.value)}
        placeholder="Thinking, Writing"
      />

      {error && (
        <p className="text-sm text-status-danger">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" loading={loading} disabled={!name.trim()}>
          {editingBot ? "Save" : "Create Agent"}
        </Button>
      </div>
    </form>
  );
}

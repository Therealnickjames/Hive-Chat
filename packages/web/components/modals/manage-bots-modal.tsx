"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChatContext } from "@/components/providers/chat-provider";

interface Bot {
  id: string;
  name: string;
  llmProvider: string;
  llmModel: string;
  apiEndpoint: string | null;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  triggerMode: string;
}

interface ManageBotsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDER_DEFAULTS: Record<string, { endpoint: string; model: string }> = {
  openai: { endpoint: "https://api.openai.com", model: "gpt-4o" },
  anthropic: { endpoint: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
  ollama: { endpoint: "http://localhost:11434", model: "llama3" },
  openrouter: { endpoint: "https://openrouter.ai/api", model: "openai/gpt-4o" },
  custom: { endpoint: "", model: "" },
};

export function ManageBotsModal({ isOpen, onClose }: ManageBotsModalProps) {
  const { currentServerId } = useChatContext();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingBot, setEditingBot] = useState<Bot | null>(null);
  const [error, setError] = useState("");
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o");
  const [endpoint, setEndpoint] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [temperature, setTemperature] = useState("0.7");
  const [maxTokens, setMaxTokens] = useState("4096");
  const [triggerMode, setTriggerMode] = useState("ALWAYS");

  const fetchBots = useCallback(async () => {
    if (!currentServerId) return;
    try {
      const res = await fetch(`/api/servers/${currentServerId}/bots`);
      if (res.ok) {
        const data = await res.json();
        const nextBots = Array.isArray(data?.bots)
          ? data.bots
          : Array.isArray(data)
            ? data
            : [];
        setBots(nextBots);
      }
    } catch {
      console.error("Failed to fetch bots");
    }
  }, [currentServerId]);

  useEffect(() => {
    if (isOpen) fetchBots();
  }, [isOpen, fetchBots]);

  function resetForm() {
    setName("");
    setProvider("openai");
    setModel("gpt-4o");
    setEndpoint("https://api.openai.com");
    setApiKey("");
    setSystemPrompt("You are a helpful assistant.");
    setTemperature("0.7");
    setMaxTokens("4096");
    setTriggerMode("ALWAYS");
    setError("");
    setEditingBot(null);
  }

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    const defaults = PROVIDER_DEFAULTS[newProvider];
    if (defaults) {
      setEndpoint(defaults.endpoint);
      setModel(defaults.model);
    }
  }

  function startEdit(bot: Bot) {
    setEditingBot(bot);
    setName(bot.name);
    setProvider(bot.llmProvider);
    setModel(bot.llmModel);
    setEndpoint(bot.apiEndpoint || "");
    setApiKey(""); // Never pre-filled
    setSystemPrompt(bot.systemPrompt || "");
    setTemperature(String(bot.temperature));
    setMaxTokens(String(bot.maxTokens));
    setTriggerMode(bot.triggerMode);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !currentServerId) return;

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
    };

    // Only include apiKey if provided (for edit, empty means "keep existing")
    if (apiKey.trim()) {
      body.apiKey = apiKey.trim();
    }

    try {
      const url = editingBot
        ? `/api/servers/${currentServerId}/bots/${editingBot.id}`
        : `/api/servers/${currentServerId}/bots`;

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

      await fetchBots();
      resetForm();
      setShowForm(false);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(botId: string) {
    if (!currentServerId) return;

    // First click sets confirmation state, second click executes (ISSUE-027)
    if (deletingBotId !== botId) {
      setDeletingBotId(botId);
      return;
    }

    try {
      const res = await fetch(
        `/api/servers/${currentServerId}/bots/${botId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await fetchBots();
      }
    } catch {
      console.error("Failed to delete bot");
    } finally {
      setDeletingBotId(null);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Agents">
      {!showForm ? (
        <div>
          {/* Bot list */}
          {bots.length === 0 ? (
            <p className="text-sm text-text-muted py-4">
              No agents yet. Create one to add AI to your channels.
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-center justify-between rounded bg-background-primary p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary">
                        {bot.name}
                      </span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400">
                        {bot.llmProvider}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted truncate">
                      {bot.llmModel} &middot; {bot.triggerMode.toLowerCase()}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEdit(bot)}
                      className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-background-secondary hover:text-text-primary"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(bot.id)}
                      onBlur={() => setDeletingBotId(null)}
                      className={`rounded px-2 py-1 text-xs ${
                        deletingBotId === bot.id
                          ? "bg-status-danger text-white font-semibold"
                          : "text-status-danger hover:bg-status-danger/10"
                      }`}
                    >
                      {deletingBotId === bot.id ? "Confirm?" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              Add Agent
            </Button>
          </div>
        </div>
      ) : (
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
              <option value="ollama">Ollama (Local)</option>
              <option value="openrouter">OpenRouter</option>
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

          {error && (
            <p className="text-sm text-status-danger">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              Back
            </Button>
            <Button type="submit" loading={loading} disabled={!name.trim()}>
              {editingBot ? "Save" : "Create Agent"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

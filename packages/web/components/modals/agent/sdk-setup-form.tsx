"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CreatedAgentCredentials } from "./types";

interface SDKSetupFormProps {
  serverId: string;
  onCreated: (credentials: CreatedAgentCredentials) => void;
  onCancel: () => void;
}

export function SDKSetupForm({ serverId, onCreated, onCancel }: SDKSetupFormProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/servers/${serverId}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          connectionMethod: "WEBSOCKET",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create agent");
        return;
      }

      const data = await res.json();
      onCreated({
        id: data.id,
        name: data.name,
        connectionMethod: "WEBSOCKET",
        apiKey: data.apiKey,
        websocketUrl: data.websocketUrl,
      });
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Agent Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My Custom Agent"
        autoFocus
      />

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase text-text-muted">Quick Start</p>

        <div className="rounded bg-background-primary p-3">
          <p className="mb-2 text-xs font-medium text-text-secondary">1. Install the SDK</p>
          <code className="block text-xs font-mono text-accent-cyan bg-background-tertiary rounded px-2 py-1.5">
            pip install tavok-sdk
          </code>
        </div>

        <div className="rounded bg-background-primary p-3">
          <p className="mb-2 text-xs font-medium text-text-secondary">2. Connect your agent</p>
          <pre className="text-xs font-mono text-text-secondary bg-background-tertiary rounded px-2 py-1.5 overflow-x-auto">
{`from tavok import Agent

agent = Agent(
    api_key="YOUR_API_KEY",
    name="${name.trim() || "My Agent"}",
)

@agent.on_message
async def handle(msg):
    await msg.reply("Hello!")

agent.run()`}
          </pre>
        </div>
      </div>

      <p className="text-xs text-text-muted">
        Your API key will be shown after creation. You&apos;ll need it for the SDK connection.
      </p>

      {error && <p className="text-sm text-status-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" loading={loading} disabled={!name.trim()}>
          Create Agent
        </Button>
      </div>
    </form>
  );
}

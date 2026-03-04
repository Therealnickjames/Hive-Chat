"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CreatedAgentCredentials } from "./types";

// ─── Inbound Webhook Form ───

interface InboundWebhookFormProps {
  serverId: string;
  onCreated: (credentials: CreatedAgentCredentials) => void;
  onCancel: () => void;
}

export function InboundWebhookForm({
  serverId,
  onCreated,
  onCancel,
}: InboundWebhookFormProps) {
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
          connectionMethod: "INBOUND_WEBHOOK",
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
        connectionMethod: "INBOUND_WEBHOOK",
        apiKey: data.apiKey,
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
        label="Webhook Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="CI Notifications"
        autoFocus
      />

      <div className="rounded bg-background-primary p-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          Create an inbound webhook agent, then use the API key to create
          webhook URLs for specific channels. Any HTTP client can POST messages
          to the webhook URL — no headers needed.
        </p>
      </div>

      <div className="rounded bg-background-primary p-3">
        <p className="mb-2 text-xs font-medium text-text-secondary">Example usage</p>
        <pre className="text-xs font-mono text-text-secondary bg-background-tertiary rounded px-2 py-1.5 overflow-x-auto">
{`curl -X POST /api/v1/webhooks/whk_TOKEN \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Build passed!"}'`}
        </pre>
      </div>

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

// ─── Outbound Webhook Form ───

interface OutboundWebhookFormProps {
  serverId: string;
  onCreated: (credentials: CreatedAgentCredentials) => void;
  onCancel: () => void;
}

export function OutboundWebhookForm({
  serverId,
  onCreated,
  onCancel,
}: OutboundWebhookFormProps) {
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !webhookUrl.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/servers/${serverId}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          connectionMethod: "WEBHOOK",
          webhookUrl: webhookUrl.trim(),
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
        connectionMethod: "WEBHOOK",
        apiKey: data.apiKey,
        webhookSecret: data.webhookSecret,
        webhookUrl: data.webhookUrl,
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
        placeholder="LangGraph Agent"
        autoFocus
      />

      <Input
        label="Webhook URL"
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
        placeholder="https://your-agent.example.com/webhook"
      />

      <div className="rounded bg-background-primary p-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          When this agent is triggered, Tavok will POST to your webhook URL with
          the message content and context. Your agent can respond synchronously
          or stream tokens back via SSE.
        </p>
        <p className="mt-2 text-xs text-text-muted">
          Payloads are signed with HMAC-SHA256. The signing secret will be shown
          after creation.
        </p>
      </div>

      {error && <p className="text-sm text-status-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button
          type="submit"
          loading={loading}
          disabled={!name.trim() || !webhookUrl.trim()}
        >
          Create Agent
        </Button>
      </div>
    </form>
  );
}

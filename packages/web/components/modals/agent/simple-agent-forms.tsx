"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ConnectionMethodType, CreatedAgentCredentials } from "./types";

/**
 * Generic form for REST Polling, SSE, and OpenAI-Compatible agents.
 * These all just need a name — credentials are generated server-side.
 */

interface SimpleAgentFormProps {
  serverId: string;
  connectionMethod: ConnectionMethodType;
  title: string;
  description: string;
  exampleCode?: string;
  onCreated: (credentials: CreatedAgentCredentials) => void;
  onCancel: () => void;
}

export function SimpleAgentForm({
  serverId,
  connectionMethod,
  title,
  description,
  exampleCode,
  onCreated,
  onCancel,
}: SimpleAgentFormProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/servers/${serverId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          connectionMethod,
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
        connectionMethod,
        apiKey: data.apiKey,
        pollUrl: data.pollUrl,
        eventsUrl: data.eventsUrl,
        chatCompletionsUrl: data.chatCompletionsUrl,
        modelsUrl: data.modelsUrl,
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
        placeholder="My Agent"
        autoFocus
      />

      <div className="rounded bg-background-primary p-3">
        <p className="mb-1 text-xs font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-secondary leading-relaxed">
          {description}
        </p>
      </div>

      {exampleCode && (
        <div className="rounded bg-background-primary p-3">
          <p className="mb-2 text-xs font-medium text-text-secondary">
            Example
          </p>
          <pre className="text-xs font-mono text-text-secondary bg-background-tertiary rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap">
            {exampleCode}
          </pre>
        </div>
      )}

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

// ─── Pre-configured forms ───

interface FormProps {
  serverId: string;
  onCreated: (credentials: CreatedAgentCredentials) => void;
  onCancel: () => void;
}

export function RestPollingForm(props: FormProps) {
  return (
    <SimpleAgentForm
      {...props}
      connectionMethod="REST_POLL"
      title="REST Polling"
      description="Your agent polls for new messages via GET requests and sends responses via POST. Ideal for serverless environments like AWS Lambda or cron-based agents."
      exampleCode={`# Poll for messages
GET /api/v1/agents/{id}/messages?wait=30&ack=true
Authorization: Bearer sk-tvk-YOUR_KEY

# Send response
POST /api/v1/agents/{id}/messages
{"channelId": "...", "content": "Hello!"}`}
    />
  );
}

export function SSEForm(props: FormProps) {
  return (
    <SimpleAgentForm
      {...props}
      connectionMethod="SSE"
      title="Server-Sent Events"
      description="Receive real-time events via an SSE stream. Send responses via REST API. Good for browser-based agents or environments where WebSockets aren't available."
      exampleCode={`# Subscribe to events
GET /api/v1/agents/{id}/events
Authorization: Bearer sk-tvk-YOUR_KEY
Accept: text/event-stream

# Events: message_new, stream_start, stream_token, ...`}
    />
  );
}

export function OpenAICompatForm(props: FormProps) {
  return (
    <SimpleAgentForm
      {...props}
      connectionMethod="OPENAI_COMPAT"
      title="OpenAI-Compatible API"
      description="Use the standard OpenAI Chat Completions format. Works with LiteLLM, LangChain, any OpenAI SDK — just set the base_url to your Tavok instance."
      exampleCode={`from openai import OpenAI

client = OpenAI(
    api_key="sk-tvk-YOUR_KEY",
    base_url="https://your-tavok.com/api/v1"
)

# model = "tavok-channel-{channelId}"
response = client.chat.completions.create(
    model="tavok-channel-CHANNEL_ID",
    messages=[{"role": "user", "content": "Hi"}]
)`}
    />
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Bot,
  CheckCircle,
  XCircle,
  Trash2,
  Wifi,
  Globe,
  Zap,
} from "lucide-react";

interface AgentData {
  id: string;
  name: string;
  avatarUrl: string | null;
  isActive: boolean;
  triggerMode: string;
  connectionMethod: string | null; // null = BYOK
  capabilities: string[] | null;
  createdAt: string;
}

interface AgentsSectionProps {
  serverId: string;
}

function connectionLabel(method: string | null): string {
  if (!method) return "BYOK";
  switch (method) {
    case "WEBSOCKET":
      return "WebSocket";
    case "WEBHOOK":
      return "Webhook";
    case "INBOUND_WEBHOOK":
      return "Inbound Webhook";
    case "REST_POLL":
      return "REST Poll";
    case "SSE":
      return "SSE";
    case "OPENAI_COMPAT":
      return "OpenAI Compatible";
    default:
      return method;
  }
}

function ConnectionIcon({ method }: { method: string | null }) {
  if (!method) return <Globe className="h-3 w-3" />;
  switch (method) {
    case "WEBSOCKET":
      return <Wifi className="h-3 w-3" />;
    case "WEBHOOK":
    case "INBOUND_WEBHOOK":
      return <Zap className="h-3 w-3" />;
    default:
      return <Globe className="h-3 w-3" />;
  }
}

export function AgentsSection({ serverId }: AgentsSectionProps) {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/agents`);
      if (res.ok) {
        const data = await res.json();
        setAgents(
          Array.isArray(data?.agents)
            ? data.agents
            : Array.isArray(data)
              ? data
              : [],
        );
      }
    } catch {
      setError("Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  async function handleToggleActive(agentId: string, currentlyActive: boolean) {
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentlyActive }),
      });
      if (res.ok) await fetchAgents();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to update agent");
      }
    } catch {
      setError("Something went wrong");
    }
  }

  async function handleDelete(agentId: string) {
    if (!window.confirm("Delete this agent? This cannot be undone.")) return;
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/agents/${agentId}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchAgents();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete agent");
      }
    } catch {
      setError("Something went wrong");
    }
  }

  if (loading) {
    return (
      <p className="py-8 text-center text-sm text-text-muted">Loading...</p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </div>
      )}

      <p className="text-xs text-text-muted">
        Manage agents in this server. Add new agents via the CLI (
        <code className="rounded bg-background-tertiary px-1 py-0.5 text-[11px]">
          tavok init
        </code>
        ) or the Agents panel in the channel view.
      </p>

      {agents.length === 0 ? (
        <div className="py-8 text-center">
          <Bot className="mx-auto mb-2 h-8 w-8 text-text-dim" />
          <p className="text-sm text-text-muted">
            No agents in this server yet.
          </p>
          <p className="mt-1 text-xs text-text-dim">
            Use{" "}
            <code className="rounded bg-background-tertiary px-1 py-0.5">
              tavok init
            </code>{" "}
            to add your first agent.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-lg bg-background-secondary px-3 py-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-purple/20 text-sm font-bold text-accent-purple">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {agent.name}
                      </span>
                      {agent.isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs text-status-success">
                          <CheckCircle className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                          <XCircle className="h-3 w-3" /> Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      <ConnectionIcon method={agent.connectionMethod} />
                      <span>{connectionLabel(agent.connectionMethod)}</span>
                      <span className="text-text-dim">·</span>
                      <span className="capitalize">
                        {agent.triggerMode?.toLowerCase() || "mention"}
                      </span>
                      <span className="text-text-dim">·</span>
                      <span>
                        {new Date(agent.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="ml-2 flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => handleToggleActive(agent.id, agent.isActive)}
                    className={`text-xs ${
                      agent.isActive ? "text-text-muted" : "text-status-success"
                    }`}
                  >
                    {agent.isActive ? "Disable" : "Enable"}
                  </Button>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    className="rounded p-1.5 text-text-muted transition hover:bg-status-error/10 hover:text-status-error"
                    title="Delete agent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

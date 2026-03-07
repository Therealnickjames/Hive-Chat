"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Bot, CheckCircle, XCircle, Clock, Trash2 } from "lucide-react";

interface BotData {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: string;
  type: string;
  createdAt: string;
}

interface BotsSectionProps {
  serverId: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-status-success">
          <CheckCircle className="h-3 w-3" /> Active
        </span>
      );
    case "pending_approval":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-status-warning">
          <Clock className="h-3 w-3" /> Pending
        </span>
      );
    case "inactive":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          <XCircle className="h-3 w-3" /> Inactive
        </span>
      );
    default:
      return <span className="text-xs text-text-muted">{status}</span>;
  }
}

export function BotsSection({ serverId }: BotsSectionProps) {
  const [bots, setBots] = useState<BotData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchBots = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/bots`);
      if (res.ok) {
        const data = await res.json();
        setBots(
          Array.isArray(data?.bots)
            ? data.bots
            : Array.isArray(data)
              ? data
              : [],
        );
      }
    } catch {
      setError("Failed to load bots");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  async function handleApprove(botId: string) {
    setError("");
    try {
      const res = await fetch(
        `/api/servers/${serverId}/bots/${botId}/approve`,
        { method: "POST" },
      );
      if (res.ok) await fetchBots();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to approve bot");
      }
    } catch {
      setError("Something went wrong");
    }
  }

  async function handleReject(botId: string) {
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/bots/${botId}/reject`, {
        method: "POST",
      });
      if (res.ok) await fetchBots();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to reject bot");
      }
    } catch {
      setError("Something went wrong");
    }
  }

  async function handleDelete(botId: string) {
    if (!window.confirm("Delete this bot?")) return;
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/bots/${botId}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchBots();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete bot");
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
        Manage agents and bots in this server. To add new agents, use the Agents
        panel in the channel view.
      </p>

      {bots.length === 0 ? (
        <div className="py-8 text-center">
          <Bot className="mx-auto h-8 w-8 text-text-dim mb-2" />
          <p className="text-sm text-text-muted">No bots in this server yet.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className="rounded-lg bg-background-secondary px-3 py-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-purple/20 text-accent-purple text-sm font-bold">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {bot.name}
                      </span>
                      {statusBadge(bot.status)}
                    </div>
                    <p className="text-xs text-text-muted">
                      {bot.type} · Added{" "}
                      {new Date(bot.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {bot.status === "pending_approval" && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => handleApprove(bot.id)}
                        className="text-xs text-status-success"
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleReject(bot.id)}
                        className="text-xs text-status-error"
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(bot.id)}
                    className="rounded p-1.5 text-text-muted hover:text-status-error hover:bg-status-error/10 transition"
                    title="Delete bot"
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

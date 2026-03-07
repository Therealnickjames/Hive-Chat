"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Hash,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Pencil,
  Check,
  X,
} from "lucide-react";

interface ChannelData {
  id: string;
  name: string;
  type: string;
  topic: string | null;
  position: number;
}

interface ChannelsSectionProps {
  serverId: string;
}

export function ChannelsSection({ serverId }: ChannelsSectionProps) {
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTopic, setEditTopic] = useState("");

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}`);
      if (res.ok) {
        const data = await res.json();
        setChannels(
          (data.channels || []).sort(
            (a: ChannelData, b: ChannelData) => a.position - b.position,
          ),
        );
      }
    } catch {
      setError("Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create channel");
      }
      setNewName("");
      setShowCreate(false);
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(channelId: string) {
    if (!window.confirm("Delete this channel? All messages will be lost.")) {
      return;
    }
    setError("");
    try {
      const res = await fetch(
        `/api/servers/${serverId}/channels/${channelId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete channel");
      }
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete channel");
    }
  }

  async function handleSaveEdit(channelId: string) {
    setError("");
    try {
      const res = await fetch(
        `/api/servers/${serverId}/channels/${channelId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: editTopic.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update channel");
      }
      setEditingId(null);
      await fetchChannels();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update channel",
      );
    }
  }

  async function handleReorder(channelId: string, direction: "up" | "down") {
    const idx = channels.findIndex((c) => c.id === channelId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= channels.length) return;

    const reordered = [...channels];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    setChannels(reordered);

    try {
      await fetch(`/api/servers/${serverId}/channels/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelIds: reordered.map((c) => c.id) }),
      });
    } catch {
      await fetchChannels();
    }
  }

  function startEdit(channel: ChannelData) {
    setEditingId(channel.id);
    setEditName(channel.name);
    setEditTopic(channel.topic || "");
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

      {/* Create channel */}
      {showCreate ? (
        <div className="rounded-lg bg-background-secondary p-4">
          <p className="mb-3 text-sm font-semibold text-text-primary">
            New Channel
          </p>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="channel-name"
            maxLength={50}
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={handleCreate} loading={creating}>
              Create
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowCreate(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setShowCreate(true)} className="w-full">
          <Plus className="mr-1.5 h-4 w-4 inline" />
          Create Channel
        </Button>
      )}

      {/* Channel list */}
      <div className="space-y-1">
        {channels.map((channel, idx) => (
          <div
            key={channel.id}
            className="rounded-lg bg-background-secondary px-3 py-2.5"
          >
            {editingId === channel.id ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-text-muted shrink-0" />
                  <span className="text-sm font-medium text-text-primary">
                    {editName}
                  </span>
                </div>
                <Input
                  value={editTopic}
                  onChange={(e) => setEditTopic(e.target.value)}
                  placeholder="Channel topic (optional)"
                  maxLength={300}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(channel.id)}
                    className="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover transition"
                  >
                    <Check className="h-3 w-3 inline mr-1" />
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded px-2.5 py-1 text-xs text-text-muted hover:text-text-primary transition"
                  >
                    <X className="h-3 w-3 inline mr-1" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Hash className="h-4 w-4 text-text-muted shrink-0" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-primary">
                      {channel.name}
                    </span>
                    {channel.topic && (
                      <p className="text-xs text-text-muted truncate">
                        {channel.topic}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => handleReorder(channel.id, "up")}
                    disabled={idx === 0}
                    className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-background-floating transition disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleReorder(channel.id, "down")}
                    disabled={idx === channels.length - 1}
                    className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-background-floating transition disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => startEdit(channel)}
                    className="rounded p-1 text-text-muted hover:text-text-primary hover:bg-background-floating transition"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(channel.id)}
                    className="rounded p-1 text-text-muted hover:text-status-error hover:bg-status-error/10 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

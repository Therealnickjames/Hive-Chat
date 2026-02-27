"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useChatContext } from "@/components/providers/chat-provider";

interface Bot {
  id: string;
  name: string;
  llmProvider: string;
  llmModel: string;
}

interface ChannelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  channelName: string;
  currentDefaultBotId: string | null;
}

export function ChannelSettingsModal({
  isOpen,
  onClose,
  channelId,
  channelName,
  currentDefaultBotId,
}: ChannelSettingsModalProps) {
  const { currentServerId } = useChatContext();
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (isOpen) {
      fetchBots();
      setSelectedBotId(currentDefaultBotId || "");
      setError("");
    }
  }, [isOpen, fetchBots, currentDefaultBotId]);

  async function handleSave() {
    if (!currentServerId) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `/api/servers/${currentServerId}/channels/${channelId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            defaultBotId: selectedBotId || null,
          }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update channel");
        return;
      }

      onClose();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`#${channelName} Settings`}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-text-primary">
            Default Bot
          </label>
          <select
            value={selectedBotId}
            onChange={(e) => setSelectedBotId(e.target.value)}
            className="w-full rounded bg-background-primary px-3 py-2 text-sm text-text-primary border border-background-tertiary focus:border-brand focus:outline-none"
          >
            <option value="">None (no bot)</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name} ({bot.llmProvider}/{bot.llmModel})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            The bot will automatically respond to messages in this channel.
          </p>
        </div>

        {bots.length === 0 && (
          <p className="text-xs text-text-muted">
            No bots created yet. Use &quot;Manage Bots&quot; to create one first.
          </p>
        )}

        {error && <p className="text-sm text-status-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={loading}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

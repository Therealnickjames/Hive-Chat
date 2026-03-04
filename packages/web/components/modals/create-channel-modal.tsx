"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChatContext } from "@/components/providers/chat-provider";

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateChannelModal({
  isOpen,
  onClose,
}: CreateChannelModalProps) {
  const [step, setStep] = useState<"name" | "config">("name");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [channelType, setChannelType] = useState<"TEXT" | "ANNOUNCEMENT">(
    "TEXT",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { currentServerId, refreshChannels } = useChatContext();

  const resetModal = () => {
    setStep("name");
    setName("");
    setTopic("");
    setChannelType("TEXT");
    setError("");
    setLoading(false);
    onClose();
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (step === "name") {
      if (!name.trim()) {
        setError("Channel name is required");
        return;
      }
      setError("");
      setStep("config");
      return;
    }

    if (!name.trim() || !currentServerId) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/servers/${currentServerId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          topic: topic.trim() || null,
          type: channelType,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create channel");
        return;
      }

      const data = await res.json();
      await refreshChannels();
      resetModal();
      router.push(`/servers/${currentServerId}/channels/${data.id}`);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={resetModal} title="Create a Channel">
      <form onSubmit={handleSubmit}>
        {step === "name" ? (
          <>
            <Input
              label="Channel Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="new-channel"
              error={error}
              autoFocus
            />
            <p className="mt-1 text-xs text-text-muted">
              Channel names are lowercase with dashes instead of spaces.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={resetModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Configure
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase text-text-secondary">
                  Channel Type
                </label>
                <select
                  value={channelType}
                  onChange={(e) =>
                    setChannelType(
                      e.target.value === "ANNOUNCEMENT"
                        ? "ANNOUNCEMENT"
                        : "TEXT",
                    )
                  }
                  className="w-full rounded bg-background-tertiary px-3 py-2 text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand"
                >
                  <option value="TEXT">Text</option>
                  <option value="ANNOUNCEMENT">Announcement</option>
                </select>
              </div>
              <Input
                label="Topic (optional)"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What should this channel be used for?"
              />
              <div className="rounded border border-border bg-background-secondary px-3 py-2 text-xs text-text-muted">
                Permissions:{" "}
                <span className="text-text-primary">Server defaults</span>
              </div>
              {error && <p className="text-xs text-status-dnd">{error}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("name")}
              >
                Back
              </Button>
              <Button type="submit" loading={loading} disabled={!name.trim()}>
                Create Channel
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

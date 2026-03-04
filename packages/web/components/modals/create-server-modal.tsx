"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChatContext } from "@/components/providers/chat-provider";

interface CreateServerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateServerModal({ isOpen, onClose }: CreateServerModalProps) {
  const [step, setStep] = useState<"name" | "config">("name");
  const [name, setName] = useState("");
  const [defaultChannelName, setDefaultChannelName] = useState("general");
  const [defaultChannelTopic, setDefaultChannelTopic] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { refreshServers } = useChatContext();

  const resetModal = () => {
    setStep("name");
    setName("");
    setDefaultChannelName("general");
    setDefaultChannelTopic("");
    setError("");
    setLoading(false);
    onClose();
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (step === "name") {
      if (!name.trim()) {
        setError("Server name is required");
        return;
      }
      setError("");
      setStep("config");
      return;
    }

    if (!name.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          defaultChannelName: defaultChannelName.trim() || "general",
          defaultChannelTopic: defaultChannelTopic.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create server");
        return;
      }

      const data = await res.json();
      await refreshServers();
      resetModal();
      router.push(`/servers/${data.id}/channels/${data.defaultChannelId}`);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={resetModal} title="Create a Server">
      <form onSubmit={handleSubmit}>
        {step === "name" ? (
          <>
            <Input
              label="Server Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Server"
              error={error}
              autoFocus
            />
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
              <Input
                label="Default Channel Name"
                value={defaultChannelName}
                onChange={(e) => setDefaultChannelName(e.target.value)}
                placeholder="general"
              />
              <Input
                label="Default Channel Topic (optional)"
                value={defaultChannelTopic}
                onChange={(e) => setDefaultChannelTopic(e.target.value)}
                placeholder="Welcome to your new server"
              />
              <div className="rounded border border-border bg-background-secondary px-3 py-2 text-xs text-text-muted">
                Basic permissions preset:{" "}
                <span className="text-text-primary">Default member access</span>
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
                Create Server
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

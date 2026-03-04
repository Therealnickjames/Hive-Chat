"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useChatContext } from "@/components/providers/chat-provider";

interface InviteData {
  id: string;
  code: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
  creatorName: string;
  isExpired: boolean;
}

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InviteModal({ isOpen, onClose }: InviteModalProps) {
  const { currentServerId } = useChatContext();
  const [invites, setInvites] = useState<InviteData[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [expiresInHours, setExpiresInHours] = useState(168);
  const [maxUses, setMaxUses] = useState(0);

  const fetchInvites = useCallback(async () => {
    if (!currentServerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${currentServerId}/invites`);
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites || []);
      }
    } catch {
      console.error("Failed to fetch invites");
    } finally {
      setLoading(false);
    }
  }, [currentServerId]);

  useEffect(() => {
    if (isOpen) fetchInvites();
  }, [isOpen, fetchInvites]);

  async function handleCreate() {
    if (!currentServerId) return;
    setCreating(true);
    setError("");

    try {
      const res = await fetch(`/api/servers/${currentServerId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiresInHours: expiresInHours || null,
          maxUses: maxUses || null,
        }),
      });

      if (res.ok) {
        await fetchInvites();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create invite");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    if (!currentServerId) return;
    try {
      const res = await fetch(
        `/api/servers/${currentServerId}/invites/${inviteId}`,
        {
          method: "DELETE",
        },
      );
      if (res.ok) {
        setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
      }
    } catch {
      console.error("Failed to revoke invite");
    }
  }

  function copyLink(code: string) {
    const url = `${window.location.origin}/invite/${code}`;
    void navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  function formatExpiry(expiresAt: string | null, isExpired: boolean): string {
    if (!expiresAt) return "Never";
    if (isExpired) return "Expired";
    const date = new Date(expiresAt);
    const now = new Date();
    const hoursLeft = Math.round(
      (date.getTime() - now.getTime()) / (1000 * 60 * 60),
    );
    if (hoursLeft < 1) return "< 1 hour";
    if (hoursLeft < 24) return `${hoursLeft}h left`;
    const daysLeft = Math.round(hoursLeft / 24);
    return `${daysLeft}d left`;
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Server Invites">
      {error && (
        <div className="mb-4 rounded bg-status-dnd/10 px-3 py-2 text-sm text-status-dnd">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-lg bg-background-secondary p-4">
        <p className="mb-3 text-sm font-semibold text-text-primary">
          Create New Invite
        </p>
        <div className="mb-3 flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-bold uppercase text-text-muted">
              Expires
            </label>
            <select
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
              className="w-full rounded bg-background-tertiary px-3 py-2 text-sm text-text-primary outline-none"
            >
              <option value={1}>1 hour</option>
              <option value={24}>24 hours</option>
              <option value={168}>7 days</option>
              <option value={0}>Never</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-bold uppercase text-text-muted">
              Max Uses
            </label>
            <select
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
              className="w-full rounded bg-background-tertiary px-3 py-2 text-sm text-text-primary outline-none"
            >
              <option value={0}>Unlimited</option>
              <option value={1}>1 use</option>
              <option value={5}>5 uses</option>
              <option value={10}>10 uses</option>
              <option value={25}>25 uses</option>
              <option value={100}>100 uses</option>
            </select>
          </div>
        </div>
        <Button onClick={handleCreate} loading={creating} className="w-full">
          Generate Invite Link
        </Button>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase text-text-muted">
          Active Invites
        </p>

        {loading ? (
          <p className="py-4 text-center text-sm text-text-muted">Loading...</p>
        ) : invites.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">
            No active invites. Create one above.
          </p>
        ) : (
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className={`flex items-center justify-between rounded px-3 py-2 ${
                  invite.isExpired
                    ? "bg-background-tertiary/50 opacity-50"
                    : "bg-background-tertiary"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-text-primary">
                    {invite.code}
                  </p>
                  <p className="text-xs text-text-muted">
                    {invite.uses}
                    {invite.maxUses ? `/${invite.maxUses}` : ""} uses ·{" "}
                    {formatExpiry(invite.expiresAt, invite.isExpired)}
                  </p>
                </div>
                <div className="ml-2 flex gap-1">
                  {!invite.isExpired && (
                    <button
                      onClick={() => copyLink(invite.code)}
                      className="rounded px-2 py-1 text-xs text-text-muted transition hover:bg-background-primary hover:text-text-primary"
                    >
                      {copiedCode === invite.code ? "Copied!" : "Copy"}
                    </button>
                  )}
                  <button
                    onClick={() => handleRevoke(invite.id)}
                    className="rounded px-2 py-1 text-xs text-status-dnd transition hover:bg-status-dnd/10"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

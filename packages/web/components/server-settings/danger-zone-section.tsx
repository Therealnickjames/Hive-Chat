"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface MemberOption {
  id: string;
  userId: string;
  displayName: string;
  username: string;
}

interface DangerZoneSectionProps {
  serverId: string;
  serverName: string;
  isOwner: boolean;
  onClose: () => void;
}

export function DangerZoneSection({
  serverId,
  serverName,
  isOwner,
  onClose,
}: DangerZoneSectionProps) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [error, setError] = useState("");

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(
          (data.members || []).filter(
            (m: MemberOption & { isOwner: boolean }) => !m.isOwner,
          ),
        );
      }
    } catch {
      console.error("[DangerZone] Failed to load members");
      return;
    }
  }, [serverId]);

  useEffect(() => {
    if (isOwner) fetchMembers();
  }, [isOwner, fetchMembers]);

  async function handleTransfer() {
    if (!transferTarget) return;
    if (
      !window.confirm(
        "Transfer server ownership? You will lose all owner privileges. This cannot be undone.",
      )
    )
      return;

    setTransferring(true);
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId: transferTarget }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to transfer ownership");
      }
      onClose();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to transfer");
    } finally {
      setTransferring(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirm !== serverName) return;
    if (
      !window.confirm(
        "This is your final confirmation. Delete this server permanently?",
      )
    )
      return;

    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete server");
      }
      onClose();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete server");
    } finally {
      setDeleting(false);
    }
  }

  if (!isOwner) {
    return (
      <div className="rounded-lg border-2 border-status-error/30 bg-status-error/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-status-error mb-3" />
        <p className="text-sm text-text-secondary">
          Only the server owner can access danger zone settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </div>
      )}

      {/* Transfer Ownership */}
      <div className="rounded-lg border-2 border-status-warning/30 bg-status-warning/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-status-warning" />
          <h4 className="text-sm font-semibold text-text-primary">
            Transfer Ownership
          </h4>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Transfer this server to another member. You will lose all owner
          privileges. This action cannot be undone.
        </p>
        <div className="flex gap-2">
          <select
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            className="flex-1 rounded bg-background-tertiary px-3 py-2 text-sm text-text-primary outline-none"
          >
            <option value="">Select a member...</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName} (@{m.username})
              </option>
            ))}
          </select>
          <Button
            onClick={handleTransfer}
            loading={transferring}
            disabled={!transferTarget}
            className="bg-status-warning hover:bg-status-warning/80 text-background-primary"
          >
            Transfer
          </Button>
        </div>
      </div>

      {/* Delete Server */}
      <div className="rounded-lg border-2 border-status-error/30 bg-status-error/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-status-error" />
          <h4 className="text-sm font-semibold text-text-primary">
            Delete Server
          </h4>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Permanently delete this server, including all channels, messages, and
          agents. This action is irreversible.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder="Type server name to confirm"
            className="flex-1 rounded bg-background-tertiary px-3 py-2 text-sm text-text-primary outline-none ring-1 ring-transparent transition focus:ring-status-error"
            data-testid="settings-delete-confirm-input"
          />
          <Button
            onClick={handleDelete}
            loading={deleting}
            disabled={deleteConfirm !== serverName}
            className="bg-status-error hover:bg-status-error/80 text-white"
            data-testid="settings-delete-server-btn"
          >
            Delete Server
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

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

interface InvitesSectionProps {
  serverId: string;
}

export function InvitesSection({ serverId }: InvitesSectionProps) {
  const [invites, setInvites] = useState<InviteData[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [maxUses, setMaxUses] = useState(0);

  const fetchInvites = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/invites`);
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites || []);
      }
    } catch {
      setError("Failed to load invites");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  async function handleCreate() {
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/invites`, {
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
    try {
      const res = await fetch(`/api/servers/${serverId}/invites/${inviteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
      }
    } catch {
      setError("Failed to revoke invite");
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
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </div>
      )}

      {/* Create invite form */}
      <div className="rounded-lg bg-background-secondary p-4">
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
        <Button
          onClick={handleCreate}
          loading={creating}
          className="w-full"
          data-testid="settings-create-invite-btn"
        >
          Generate Invite Link
        </Button>
      </div>

      {/* Active invites */}
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
          <div className="space-y-1">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${
                  invite.isExpired
                    ? "bg-background-secondary/50 opacity-50"
                    : "bg-background-secondary"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-text-primary">
                    {invite.code}
                  </p>
                  <p className="text-xs text-text-muted">
                    {invite.uses}
                    {invite.maxUses ? `/${invite.maxUses}` : ""} uses ·{" "}
                    {formatExpiry(invite.expiresAt, invite.isExpired)} · by{" "}
                    {invite.creatorName}
                  </p>
                </div>
                <div className="ml-2 flex gap-1">
                  {!invite.isExpired && (
                    <button
                      onClick={() => copyLink(invite.code)}
                      className="rounded px-2 py-1 text-xs text-text-muted transition hover:bg-background-floating hover:text-text-primary"
                    >
                      {copiedCode === invite.code ? "Copied!" : "Copy"}
                    </button>
                  )}
                  <button
                    onClick={() => handleRevoke(invite.id)}
                    className="rounded px-2 py-1 text-xs text-status-error transition hover:bg-status-error/10"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

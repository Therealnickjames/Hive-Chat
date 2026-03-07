"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { passthroughImageLoader } from "@/lib/image-loader";
import { Shield, Crown, X } from "lucide-react";

interface MemberData {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  joinedAt: string;
  roles: { id: string; name: string; color: string | null }[];
  isOwner: boolean;
}

interface RoleData {
  id: string;
  name: string;
  color: string | null;
  isEveryone: boolean;
}

interface MembersSectionProps {
  serverId: string;
}

export function MembersSection({ serverId }: MembersSectionProps) {
  const [members, setMembers] = useState<MemberData[]>([]);
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberRoleIds, setMemberRoleIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, rolesRes] = await Promise.all([
        fetch(`/api/servers/${serverId}/members`),
        fetch(`/api/servers/${serverId}/roles`),
      ]);

      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members || []);
      }
      if (rolesRes.ok) {
        const data = await rolesRes.json();
        setRoles((data.roles || []).filter((r: RoleData) => !r.isEveryone));
      }
    } catch {
      setError("Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function startEditRoles(member: MemberData) {
    setEditingMemberId(member.id);
    setMemberRoleIds(new Set(member.roles.map((r) => r.id)));
  }

  async function saveRoles(memberId: string) {
    setError("");
    try {
      const res = await fetch(
        `/api/servers/${serverId}/members/${memberId}/roles`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleIds: Array.from(memberRoleIds) }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update roles");
      }
      setEditingMemberId(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update roles");
    }
  }

  async function handleKick(memberId: string, displayName: string) {
    if (!window.confirm(`Kick ${displayName} from the server?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/members/${memberId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to kick member");
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to kick member");
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
        {members.length} {members.length === 1 ? "member" : "members"}
      </p>

      <div className="space-y-1">
        {members.map((member) => (
          <div
            key={member.id}
            className="rounded-lg bg-background-secondary px-3 py-2.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white overflow-hidden">
                  {member.avatarUrl ? (
                    <Image
                      src={member.avatarUrl}
                      alt=""
                      loader={passthroughImageLoader}
                      unoptimized
                      width={32}
                      height={32}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    member.displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {member.displayName}
                    </span>
                    {member.isOwner && (
                      <Crown className="h-3.5 w-3.5 text-status-warning shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>@{member.username}</span>
                    {member.roles.length > 0 && (
                      <div className="flex gap-1">
                        {member.roles.map((role) => (
                          <span
                            key={role.id}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: role.color
                                ? `${role.color}20`
                                : undefined,
                              color: role.color || undefined,
                            }}
                          >
                            {role.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button
                  onClick={() => startEditRoles(member)}
                  className="rounded p-1.5 text-text-muted hover:text-text-primary hover:bg-background-floating transition"
                  title="Edit roles"
                >
                  <Shield className="h-3.5 w-3.5" />
                </button>
                {!member.isOwner && (
                  <button
                    onClick={() => handleKick(member.id, member.displayName)}
                    className="rounded p-1.5 text-text-muted hover:text-status-error hover:bg-status-error/10 transition"
                    title="Kick member"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Role editor */}
            {editingMemberId === member.id && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs font-bold uppercase text-text-muted mb-2">
                  Assign Roles
                </p>
                <div className="space-y-1">
                  {roles.map((role) => (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background-floating"
                    >
                      <input
                        type="checkbox"
                        checked={memberRoleIds.has(role.id)}
                        onChange={() => {
                          const next = new Set(memberRoleIds);
                          if (next.has(role.id)) next.delete(role.id);
                          else next.add(role.id);
                          setMemberRoleIds(next);
                        }}
                        className="accent-brand"
                      />
                      <div className="flex items-center gap-1.5">
                        {role.color && (
                          <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: role.color }}
                          />
                        )}
                        <span className="text-sm text-text-primary">
                          {role.name}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => saveRoles(member.id)}
                    className="rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover transition"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingMemberId(null)}
                    className="rounded px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition"
                  >
                    Cancel
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

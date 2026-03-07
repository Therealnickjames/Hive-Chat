"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PERMISSION_INFO,
  deserializePermissions,
  serializePermissions,
  hasPermission as checkPermissionBit,
} from "@/lib/permissions";

interface RoleData {
  id: string;
  name: string;
  color: string | null;
  permissions: string;
  position: number;
  memberCount: number;
  isEveryone: boolean;
}

interface RolesSectionProps {
  serverId: string;
}

function togglePermission(current: bigint, bit: bigint): bigint {
  if ((current & bit) === bit) return current & ~bit;
  return current | bit;
}

function PermissionToggles({
  permissions,
  onChange,
}: {
  permissions: bigint;
  onChange: (permissions: bigint) => void;
}) {
  return (
    <div className="mt-2 space-y-1">
      {PERMISSION_INFO.map((perm) => (
        <label
          key={perm.key}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background-primary"
        >
          <input
            type="checkbox"
            checked={checkPermissionBit(permissions, perm.bit)}
            onChange={() => onChange(togglePermission(permissions, perm.bit))}
            className="accent-brand"
          />
          <div>
            <span className="text-sm text-text-primary">{perm.label}</span>
            <span className="ml-2 text-xs text-text-muted">
              {perm.description}
            </span>
          </div>
        </label>
      ))}
    </div>
  );
}

export function RolesSection({ serverId }: RolesSectionProps) {
  const [roles, setRoles] = useState<RoleData[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleData | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newPermissions, setNewPermissions] = useState<bigint>(BigInt(0));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/roles`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles || []);
      }
    } catch {
      setError("Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          color: newColor || null,
          permissions: serializePermissions(newPermissions),
        }),
      });
      if (res.ok) {
        setNewName("");
        setNewColor("");
        setNewPermissions(BigInt(0));
        setShowCreate(false);
        await fetchRoles();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create role");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!editingRole) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/servers/${serverId}/roles/${editingRole.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editingRole.name,
            color: editingRole.color || null,
            permissions: editingRole.permissions,
          }),
        },
      );
      if (res.ok) {
        setEditingRole(null);
        await fetchRoles();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update role");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(roleId: string) {
    if (!window.confirm("Delete this role?")) return;
    try {
      const res = await fetch(`/api/servers/${serverId}/roles/${roleId}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchRoles();
    } catch {
      setError("Failed to delete role");
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

      {/* Create / Edit form */}
      {showCreate && (
        <div className="rounded-lg bg-background-secondary p-4">
          <p className="mb-3 text-sm font-semibold text-text-primary">
            New Role
          </p>
          <div className="mb-2 flex gap-2">
            <div className="flex-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Role name"
              />
            </div>
            <div className="w-20">
              <input
                type="color"
                value={newColor || "#99AAB5"}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-10 w-full cursor-pointer rounded bg-background-tertiary"
              />
            </div>
          </div>
          <PermissionToggles
            permissions={newPermissions}
            onChange={setNewPermissions}
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={handleCreate} loading={saving}>
              Create
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowCreate(false);
                setNewName("");
                setNewColor("");
                setNewPermissions(BigInt(0));
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {editingRole && (
        <div className="rounded-lg bg-background-secondary p-4">
          <p className="mb-3 text-sm font-semibold text-text-primary">
            Edit: {editingRole.name}
          </p>
          {!editingRole.isEveryone && (
            <div className="mb-2 flex gap-2">
              <div className="flex-1">
                <Input
                  value={editingRole.name}
                  onChange={(e) =>
                    setEditingRole({ ...editingRole, name: e.target.value })
                  }
                  placeholder="Role name"
                />
              </div>
              <div className="w-20">
                <input
                  type="color"
                  value={editingRole.color || "#99AAB5"}
                  onChange={(e) =>
                    setEditingRole({ ...editingRole, color: e.target.value })
                  }
                  className="h-10 w-full cursor-pointer rounded bg-background-tertiary"
                />
              </div>
            </div>
          )}
          <PermissionToggles
            permissions={deserializePermissions(editingRole.permissions)}
            onChange={(permissions) =>
              setEditingRole({
                ...editingRole,
                permissions: serializePermissions(permissions),
              })
            }
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={handleEdit} loading={saving}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditingRole(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!showCreate && !editingRole && (
        <>
          <Button onClick={() => setShowCreate(true)} className="w-full">
            Create Role
          </Button>

          <div className="space-y-1">
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex items-center justify-between rounded-lg bg-background-secondary px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {role.color && (
                    <div
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: role.color }}
                    />
                  )}
                  <span className="truncate text-sm text-text-primary">
                    {role.name}
                  </span>
                  <span className="text-xs text-text-muted">
                    {role.memberCount}{" "}
                    {role.memberCount === 1 ? "member" : "members"}
                  </span>
                </div>
                <div className="ml-2 flex gap-1">
                  <button
                    onClick={() => setEditingRole(role)}
                    className="rounded px-2 py-1 text-xs text-text-muted transition hover:bg-background-floating hover:text-text-primary"
                  >
                    Edit
                  </button>
                  {!role.isEveryone && (
                    <button
                      onClick={() => handleDelete(role.id)}
                      className="rounded px-2 py-1 text-xs text-status-error transition hover:bg-status-error/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

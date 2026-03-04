"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatContext } from "@/components/providers/chat-provider";
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

interface RoleManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function togglePermission(current: bigint, bit: bigint): bigint {
  if ((current & bit) === bit) {
    return current & ~bit;
  }

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
      {PERMISSION_INFO.map((permission) => (
        <label
          key={permission.key}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-background-primary"
        >
          <input
            type="checkbox"
            checked={checkPermissionBit(permissions, permission.bit)}
            onChange={() =>
              onChange(togglePermission(permissions, permission.bit))
            }
            className="accent-brand"
          />
          <div>
            <span className="text-sm text-text-primary">
              {permission.label}
            </span>
            <span className="ml-2 text-xs text-text-muted">
              {permission.description}
            </span>
          </div>
        </label>
      ))}
    </div>
  );
}

export function RoleManagementModal({
  isOpen,
  onClose,
}: RoleManagementModalProps) {
  const { currentServerId } = useChatContext();
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
    if (!currentServerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/servers/${currentServerId}/roles`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles || []);
      }
    } catch {
      console.error("Failed to fetch roles");
    } finally {
      setLoading(false);
    }
  }, [currentServerId]);

  useEffect(() => {
    if (isOpen) {
      void fetchRoles();
    }
  }, [isOpen, fetchRoles]);

  async function handleCreate() {
    if (!currentServerId || !newName.trim()) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/servers/${currentServerId}/roles`, {
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

  async function handleEdit(role: RoleData) {
    if (!currentServerId) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(
        `/api/servers/${currentServerId}/roles/${role.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editingRole?.name,
            color: editingRole?.color || null,
            permissions: editingRole?.permissions,
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
    if (!currentServerId) return;

    try {
      const res = await fetch(
        `/api/servers/${currentServerId}/roles/${roleId}`,
        {
          method: "DELETE",
        },
      );
      if (res.ok) {
        await fetchRoles();
      }
    } catch {
      console.error("Failed to delete role");
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Roles">
      {error && (
        <div className="mb-4 rounded bg-status-dnd/10 px-3 py-2 text-sm text-status-dnd">
          {error}
        </div>
      )}

      {!showCreate && !editingRole && (
        <Button onClick={() => setShowCreate(true)} className="mb-4 w-full">
          Create Role
        </Button>
      )}

      {showCreate && (
        <div className="mb-4 rounded-lg bg-background-secondary p-4">
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
        <div className="mb-4 rounded-lg bg-background-secondary p-4">
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
            <Button onClick={() => handleEdit(editingRole)} loading={saving}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditingRole(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!showCreate && !editingRole && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase text-text-muted">
            Roles
          </p>
          {loading ? (
            <p className="py-4 text-center text-sm text-text-muted">
              Loading...
            </p>
          ) : (
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center justify-between rounded bg-background-tertiary px-3 py-2"
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
                      className="rounded px-2 py-1 text-xs text-text-muted transition hover:bg-background-primary hover:text-text-primary"
                    >
                      Edit
                    </button>
                    {!role.isEveryone && (
                      <button
                        onClick={() => handleDelete(role.id)}
                        className="rounded px-2 py-1 text-xs text-status-dnd transition hover:bg-status-dnd/10"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passthroughImageLoader } from "@/lib/image-loader";
import { Camera, Trash2 } from "lucide-react";

interface OverviewSectionProps {
  serverId: string;
  onServerUpdated?: () => void;
}

export function OverviewSection({
  serverId,
  onServerUpdated,
}: OverviewSectionProps) {
  const [name, setName] = useState("");
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/servers/${serverId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) return;
        setName(data.name || "");
        setIconUrl(data.iconUrl || null);
        setOwnerId(data.ownerId || "");
        if (data.createdAt) {
          setCreatedAt(new Date(data.createdAt).toLocaleDateString());
        }
      })
      .catch(() => setError("Failed to load server info"));
  }, [serverId]);

  async function handleSave() {
    if (!name.trim()) {
      setError("Server name is required");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setSuccess("Server updated");
      onServerUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleIconUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed");
      }
      const { url } = await uploadRes.json();

      const patchRes = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iconUrl: url }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update icon");
      }

      setIconUrl(url);
      onServerUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveIcon() {
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iconUrl: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove icon");
      }
      setIconUrl(null);
      onServerUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove icon");
    }
  }

  return (
    <div className="space-y-6">
      {/* Server Icon */}
      <div>
        <label className="mb-2 block text-xs font-bold uppercase text-text-secondary">
          Server Icon
        </label>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-background-tertiary text-xl font-bold text-text-primary overflow-hidden">
            {iconUrl ? (
              <Image
                src={iconUrl}
                alt="Server Icon"
                loader={passthroughImageLoader}
                unoptimized
                width={64}
                height={64}
                className="h-full w-full object-cover"
              />
            ) : (
              name.charAt(0).toUpperCase() || "?"
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-sm"
            >
              <Camera className="mr-1.5 h-4 w-4 inline" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
            {iconUrl && (
              <Button
                variant="ghost"
                onClick={handleRemoveIcon}
                className="text-sm text-status-error hover:text-status-error"
              >
                <Trash2 className="mr-1.5 h-4 w-4 inline" />
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleIconUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Server Name */}
      <div className="space-y-4">
        <Input
          id="serverName"
          label="Server Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
        />

        {error && <p className="text-xs text-status-error">{error}</p>}
        {success && <p className="text-xs text-status-success">{success}</p>}

        <Button onClick={handleSave} loading={saving}>
          Save Changes
        </Button>
      </div>

      <div className="border-t border-border" />

      {/* Server Info */}
      <div className="space-y-2">
        <label className="block text-xs font-bold uppercase text-text-secondary">
          Server Info
        </label>
        <div className="rounded-lg bg-background-secondary p-3 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Server ID</span>
            <span className="text-text-primary font-mono text-xs">
              {serverId}
            </span>
          </div>
          {ownerId && (
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Owner ID</span>
              <span className="text-text-primary font-mono text-xs">
                {ownerId}
              </span>
            </div>
          )}
          {createdAt && (
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Created</span>
              <span className="text-text-primary text-xs">{createdAt}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

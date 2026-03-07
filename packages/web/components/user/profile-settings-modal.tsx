"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { passthroughImageLoader } from "@/lib/image-loader";
import { useTheme } from "@/components/providers/theme-provider";
import { Camera, Trash2, Sun, Moon } from "lucide-react";

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileUpdated: (data: {
    displayName?: string;
    email?: string;
    avatarUrl?: string | null;
    theme?: string;
  }) => void;
}

export function ProfileSettingsModal({
  isOpen,
  onClose,
  onProfileUpdated,
}: ProfileSettingsModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [success, setSuccess] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();

  // Fetch current profile on open
  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setPasswordError("");
    setSuccess("");
    setPasswordSuccess("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setAvatarUrlInput("");

    fetch("/api/users/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) return;
        setDisplayName(data.displayName || "");
        setEmail(data.email || "");
        setAvatarUrl(data.avatarUrl || null);
      })
      .catch(() => setError("Failed to load profile"));
  }, [isOpen]);

  async function handleAvatarUpload(file: File) {
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

      const patchRes = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update avatar");
      }

      setAvatarUrl(url);
      onProfileUpdated({ avatarUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleAvatarUrl() {
    if (!avatarUrlInput.trim()) return;
    const url = avatarUrlInput.trim();
    if (!url.startsWith("https://")) {
      setError("Avatar URL must start with https://");
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to set avatar URL");
      }
      setAvatarUrl(url);
      setAvatarUrlInput("");
      onProfileUpdated({ avatarUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set avatar");
    }
  }

  async function handleRemoveAvatar() {
    setError("");
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove avatar");
      }
      setAvatarUrl(null);
      onProfileUpdated({ avatarUrl: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove avatar");
    }
  }

  async function handleSaveProfile() {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save");
      }
      setSuccess("Profile updated");
      onProfileUpdated({ displayName: data.displayName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleThemeToggle() {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    try {
      await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: newTheme }),
      });
      onProfileUpdated({ theme: newTheme });
    } catch {
      // Theme already applied locally via ThemeProvider
    }
  }

  async function handleChangePassword() {
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to change password");
      }
      setPasswordSuccess("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Failed to change password",
      );
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Profile Settings" size="wide">
      <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
        {/* Avatar Section */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-text-secondary">
            Avatar
          </label>
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-border bg-background-tertiary text-xl font-bold text-text-primary overflow-hidden">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt="Avatar"
                    loader={passthroughImageLoader}
                    unoptimized
                    width={64}
                    height={64}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  displayName.charAt(0).toUpperCase() || "?"
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
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
                {avatarUrl && (
                  <Button
                    variant="ghost"
                    onClick={handleRemoveAvatar}
                    className="text-sm text-status-error hover:text-status-error"
                  >
                    <Trash2 className="mr-1.5 h-4 w-4 inline" />
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Or paste image URL..."
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  className="rounded bg-background-tertiary px-2 py-1 text-xs text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand w-48"
                />
                {avatarUrlInput && (
                  <button
                    onClick={handleAvatarUrl}
                    className="rounded bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-hover transition"
                  >
                    Set
                  </button>
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAvatarUpload(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="border-t border-border" />

        {/* General Section */}
        <div className="space-y-4">
          <Input
            id="displayName"
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
          />
          <div>
            <label className="mb-2 block text-xs font-bold uppercase text-text-secondary">
              Email
            </label>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={email}
                readOnly
                className="w-full rounded bg-background-tertiary px-3 py-2 text-text-muted outline-none cursor-not-allowed opacity-70"
              />
            </div>
            <p className="mt-1 text-xs text-text-dim">
              Email changes require confirmation — coming soon
            </p>
          </div>
          {error && <p className="text-xs text-status-error">{error}</p>}
          {success && <p className="text-xs text-status-success">{success}</p>}
          <Button onClick={handleSaveProfile} loading={saving}>
            Save Changes
          </Button>
        </div>

        <div className="border-t border-border" />

        {/* Theme Section */}
        <div>
          <label className="mb-3 block text-xs font-bold uppercase text-text-secondary">
            Theme
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (theme !== "dark") handleThemeToggle();
              }}
              className={`flex flex-1 items-center gap-3 rounded-lg border-2 p-3 transition-colors ${
                theme === "dark"
                  ? "border-brand bg-brand/10"
                  : "border-border hover:border-text-muted"
              }`}
            >
              <Moon className="h-5 w-5 text-text-secondary" />
              <div className="text-left">
                <div className="text-sm font-medium text-text-primary">Dark</div>
                <div className="text-xs text-text-muted">Default theme</div>
              </div>
            </button>
            <button
              onClick={() => {
                if (theme !== "light") handleThemeToggle();
              }}
              className={`flex flex-1 items-center gap-3 rounded-lg border-2 p-3 transition-colors ${
                theme === "light"
                  ? "border-brand bg-brand/10"
                  : "border-border hover:border-text-muted"
              }`}
            >
              <Sun className="h-5 w-5 text-text-secondary" />
              <div className="text-left">
                <div className="text-sm font-medium text-text-primary">Light</div>
                <div className="text-xs text-text-muted">Light theme</div>
              </div>
            </button>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Password Section */}
        <div className="space-y-4">
          <label className="block text-xs font-bold uppercase text-text-secondary">
            Change Password
          </label>
          <Input
            id="currentPassword"
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <Input
            id="newPassword"
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            id="confirmPassword"
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {passwordError && (
            <p className="text-xs text-status-error">{passwordError}</p>
          )}
          {passwordSuccess && (
            <p className="text-xs text-status-success">{passwordSuccess}</p>
          )}
          <Button
            onClick={handleChangePassword}
            loading={savingPassword}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Update Password
          </Button>
        </div>
      </div>
    </Modal>
  );
}

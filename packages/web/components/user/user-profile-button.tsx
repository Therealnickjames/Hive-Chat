"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { passthroughImageLoader } from "@/lib/image-loader";
import { ProfileSettingsModal } from "./profile-settings-modal";
import { Settings2, LogOut } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "online", label: "Online", color: "bg-status-online" },
  { value: "away", label: "Away", color: "bg-status-idle" },
  { value: "busy", label: "Do Not Disturb", color: "bg-status-dnd" },
  { value: "invisible", label: "Invisible", color: "bg-status-offline" },
] as const;

function statusColor(status: string) {
  switch (status) {
    case "online":
      return "bg-status-online";
    case "away":
      return "bg-status-idle";
    case "busy":
      return "bg-status-dnd";
    case "invisible":
      return "bg-status-offline";
    default:
      return "bg-status-online";
  }
}

export function UserProfileButton() {
  const { data: session, update } = useSession();
  const [showPopover, setShowPopover] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Outside click dismissal
  useEffect(() => {
    if (!showPopover) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showPopover]);

  const displayName = session?.user?.displayName || "User";
  const username = session?.user?.username || "user";
  const avatarUrl = session?.user?.avatarUrl;
  const currentStatus = session?.user?.status || "online";

  async function handleStatusChange(newStatus: string) {
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await update({ status: newStatus });
      }
    } catch {
      // Silently fail
    }
  }

  return (
    <>
      <div className="relative shrink-0 border-t border-border px-3 py-2">
        <button
          ref={buttonRef}
          onClick={() => setShowPopover(!showPopover)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-background-floating"
        >
          {/* Circular avatar with status indicator */}
          <div className="relative">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white overflow-hidden">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  loader={passthroughImageLoader}
                  unoptimized
                  width={32}
                  height={32}
                  className="h-full w-full object-cover"
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background-primary ${statusColor(currentStatus)}`}
            />
          </div>
          {/* Name + username */}
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium text-text-primary">
              {displayName}
            </div>
            <div className="truncate text-xs text-text-muted">@{username}</div>
          </div>
        </button>

        {/* Popover */}
        {showPopover && (
          <div
            ref={popoverRef}
            className="absolute bottom-full left-2 right-2 mb-2 rounded-lg border border-border bg-background-floating shadow-xl z-50"
          >
            {/* User info header */}
            <div className="flex items-center gap-3 px-3 py-3 border-b border-border">
              <div className="relative">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-white overflow-hidden">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt=""
                      loader={passthroughImageLoader}
                      unoptimized
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <div
                  className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background-floating ${statusColor(currentStatus)}`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">
                  {displayName}
                </div>
                <div className="truncate text-xs text-text-muted">
                  @{username}
                </div>
              </div>
            </div>

            {/* Status selector */}
            <div className="p-1.5 border-b border-border">
              <p className="px-2.5 py-1 text-[10px] font-bold uppercase text-text-muted tracking-wide">
                Status
              </p>
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    currentStatus === opt.value
                      ? "bg-background-secondary text-text-primary font-medium"
                      : "text-text-secondary hover:bg-background-secondary hover:text-text-primary"
                  }`}
                >
                  <div className={`h-2.5 w-2.5 rounded-full ${opt.color}`} />
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Menu items */}
            <div className="p-1.5">
              <button
                onClick={() => {
                  setShowPopover(false);
                  setShowSettings(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-background-secondary hover:text-text-primary"
              >
                <Settings2 className="h-4 w-4" />
                Edit Profile
              </button>
              <div className="my-1 border-t border-border" />
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-status-error transition-colors hover:bg-status-error/10"
              >
                <LogOut className="h-4 w-4" />
                Log Out
              </button>
            </div>
          </div>
        )}
      </div>

      <ProfileSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onProfileUpdated={(data) => update(data)}
      />
    </>
  );
}

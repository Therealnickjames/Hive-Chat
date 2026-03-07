"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { OverviewSection } from "./overview-section";
import { ChannelsSection } from "./channels-section";
import { RolesSection } from "./roles-section";
import { MembersSection } from "./members-section";
import { InvitesSection } from "./invites-section";
import { BotsSection } from "./bots-section";
import { DangerZoneSection } from "./danger-zone-section";

type SettingsTab =
  | "overview"
  | "channels"
  | "roles"
  | "members"
  | "invites"
  | "bots"
  | "danger";

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "channels", label: "Channels" },
  { key: "roles", label: "Roles" },
  { key: "members", label: "Members" },
  { key: "invites", label: "Invites" },
  { key: "bots", label: "Bots" },
  { key: "danger", label: "Danger Zone" },
];

interface ServerSettingsOverlayProps {
  serverId: string;
  serverName: string;
  isOwner: boolean;
  isOpen: boolean;
  onClose: () => void;
  onServerUpdated?: () => void;
}

export function ServerSettingsOverlay({
  serverId,
  serverName,
  isOwner,
  isOpen,
  onClose,
  onServerUpdated,
}: ServerSettingsOverlayProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("overview");

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset to overview when opened
  useEffect(() => {
    if (isOpen) setActiveTab("overview");
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-background-primary">
      {/* Left sidebar navigation */}
      <div className="w-56 shrink-0 border-r border-border bg-background-secondary flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-bold text-text-primary truncate">
            {serverName}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">Server Settings</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex w-full items-center rounded-md px-3 py-2 text-sm font-medium transition-colors mb-0.5 ${
                activeTab === tab.key
                  ? "bg-brand/10 text-brand"
                  : tab.key === "danger"
                    ? "text-status-error hover:bg-status-error/10"
                    : "text-text-secondary hover:bg-background-floating hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Right content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with close button */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <h3 className="text-lg font-bold text-text-primary">
            {TABS.find((t) => t.key === activeTab)?.label}
          </h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition hover:bg-background-secondary hover:text-text-primary"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl">
            {activeTab === "overview" && (
              <OverviewSection
                serverId={serverId}
                onServerUpdated={onServerUpdated}
              />
            )}
            {activeTab === "channels" && (
              <ChannelsSection serverId={serverId} />
            )}
            {activeTab === "roles" && <RolesSection serverId={serverId} />}
            {activeTab === "members" && <MembersSection serverId={serverId} />}
            {activeTab === "invites" && <InvitesSection serverId={serverId} />}
            {activeTab === "bots" && <BotsSection serverId={serverId} />}
            {activeTab === "danger" && (
              <DangerZoneSection
                serverId={serverId}
                isOwner={isOwner}
                onClose={onClose}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

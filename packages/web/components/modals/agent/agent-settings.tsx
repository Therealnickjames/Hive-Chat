"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";

interface AgentSettingsProps {
  serverId: string;
  onBack: () => void;
}

export function AgentSettings({ serverId, onBack }: AgentSettingsProps) {
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [requireApproval, setRequireApproval] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/agent-settings`);
      if (res.ok) {
        const data = await res.json();
        setAllowRegistration(data.allowAgentRegistration);
        setRequireApproval(data.registrationApprovalRequired);
      }
    } catch {
      setError("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  async function handleToggle(
    field: "allowAgentRegistration" | "registrationApprovalRequired",
    value: boolean,
  ) {
    setSaving(true);
    setError("");

    // Optimistic update
    if (field === "allowAgentRegistration") setAllowRegistration(value);
    if (field === "registrationApprovalRequired") setRequireApproval(value);

    try {
      const res = await fetch(`/api/servers/${serverId}/agent-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

      if (!res.ok) {
        // Revert on failure
        if (field === "allowAgentRegistration") setAllowRegistration(!value);
        if (field === "registrationApprovalRequired")
          setRequireApproval(!value);
        setError("Failed to update setting");
      }
    } catch {
      if (field === "allowAgentRegistration") setAllowRegistration(!value);
      if (field === "registrationApprovalRequired") setRequireApproval(!value);
      setError("Failed to update setting");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-text-muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-4 text-sm text-text-secondary">
          Control how external agents can register with this server.
        </p>

        {/* Allow Registration Toggle */}
        <div className="flex items-center justify-between rounded bg-background-primary p-4">
          <div>
            <p className="text-sm font-medium text-text-primary">
              Allow External Agent Registration
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              When enabled, agents can self-register via the API using your
              server ID
            </p>
          </div>
          <Toggle
            enabled={allowRegistration}
            onChange={(v) => handleToggle("allowAgentRegistration", v)}
            disabled={saving}
          />
        </div>

        {/* Require Approval Toggle */}
        {allowRegistration && (
          <div className="mt-3 flex items-center justify-between rounded bg-background-primary p-4">
            <div>
              <p className="text-sm font-medium text-text-primary">
                Require Approval
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                New self-registered agents must be approved before they can
                participate
              </p>
            </div>
            <Toggle
              enabled={requireApproval}
              onChange={(v) => handleToggle("registrationApprovalRequired", v)}
              disabled={saving}
            />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-status-danger">{error}</p>}

      <div className="flex justify-start">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
      </div>
    </div>
  );
}

// ─── Toggle component ───

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-accent-cyan focus:ring-offset-2 focus:ring-offset-background-floating disabled:opacity-50 disabled:cursor-not-allowed ${
        enabled ? "bg-accent-cyan" : "bg-background-tertiary"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useChatContext } from "@/components/providers/chat-provider";

interface Agent {
  id: string;
  name: string;
  llmProvider: string;
  llmModel: string;
}

// TASK-0020: Swarm mode options
const SWARM_MODES = [
  {
    value: "HUMAN_IN_THE_LOOP",
    label: "Human in the Loop",
    description: "Agents only respond when mentioned or triggered",
  },
  {
    value: "LEAD_AGENT",
    label: "Lead Agent",
    description: "One agent leads, others assist when asked",
  },
  {
    value: "ROUND_ROBIN",
    label: "Round Robin",
    description: "Agents take turns in defined order",
  },
  {
    value: "STRUCTURED_DEBATE",
    label: "Structured Debate",
    description: "Agents present opposing viewpoints",
  },
  {
    value: "CODE_REVIEW_SPRINT",
    label: "Code Review Sprint",
    description: "Sequential code review pattern",
  },
  {
    value: "FREEFORM",
    label: "Freeform",
    description: "Any agent can respond anytime",
  },
  {
    value: "CUSTOM",
    label: "Custom",
    description: "User-defined rules via charter text",
  },
] as const;

interface ChannelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  channelName: string;
  currentAgentIds?: string[];
  currentDefaultAgentId: string | null;
}

export function ChannelSettingsModal({
  isOpen,
  onClose,
  channelId,
  channelName,
  currentAgentIds,
  currentDefaultAgentId,
}: ChannelSettingsModalProps) {
  const { currentServerId } = useChatContext();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // TASK-0020: Swarm mode state
  const [swarmMode, setSwarmMode] = useState("HUMAN_IN_THE_LOOP");
  const [charterGoal, setCharterGoal] = useState("");
  const [charterRules, setCharterRules] = useState("");
  const [charterMaxTurns, setCharterMaxTurns] = useState(0);

  const fetchAgents = useCallback(async () => {
    if (!currentServerId) return;
    try {
      const res = await fetch(`/api/servers/${currentServerId}/agents`);
      if (res.ok) {
        const data = await res.json();
        const nextAgents = Array.isArray(data?.agents)
          ? data.agents
          : Array.isArray(data)
            ? data
            : [];
        setAgents(nextAgents);
      }
    } catch {
      console.error("Failed to fetch agents");
    }
  }, [currentServerId]);

  // Fetch channel charter data on open
  const fetchChannelData = useCallback(async () => {
    if (!currentServerId || !channelId) return;
    try {
      const res = await fetch(
        `/api/servers/${currentServerId}/channels/${channelId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setSwarmMode(data.swarmMode || "HUMAN_IN_THE_LOOP");
        setCharterGoal(data.charterGoal || "");
        setCharterRules(data.charterRules || "");
        setCharterMaxTurns(data.charterMaxTurns || 0);
      }
    } catch {
      // Silently fail — defaults are fine
    }
  }, [currentServerId, channelId]);

  useEffect(() => {
    if (isOpen) {
      fetchAgents();
      fetchChannelData();
      // Initialize from currentAgentIds or fall back to single defaultAgentId
      if (currentAgentIds && currentAgentIds.length > 0) {
        setSelectedAgentIds(new Set(currentAgentIds));
      } else if (currentDefaultAgentId) {
        setSelectedAgentIds(new Set([currentDefaultAgentId]));
      } else {
        setSelectedAgentIds(new Set());
      }
      setError("");
    }
  }, [
    isOpen,
    fetchAgents,
    fetchChannelData,
    currentAgentIds,
    currentDefaultAgentId,
  ]);

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!currentServerId) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `/api/servers/${currentServerId}/channels/${channelId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentIds: Array.from(selectedAgentIds),
            swarmMode,
            charterGoal: charterGoal || null,
            charterRules: charterRules || null,
            charterMaxTurns,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update channel");
        return;
      }

      onClose();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`#${channelName} Settings`}>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-text-primary">
            Channel Agents
          </label>
          <p className="mb-3 text-xs text-text-muted">
            Select one or more agents to respond in this channel. Multiple
            agents can stream simultaneously.
          </p>

          {agents.length === 0 ? (
            <p className="text-xs text-text-muted py-2">
              No agents created yet. Use &quot;Manage Agents&quot; to create one
              first.
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {agents.map((agent) => (
                <label
                  key={agent.id}
                  className={`flex items-center gap-3 rounded px-3 py-2 cursor-pointer transition-colors ${
                    selectedAgentIds.has(agent.id)
                      ? "bg-accent-cyan/10 border border-accent-cyan/30"
                      : "bg-background-primary border border-background-tertiary hover:border-text-dim"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgentIds.has(agent.id)}
                    onChange={() => toggleAgent(agent.id)}
                    className="rounded border-text-dim text-accent-cyan focus:ring-accent-cyan"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-mono text-text-primary">
                      {agent.name}
                    </span>
                    <span className="ml-2 text-[10px] text-text-muted">
                      {agent.llmProvider}/{agent.llmModel}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* TASK-0020: Swarm Mode Settings — only visible when 2+ agents selected */}
        {selectedAgentIds.size >= 2 && (
          <div className="border-t border-background-tertiary pt-4">
            <label className="mb-2 block text-sm font-medium text-text-primary">
              Swarm Mode
            </label>
            <p className="mb-3 text-xs text-text-muted">
              Choose how agents collaborate when multiple are active.
            </p>

            <select
              value={swarmMode}
              onChange={(e) => setSwarmMode(e.target.value)}
              className="w-full rounded border border-background-tertiary bg-background-primary px-3 py-2 text-sm text-text-primary focus:border-accent-cyan focus:outline-none"
            >
              {SWARM_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-text-muted">
              {SWARM_MODES.find((m) => m.value === swarmMode)?.description}
            </p>

            {/* Goal */}
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Goal
              </label>
              <input
                type="text"
                value={charterGoal}
                onChange={(e) => setCharterGoal(e.target.value)}
                placeholder="What should the agents accomplish?"
                className="w-full rounded border border-background-tertiary bg-background-primary px-3 py-2 text-sm text-text-primary placeholder-text-dim focus:border-accent-cyan focus:outline-none"
              />
            </div>

            {/* Rules */}
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Rules
              </label>
              <textarea
                value={charterRules}
                onChange={(e) => setCharterRules(e.target.value)}
                placeholder="Custom rules for agents to follow..."
                rows={3}
                className="w-full rounded border border-background-tertiary bg-background-primary px-3 py-2 text-sm text-text-primary placeholder-text-dim focus:border-accent-cyan focus:outline-none resize-none"
              />
            </div>

            {/* Max turns */}
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Max Turns
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={charterMaxTurns}
                  onChange={(e) =>
                    setCharterMaxTurns(
                      Math.max(0, parseInt(e.target.value) || 0),
                    )
                  }
                  className="w-20 rounded border border-background-tertiary bg-background-primary px-3 py-2 text-sm text-text-primary focus:border-accent-cyan focus:outline-none"
                />
                <span className="text-xs text-text-muted">
                  {charterMaxTurns === 0
                    ? "Unlimited"
                    : `${charterMaxTurns} turns`}
                </span>
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-status-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={loading}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

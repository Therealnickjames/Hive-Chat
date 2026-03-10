"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useChatContext } from "@/components/providers/chat-provider";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { ManageAgentsModal } from "@/components/modals/manage-agents-modal";
import { Permissions } from "@/lib/permissions";
import { Bot, Cpu, Users, Zap, Settings2 } from "lucide-react";

interface AgentInfo {
  id: string;
  name: string;
  isStreaming: boolean;
  llmModel?: string;
  thinkingSteps?: string[];
}

export function RightPanel() {
  const {
    members,
    currentServerOwnerId,
    serverDataById,
    ensureServerScopedData,
    hasPermission,
  } = useChatContext();
  const { panels, activeStreams } = useWorkspaceContext();
  const [showManageAgents, setShowManageAgents] = useState(false);

  const openPanels = useMemo(() => panels.filter((p) => !p.isClosed), [panels]);
  const openServerIds = useMemo(
    () => Array.from(new Set(openPanels.map((p) => p.serverId))).sort(),
    [openPanels],
  );

  useEffect(() => {
    openServerIds.forEach((serverId) => {
      void ensureServerScopedData(serverId);
    });
  }, [openServerIds, ensureServerScopedData]);

  const agentList = useMemo(() => {
    const agentById = new Map<string, AgentInfo>();

    for (const panel of openPanels) {
      const scoped = serverDataById[panel.serverId];
      if (!scoped) continue;

      const channel = scoped.channels.find((c) => c.id === panel.channelId);
      if (!channel) continue;

      const agentIds = channel.agentIds?.length
        ? channel.agentIds
        : channel.defaultAgentId
          ? [channel.defaultAgentId]
          : [];

      const isStreaming = activeStreams.has(panel.channelId);

      for (const agentId of agentIds) {
        const agent = scoped.agents.find((b) => b.id === agentId);
        if (!agent) continue;

        let steps: string[] | undefined;
        if (agent.thinkingSteps) {
          try {
            steps = JSON.parse(agent.thinkingSteps);
          } catch {
            // Ignore invalid serialized steps.
          }
        }

        const existing = agentById.get(agent.id);
        if (existing) {
          existing.isStreaming = existing.isStreaming || isStreaming;
        } else {
          agentById.set(agent.id, {
            id: agent.id,
            name: agent.name,
            isStreaming,
            llmModel: agent.llmModel,
            thinkingSteps: steps,
          });
        }
      }
    }

    return Array.from(agentById.values());
  }, [openPanels, serverDataById, activeStreams]);

  const taskList = useMemo(() => {
    const tasks: { label: string; agentName: string; isActive: boolean }[] = [];
    for (const agent of agentList) {
      if (!agent.thinkingSteps?.length) continue;
      for (const step of agent.thinkingSteps) {
        tasks.push({
          label: step,
          agentName: agent.name,
          isActive: agent.isStreaming,
        });
      }
    }
    return tasks;
  }, [agentList]);

  const modelList = useMemo(() => {
    const models = new Map<string, string>();
    for (const panel of openPanels) {
      const scoped = serverDataById[panel.serverId];
      if (!scoped) continue;
      for (const agent of scoped.agents) {
        if (agent.llmModel && !models.has(agent.llmModel)) {
          models.set(agent.llmModel, agent.name);
        }
      }
    }
    return Array.from(models.entries()).map(([model, agentName]) => ({
      model,
      agentName,
    }));
  }, [openPanels, serverDataById]);

  return (
    <div className="chrome-panel flex h-full flex-col rounded-[28px] overflow-hidden">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="chrome-card rounded-[24px] p-4">
          <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.12em] text-text-muted">
              <Bot className="h-4 w-4 text-brand" />
              AGENTS
            </div>
            {hasPermission(Permissions.MANAGE_AGENTS) && (
              <button
                onClick={() => setShowManageAgents(true)}
                className="rounded-lg p-1 text-text-muted transition-colors hover:bg-background-floating/60 hover:text-brand"
                title="Manage Agents"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-2">
            {agentList.length === 0 ? (
              <div className="py-2 text-sm text-text-muted">
                No agents active
              </div>
            ) : (
              agentList.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between rounded-2xl border border-white/6 bg-background-floating/42 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        agent.isStreaming
                          ? "bg-accent-green shadow-[0_0_14px_rgba(41,211,145,0.55)]"
                          : "bg-status-offline"
                      }`}
                    />
                    <span className="truncate font-medium text-text-primary">
                      {agent.name}
                    </span>
                  </div>
                  {agent.isStreaming ? (
                    <div className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.12em] text-accent-green">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-green" />
                      LIVE
                    </div>
                  ) : (
                    <span className="text-[10px] font-semibold tracking-[0.12em] text-text-dim">
                      IDLE
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="chrome-card rounded-[24px] p-4">
          <div className="mb-4 flex items-center gap-2 border-b border-border/60 pb-3 text-[11px] font-semibold tracking-[0.12em] text-text-muted">
            <Zap className="h-4 w-4 text-accent-green" />
            TASKS
            <span className="ml-1 font-normal normal-case tracking-normal text-text-dim">
              (Coming Soon)
            </span>
          </div>
          <div className="space-y-3">
            {taskList.length === 0 ? (
              <div className="text-sm text-text-muted">
                No thinking steps configured
              </div>
            ) : (
              taskList.map((task, i) => (
                <div
                  key={`${task.agentName}-${task.label}-${i}`}
                  className="rounded-2xl border border-white/6 bg-background-floating/34 px-3 py-2.5"
                >
                  <div
                    className={`text-sm font-medium ${
                      task.isActive ? "text-text-primary" : "text-text-muted"
                    }`}
                  >
                    {task.label}
                  </div>
                  <div className="mt-1 text-[11px] text-text-muted">
                    @{task.agentName.toLowerCase()}{" "}
                    {task.isActive ? "- active" : "- ready"}
                  </div>
                  {task.isActive && (
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-background-tertiary">
                      <div
                        className="h-full rounded-full bg-accent-green"
                        style={{ width: "60%" }}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="chrome-card rounded-[24px] p-4">
          <div className="mb-4 flex items-center gap-2 border-b border-border/60 pb-3 text-[11px] font-semibold tracking-[0.12em] text-text-muted">
            <Users className="h-4 w-4 text-accent-cyan" />
            MEMBERS
          </div>
          <div className="space-y-2">
            {members.length === 0 ? (
              <div className="text-sm text-text-muted">No members</div>
            ) : (
              members.map((member) => {
                const isOwner = member.userId === currentServerOwnerId;
                return (
                  <div
                    key={member.userId}
                    className="flex items-center gap-2.5 rounded-2xl border border-white/6 bg-background-floating/34 px-3 py-2 text-sm"
                  >
                    <div className="h-2 w-2 shrink-0 rounded-full bg-accent-green shadow-[0_0_12px_rgba(41,211,145,0.45)]" />
                    <span className="truncate font-medium text-text-primary">
                      {member.displayName}
                    </span>
                    {isOwner && (
                      <span className="ml-auto shrink-0 rounded-full border border-brand/20 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-orange-100">
                        Owner
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="chrome-card rounded-[24px] p-4">
          <div className="mb-4 flex items-center gap-2 border-b border-border/60 pb-3 text-[11px] font-semibold tracking-[0.12em] text-text-muted">
            <Cpu className="h-4 w-4 text-brand" />
            MODELS
          </div>
          <div className="space-y-2 text-sm">
            {modelList.length === 0 ? (
              <div className="text-sm text-text-muted">
                No models configured
              </div>
            ) : (
              modelList.map(({ model, agentName }) => (
                <div
                  key={model}
                  className="flex items-center justify-between rounded-2xl border border-white/6 bg-background-floating/34 px-3 py-2"
                >
                  <span className="truncate font-mono text-xs text-text-secondary">
                    {model}
                  </span>
                  <span className="ml-2 shrink-0 text-[11px] font-medium text-text-muted">
                    {agentName}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ManageAgentsModal
        isOpen={showManageAgents}
        onClose={() => setShowManageAgents(false)}
      />
    </div>
  );
}

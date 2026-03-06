"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useChatContext } from "@/components/providers/chat-provider";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { ManageBotsModal } from "@/components/modals/manage-bots-modal";
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

      const botIds = channel.botIds?.length
        ? channel.botIds
        : channel.defaultBotId
          ? [channel.defaultBotId]
          : [];

      const isStreaming = activeStreams.has(panel.channelId);

      for (const botId of botIds) {
        const agent = scoped.bots.find((b) => b.id === botId);
        if (!agent) continue;

        let steps: string[] | undefined;
        if (agent.thinkingSteps) {
          try {
            steps = JSON.parse(agent.thinkingSteps);
          } catch {
            /* ignore */
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
    const models = new Map<string, string>(); // model -> botName
    for (const panel of openPanels) {
      const scoped = serverDataById[panel.serverId];
      if (!scoped) continue;
      for (const bot of scoped.bots) {
        if (bot.llmModel && !models.has(bot.llmModel)) {
          models.set(bot.llmModel, bot.name);
        }
      }
    }
    return Array.from(models.entries()).map(([model, botName]) => ({
      model,
      botName,
    }));
  }, [openPanels, serverDataById]);

  return (
    <div className="flex flex-col border-l border-border bg-background-primary h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        {/* Agents */}
        <div>
          <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-text-muted">
              <Bot className="h-4 w-4" />
              AGENTS
            </div>
            {hasPermission(Permissions.MANAGE_BOTS) && (
              <button
                onClick={() => setShowManageAgents(true)}
                className="text-text-muted hover:text-brand transition-colors p-1 rounded hover:bg-background-floating"
                title="Manage Agents"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-1">
            {agentList.length === 0 ? (
              <div className="text-sm text-text-muted py-2">
                No agents active
              </div>
            ) : (
              agentList.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between text-sm rounded-md px-2 py-1.5 bg-background-floating border border-border/50"
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 shadow-sm ${agent.isStreaming ? "bg-brand animate-pulse shadow-[0_0_8px_rgba(14,165,233,0.6)]" : "bg-status-offline"}`}
                    />
                    <span className="text-text-primary font-medium truncate">
                      {agent.name}
                    </span>
                  </div>
                  {agent.isStreaming ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="flex gap-1">
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-brand animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-brand animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-brand animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-text-dim font-bold tracking-wide shrink-0">
                      IDLE
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tasks */}
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-text-muted mb-3 border-b border-border pb-2">
            <Zap className="h-4 w-4" />
            TASKS{" "}
            <span className="font-normal normal-case text-text-dim ml-1">
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
                  className={`border-l-2 pl-3 py-0.5 ${
                    task.isActive ? "border-brand" : "border-border"
                  }`}
                >
                  <div
                    className={`text-sm font-medium ${task.isActive ? "text-text-primary" : "text-text-muted"}`}
                  >
                    {task.label}
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    @{task.agentName.toLowerCase()}{" "}
                    {task.isActive ? "• active" : "• ready"}
                  </div>
                  {task.isActive && (
                    <div className="mt-2 h-1 w-full bg-background-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand animate-pulse"
                        style={{ width: "60%" }}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Members */}
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-text-muted mb-3 border-b border-border pb-2">
            <Users className="h-4 w-4" />
            MEMBERS
          </div>
          <div className="space-y-1.5">
            {members.length === 0 ? (
              <div className="text-sm text-text-muted">No members</div>
            ) : (
              members.map((member) => {
                const isOwner = member.userId === currentServerOwnerId;
                return (
                  <div
                    key={member.userId}
                    className="flex items-center gap-2.5 text-sm px-2 py-1"
                  >
                    <div className="h-2 w-2 rounded-full bg-status-online shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                    <span className="text-text-primary font-medium truncate">
                      {member.displayName}
                    </span>
                    {isOwner && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-brand/10 text-brand font-semibold shrink-0">
                        Owner
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Models */}
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-text-muted mb-3 border-b border-border pb-2">
            <Cpu className="h-4 w-4" />
            MODELS
          </div>
          <div className="space-y-2 text-sm">
            {modelList.length === 0 ? (
              <div className="text-sm text-text-muted">
                No models configured
              </div>
            ) : (
              modelList.map(({ model, botName }) => (
                <div
                  key={model}
                  className="flex justify-between items-center px-2 py-1.5 rounded-md bg-background-floating border border-border/50"
                >
                  <span className="font-mono text-xs text-text-secondary truncate">
                    {model}
                  </span>
                  <span className="text-[11px] text-text-muted shrink-0 ml-2 font-medium">
                    {botName}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ManageBotsModal
        isOpen={showManageAgents}
        onClose={() => setShowManageAgents(false)}
      />
    </div>
  );
}

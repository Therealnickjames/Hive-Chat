"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useChatContext } from "@/components/providers/chat-provider";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { ManageBotsModal } from "@/components/modals/manage-bots-modal";
import { Permissions } from "@/lib/permissions";

interface AgentInfo {
  id: string;
  name: string;
  isStreaming: boolean;
  llmModel?: string;
  thinkingSteps?: string[];
}

export function RightPanel() {
  const { members, currentServerOwnerId, serverDataById, ensureServerScopedData, hasPermission } =
    useChatContext();
  const { panels, activeStreams } = useWorkspaceContext();
  const [showManageAgents, setShowManageAgents] = useState(false);

  const openPanels = useMemo(
    () => panels.filter((p) => !p.isClosed),
    [panels]
  );
  const openServerIds = useMemo(
    () => Array.from(new Set(openPanels.map((p) => p.serverId))).sort(),
    [openPanels]
  );

  useEffect(() => {
    openServerIds.forEach((serverId) => {
      void ensureServerScopedData(serverId);
    });
  }, [openServerIds, ensureServerScopedData]);

  // Fix 1: Use channel.botIds (ChannelBot table) with fallback to defaultBotId
  const agentList = useMemo(() => {
    const agentById = new Map<string, AgentInfo>();

    for (const panel of openPanels) {
      const scoped = serverDataById[panel.serverId];
      if (!scoped) continue;

      const channel = scoped.channels.find((c) => c.id === panel.channelId);
      if (!channel) continue;

      // Use botIds from ChannelBot table, fall back to single defaultBotId
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
          } catch { /* ignore */ }
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

  // Build task list from agent thinking steps
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

  // Build model list from all bots across open servers
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

        {/* Agents — Fix 3: "+" button moved here from left panel */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-text-dim uppercase tracking-wider">Agents</div>
            {hasPermission(Permissions.MANAGE_BOTS) && (
              <button
                onClick={() => setShowManageAgents(true)}
                className="text-[10px] font-bold text-accent-cyan hover:text-text-primary"
                title="Manage Agents"
              >
                +
              </button>
            )}
          </div>
          <div className="space-y-2">
            {agentList.length === 0 ? (
              <div className="text-xs text-text-muted">No agents active</div>
            ) : (
              agentList.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 truncate">
                    <div className={`h-2 w-2 rounded-full shrink-0 ${agent.isStreaming ? 'bg-accent-cyan animate-pulse' : 'bg-status-offline'}`} />
                    <span className="text-text-primary truncate">{agent.name}</span>
                  </div>
                  {agent.isStreaming ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="flex gap-0.5">
                        <span className="h-1 w-1 rounded-full bg-accent-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="h-1 w-1 rounded-full bg-accent-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="h-1 w-1 rounded-full bg-accent-cyan animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-text-dim font-mono tracking-wide shrink-0">IDLE</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tasks — Fix 4: "Coming Soon" label */}
        <div>
          <div className="text-xs font-bold text-text-dim mb-3 uppercase tracking-wider">
            Tasks <span className="text-text-muted font-normal normal-case tracking-normal">(Coming Soon)</span>
          </div>
          <div className="space-y-3">
            {taskList.length === 0 ? (
              <div className="text-xs text-text-muted">No thinking steps configured</div>
            ) : (
              taskList.map((task, i) => (
                <div
                  key={`${task.agentName}-${task.label}-${i}`}
                  className={`border-l-2 pl-2 ${
                    task.isActive ? 'border-accent-cyan' : 'border-border'
                  }`}
                >
                  <div className={`text-xs ${task.isActive ? 'text-text-primary' : 'text-text-muted'}`}>
                    {task.label}
                  </div>
                  <div className="text-[10px] text-text-muted mt-1">
                    @{task.agentName.toLowerCase()} {task.isActive ? '• active' : '• ready'}
                  </div>
                  {task.isActive && (
                    <div className="mt-1.5 h-0.5 w-full bg-background-tertiary rounded-full overflow-hidden">
                      <div className="h-full bg-accent-cyan animate-pulse" style={{ width: '60%' }} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Members */}
        <div>
          <div className="text-xs font-bold text-text-dim mb-3 uppercase tracking-wider">Members</div>
          <div className="space-y-2">
            {members.length === 0 ? (
              <div className="text-xs text-text-muted">No members</div>
            ) : (
              members.map(member => {
                const isOwner = member.userId === currentServerOwnerId;
                return (
                  <div key={member.userId} className="flex items-center gap-2 text-sm">
                    <div className="h-2 w-2 rounded-full bg-status-online shrink-0" />
                    <span className="text-text-primary truncate">{member.displayName}</span>
                    {isOwner && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-brand/10 text-brand uppercase font-bold shrink-0">
                        Owner
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Models — derived from server bots */}
        <div>
          <div className="text-xs font-bold text-text-dim mb-3 uppercase tracking-wider">Models</div>
          <div className="space-y-2 text-xs font-mono">
            {modelList.length === 0 ? (
              <div className="text-xs text-text-muted font-sans">No models configured</div>
            ) : (
              modelList.map(({ model, botName }) => (
                <div key={model} className="flex justify-between text-text-secondary">
                  <span className="truncate">{model}</span>
                  <span className="text-text-dim shrink-0 ml-2">{botName}</span>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Manage Agents Modal */}
      <ManageBotsModal
        isOpen={showManageAgents}
        onClose={() => setShowManageAgents(false)}
      />
    </div>
  );
}
